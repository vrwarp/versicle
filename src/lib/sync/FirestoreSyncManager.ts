/**
* Firestore Sync Manager
* 
* Manages y-fire provider for real-time cloud sync via Firestore.
* Acts as a secondary "Cloud Overlay" - y-indexeddb remains primary.
* 
* Architecture:
* - y-indexeddb: Primary (always active, source of truth for offline)
* - y-fire: Secondary (active only when authenticated)
*/
import type { User } from 'firebase/auth';
import { onAuthStateChanged, getRedirectResult } from 'firebase/auth';
import type { FirebaseApp } from 'firebase/app';
import { getYDoc, CURRENT_SCHEMA_VERSION, waitForYjsSync, handleObsoleteClient } from '@store/yjs-provider';
import { CheckpointService } from './CheckpointService';
import { MigrationStateService } from './MigrationStateService';
import * as Y from 'yjs';
import { useBookStore } from '@store/useBookStore';
import type { WorkspaceMetadata } from '~types/workspace';
import { WorkspaceDeletedError } from '~types/errors';
import type {
    SyncBackend,
    SyncBackendFactory,
    SyncConnection,
} from '@domains/sync/backend/SyncBackend';
import { FirestoreBackend } from '@domains/sync/backend/FirestoreBackend';
import { downloadWorkspaceState } from '@domains/sync/core/downloadWorkspaceState';
import { readDocSchemaVersion, readUpdateSchemaVersion } from '@domains/sync/core/quarantine';
import { getSyncEventBus } from '@domains/sync/events';
import { isPermissionDeniedEvent, RULES_OUT_OF_DATE_MESSAGE } from '@domains/sync/backend/permissionDenied';

import {
    getFirebaseApp,
    getFirebaseAuth,
    isFirebaseConfigured,
    initializeFirebase,
} from './firebase-config';
import { createLogger } from '../logger';
import { getFirestoreDebounceOverrideMs } from '../../test-flags';
import { generateSecureId } from '../crypto';
import { signInWithGoogle, signOutWithGoogle } from './auth-helper';
import { useSyncStore } from '@store/useSyncStore';

const logger = createLogger('FirestoreSync');

// Moved to the sync domain (P4-3a) so the presentation layer can import
// them without pulling in this module; re-exported for existing importers.
export { isPermissionDeniedEvent, RULES_OUT_OF_DATE_MESSAGE };


// Status types for the sync manager. Canonical home is types/sync.ts so
// store/UI consumers don't need a type edge into this service module
// (layering-deps.md LD-7); re-exported here for existing importers.
import type { FirestoreSyncStatus, FirebaseAuthStatus } from '~types/sync';
export type { FirestoreSyncStatus, FirebaseAuthStatus };

// Event callback types
type StatusChangeCallback = (status: FirestoreSyncStatus) => void;
type AuthChangeCallback = (status: FirebaseAuthStatus, user: User | null) => void;

/**
* FirestoreSyncManager Configuration
*/
interface FirestoreSyncConfig {
    /**
     * Maximum time to wait before flushing updates to Firestore.
     * Higher values reduce Firestore writes (cost saving) but increase sync delay.
     * Default: 2000ms as recommended in crdt-firestore.md
     */
    maxWaitFirestoreTime?: number;

    /**
     * Maximum number of updates to batch before forcing a flush.
     * Default: 50
     */
    maxUpdatesThreshold?: number;
}

const DEFAULT_CONFIG: Required<FirestoreSyncConfig> = {
    maxWaitFirestoreTime: 2000,
    maxUpdatesThreshold: 50
};

/**
 * What the composition root (src/app/sync/createSync.ts) installs: the
 * backend factory and, for the mock backend, the synthesized auth session
 * that replaces Firebase auth in E2E/dev. The manager itself never reads
 * the `__VERSICLE_MOCK_*` flags — backend selection is exclusively the
 * composition root's job (boundary rule 9).
 */
export interface SyncBackendSelection {
    factory: SyncBackendFactory;
    mockSession?: { uid: string; email: string };
}

/**
* Singleton service managing Firestore sync via y-fire.
*/
class FirestoreSyncManager {
    private static instance: FirestoreSyncManager | null = null;

    private connection: SyncConnection | null = null;
    private backendSelection: SyncBackendSelection = {
        factory: (uid) => new FirestoreBackend(uid),
    };
    private backend: SyncBackend | null = null;
    /** Detach handle for the live `meta` quarantine observer (§D5.2). */
    private metaQuarantineCleanup: (() => void) | null = null;
    private config: Required<FirestoreSyncConfig>;
    private currentUser: User | null = null;
    private status: FirestoreSyncStatus = 'disconnected';
    private authStatus: FirebaseAuthStatus = 'loading';
    private unsubscribeAuth: (() => void) | null = null;
    private currentApp: FirebaseApp | null = null;

    // Callbacks for status changes
    private statusCallbacks: Set<StatusChangeCallback> = new Set();
    private authCallbacks: Set<AuthChangeCallback> = new Set();

    private constructor(config: FirestoreSyncConfig = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Get the singleton instance
     */
    static getInstance(config?: FirestoreSyncConfig): FirestoreSyncManager {
        if (!FirestoreSyncManager.instance) {
            FirestoreSyncManager.instance = new FirestoreSyncManager(config);
        }
        return FirestoreSyncManager.instance;
    }

    /**
     * Reset the singleton (for testing)
     */
    static resetInstance(): void {
        if (FirestoreSyncManager.instance) {
            FirestoreSyncManager.instance.destroy();
            FirestoreSyncManager.instance = null;
        }
    }

    /**
     * Install the backend selection (composition root only — see
     * src/app/sync/createSync.ts).
     */
    setBackendSelection(selection: SyncBackendSelection): void {
        this.backendSelection = selection;
        this.backend = null;
    }

    /** The C3 backend bound to the authenticated uid (cached per uid). */
    private getBackend(uid: string): SyncBackend {
        if (!this.backend || this.backend.uid !== uid) {
            this.backend = this.backendSelection.factory(uid);
        }
        return this.backend;
    }

    /**
     * Initialize the sync manager.
     * Sets up auth state listener and auto-connects when authenticated.
     */
    async initialize(): Promise<void> {
        // Mock backend selected (E2E/dev): simulate auth and connect.
        const mockSession = this.backendSelection.mockSession;
        if (mockSession) {
            logger.info('Mock backend selected. Simulating auth and connection.');
            const mockUser = { uid: mockSession.uid, email: mockSession.email } as User;
            void this.handleAuthStateChange(mockUser);
            return;
        }

        if (!isFirebaseConfigured()) {
            logger.warn('Firebase not configured. Sync disabled.');
            this.setAuthStatus('signed-out');
            return;
        }

        if (!initializeFirebase()) {
            logger.error('Firebase initialization failed.');
            this.setAuthStatus('signed-out');
            return;
        }

        const auth = getFirebaseAuth();
        if (!auth) {
            logger.error('Firebase Auth not available.');
            this.setAuthStatus('signed-out');
            return;
        }

        // Check if we just returned from a Redirect
        try {
            const result = await getRedirectResult(auth);
            if (result && result.user) {
                logger.info('Auth', 'Successfully returned from redirect flow', result.user.uid);
                getSyncEventBus().emit({ type: 'signed-in-via-redirect', email: result.user.email ?? null });
                // Note: handleAuthStateChange will be called by onAuthStateChanged and update useSyncStore
            }
        } catch (error) {
            logger.error('Redirect login failed', error);
            this.setStatus('error');
        }

        // Set up auth state listener
        if (this.unsubscribeAuth) this.unsubscribeAuth();
        this.unsubscribeAuth = onAuthStateChanged(auth, (user) => {
            this.handleAuthStateChange(user);
        });

        logger.debug('Manager initialized');
    }

    /**
     * Handle Firebase auth state changes
     */
    private async handleAuthStateChange(user: User | null): Promise<void> {
        this.currentUser = user;
        const syncStore = useSyncStore.getState();

        if (user) {
            logger.info(`User signed in: ${user.email}`);
            this.setAuthStatus('signed-in');
            syncStore.setFirebaseEnabled(true);
            syncStore.setFirebaseAuthStatus('signed-in');
            syncStore.setFirebaseUserEmail(user.email ?? null);

            const currentWorkspace = this.getActiveWorkspaceId();

            // Smart Routing: Handle unassigned clients
            if (!currentWorkspace) {
                logger.info('No active workspace assigned. Querying remote...');
                const availableWorkspaces = await this.listWorkspaces();

                if (availableWorkspaces.length === 0) {
                    logger.info('Zero remote workspaces found. Auto-provisioning "My Library"...');
                    // createWorkspace automatically sets activeWorkspaceId and connects.
                    await this.createWorkspace('My Library');
                    return;
                } else {
                    logger.info(`${availableWorkspaces.length} workspaces found. Halting connection until user selection.`);
                    // Leave activeWorkspaceId as null. The UI must prompt them to choose.
                    this.setStatus('disconnected');
                    return;
                }
            }

            // Only connect if we have a defined destination
            if (currentWorkspace) {
                this.connectFireProvider(user.uid);
            }
        } else {
            logger.info('User signed out');
            this.setAuthStatus('signed-out');
            syncStore.setFirebaseAuthStatus('signed-out');
            syncStore.setFirebaseUserEmail(null);
            this.disconnectFireProvider();
        }
    }

    /**
     * Connect y-fire provider for the given user
     */
    private async connectFireProvider(uid: string): Promise<void> {
        const workspaceId = this.getActiveWorkspaceId();

        if (!workspaceId) {
            logger.info('Sync halted: No active workspace explicitly selected.');
            this.setStatus('disconnected');
            return;
        }

        const backend = this.getBackend(uid);

        // Check for Tombstone BEFORE connecting
        const isAlive = await backend.isWorkspaceAlive(workspaceId);

        if (!isAlive) {
            logger.warn(`Sync aborted: Workspace ${workspaceId} is tombstoned.`);
            // Sever local tie
            useSyncStore.getState().setActiveWorkspaceId(null);
            getSyncEventBus().emit({ type: 'workspace-tombstoned', workspaceId, context: 'connect' });
            this.setStatus('disconnected');
            throw new WorkspaceDeletedError();
        }

        // Quarantine layer 1 — cheap pre-attach probe (§D5.1): a client
        // that was offline during a fleet migration is locked BEFORE any
        // remote bytes can reach the live doc. Maintained by layer 3 below.
        const workspaceMeta = (await backend.listWorkspaces()).find(
            ws => ws.workspaceId === workspaceId
        );
        if (workspaceMeta && workspaceMeta.schemaVersion > CURRENT_SCHEMA_VERSION) {
            logger.warn(
                `Pre-attach quarantine: workspace metadata declares schema v${workspaceMeta.schemaVersion} > supported v${CURRENT_SCHEMA_VERSION}.`
            );
            handleObsoleteClient(workspaceMeta.schemaVersion);
            return;
        }

        if (this.connection) {
            const currentApp = getFirebaseApp();
            if (currentApp !== this.currentApp) {
                logger.debug('Firebase app changed, reconnecting...');
                this.disconnectFireProvider();
            } else {
                logger.debug('Already connected, skipping');
                return;
            }
        }

        // Create a safety checkpoint before connecting (which triggers download)
        try {
            logger.debug('Creating pre-sync checkpoint (if needed)...');
            // Limit to once per 24 hours (86400000 ms)
            const id = await CheckpointService.createAutomaticCheckpoint('pre-sync', 86400000);
            if (id) {
                logger.info(`Created pre-sync checkpoint #${id}`);
            } else {
                logger.debug('Skipped pre-sync checkpoint (recent one exists)');
            }
        } catch (error) {
            logger.warn('Failed to create pre-sync checkpoint', error);
            // Non-blocking: proceed with sync even if checkpoint fails
        }

        const maxWaitTime = getFirestoreDebounceOverrideMs() || this.config.maxWaitFirestoreTime;

        await waitForYjsSync();

        // Quarantine layer 3 — metadata maintenance (§D5.3): after a local
        // migration the doc's version is ahead of the creation-time stamp;
        // keep the workspace directory tracking it so layer 1 (and the
        // workspace-list version gate) stay honest. Non-blocking: an
        // offline stamp failure just retries on a later connect.
        const docVersion = readDocSchemaVersion(getYDoc());
        if (workspaceMeta && docVersion > workspaceMeta.schemaVersion) {
            backend
                .updateWorkspaceMetadata(workspaceId, { schemaVersion: docVersion })
                .then(() => {
                    logger.info(
                        `Stamped workspace ${workspaceId} metadata: schema v${workspaceMeta.schemaVersion} → v${docVersion}`
                    );
                })
                .catch(error => {
                    logger.warn('Failed to stamp workspace metadata schemaVersion', error);
                });
        }

        // merge-defaults hydration guarantees `books` is always present
        // (flip wave 4) — the old `|| {}` fallback canary is gone.
        const isCleanClient = Object.keys(useBookStore.getState().books).length === 0;

        if (isCleanClient) {
            logger.info('Clean client detected. Checking for cloud data...');
            this.performCleanSync(backend, workspaceId, maxWaitTime).catch(err => {
                logger.error('Clean sync failed:', err);
                this.setStatus('error');
            });
        } else {
            this.connectFireProviderNormal(backend, workspaceId, maxWaitTime);
        }
    }

    private async performCleanSync(backend: SyncBackend, workspaceId: string, maxWaitTime: number): Promise<void> {
        this.setStatus('connecting');
        const events = getSyncEventBus();

        try {
            const hasCloudData = await backend.probeHasData(workspaceId);
            if (!hasCloudData) {
                logger.info('No cloud data found. Client is officially the first device.');
                this.connectFireProviderNormal(backend, workspaceId, maxWaitTime);
                return;
            }

            logger.info('Cloud data found. Initiating temporary Y.Doc sync...');
            events.emit({ type: 'clean-sync', phase: 'started' });

            // Legacy clean-sync behavior: a connect failure or timeout
            // resolves with whatever synced (treated as "remote empty").
            const downloaded = await downloadWorkspaceState(backend, workspaceId, {
                maxWaitTimeMs: maxWaitTime,
                maxUpdatesThreshold: this.config.maxUpdatesThreshold,
                timeoutMs: 15000,
                onAttachError: 'resolve',
            });

            // Quarantine layer 1 — synchronous pre-apply check (§D5.1):
            // prove the downloaded state's version on a scratch doc BEFORE
            // any byte touches the live doc (closes the analysis item-4
            // window: pre-P4 this applied blindly).
            const incomingVersion = readUpdateSchemaVersion(downloaded);
            if (incomingVersion > CURRENT_SCHEMA_VERSION) {
                logger.warn(
                    `Clean-sync quarantine: cloud data is schema v${incomingVersion} > supported v${CURRENT_SCHEMA_VERSION}. Nothing was applied.`
                );
                handleObsoleteClient(incomingVersion);
                return;
            }

            logger.info('Applying downloaded cloud data to main Y.Doc...');
            Y.applyUpdate(getYDoc(), downloaded);

            logger.info('Clean sync complete. Connecting main provider...');
            events.emit({ type: 'clean-sync', phase: 'applied' });

            // Connect the main provider now that the initial load is done
            this.connectFireProviderNormal(backend, workspaceId, maxWaitTime);

        } catch (error) {
            logger.error('Failed clean sync:', error);
            this.setStatus('error');
            events.emit({ type: 'clean-sync', phase: 'failed' });
        }
    }

    private connectFireProviderNormal(backend: SyncBackend, workspaceId: string, maxWaitTime: number): void {
        this.setStatus('connecting');

        try {
            const connection = backend.connect(getYDoc(), workspaceId, {
                maxWaitTimeMs: maxWaitTime,
                maxUpdatesThreshold: this.config.maxUpdatesThreshold,
            });
            this.connection = connection;
            this.currentApp = getFirebaseApp();

            // Transport error events, normalized by the backend adapter.
            // No UX here: the transport announces, wireSyncEvents presents.
            const events = getSyncEventBus();
            connection.on('connection-error', (event) => {
                logger.error('Firestore connection error:', event);
                this.setStatus('error');
                events.emit({
                    type: 'connection-error',
                    permissionDenied: isPermissionDeniedEvent(event),
                });
            });

            connection.on('sync-failure', (error) => {
                logger.error('Firestore sync failure after max retries:', error);
                this.setStatus('error');
                events.emit({
                    type: 'sync-failure',
                    permissionDenied: isPermissionDeniedEvent(error),
                });
            });

            connection.on('save-rejected', (event) => {
                logger.error('Firestore save rejected:', event);
                this.setStatus('error');
                events.emit({
                    type: 'save-rejected',
                    code: event.code,
                    sizeBytes: event.sizeBytes,
                    permissionDenied: isPermissionDeniedEvent(event),
                });
            });

            // A committed save → lastSyncTime (the `flushed` semantics).
            connection.on('saved', (at) => {
                events.emit({ type: 'flushed', at });
            });

            // Quarantine layer 2 — live observer (§D5.2): y-cinder applies
            // remote updates to the doc internally, so the guard sits on the
            // `meta` map and fires synchronously on transaction commit. The
            // local Y-merge of that one transaction has happened (accepted
            // residual, pinned by the F.2 contract test); enforcement
            // destroys the provider so nothing further flows either way.
            const metaMap = getYDoc().getMap('meta');
            const checkMetaVersion = (): void => {
                const incoming = metaMap.get('schemaVersion');
                if (typeof incoming === 'number' && incoming > CURRENT_SCHEMA_VERSION) {
                    logger.warn(
                        `Live quarantine: meta.schemaVersion v${incoming} > supported v${CURRENT_SCHEMA_VERSION}.`
                    );
                    handleObsoleteClient(incoming);
                }
            };
            metaMap.observe(checkMetaVersion);
            this.metaQuarantineCleanup = () => metaMap.unobserve(checkMetaVersion);
            // A doc already past CURRENT must not attach at all.
            checkMetaVersion();
            if (!this.connection) {
                // checkMetaVersion → handleObsoleteClient → severObsoleteConnection
                // already tore the connection down; do not report connected.
                return;
            }

            // The provider connects automatically in the background
            logger.info(`Connected to workspace: ${workspaceId}`);
            this.setStatus('connected');

        } catch (error) {
            logger.error('Failed to connect:', error);
            this.setStatus('error');
        }
    }

    /**
     * Disconnect the backend connection
     */
    private disconnectFireProvider(): void {
        if (this.metaQuarantineCleanup) {
            this.metaQuarantineCleanup();
            this.metaQuarantineCleanup = null;
        }
        if (this.connection) {
            try {
                this.connection.destroy();
                logger.debug('Provider destroyed');
            } catch (error) {
                logger.error('Error destroying provider:', error);
            }
            this.connection = null;
        }
        this.setStatus('disconnected');
    }

    /**
     * Quarantine severing (§D5): called by wireSyncEvents on the `obsolete`
     * SyncEvent. A real provider destroy — zero outbound writes afterwards —
     * not the pre-P4 status-label flip. Idempotent.
     */
    severObsoleteConnection(): void {
        if (this.connection) {
            logger.warn('Obsolete client: destroying provider connection.');
        }
        this.disconnectFireProvider();
    }

    /**
     * Sign in with Google
     */
    async signIn(): Promise<void> {
        try {
            this.setAuthStatus('loading');
            const result = await signInWithGoogle();

            if (result) {
                // Native flow returns a credential
                logger.debug('Sign in returned credential (Native flow)');
            } else {
                // Web flow returns void (redirecting)
                logger.debug('Sign in redirected (Web flow)');
            }
        } catch (error) {
            logger.error('Sign in failed:', error);
            this.setAuthStatus('signed-out');
            throw error;
        }
    }

    /**
     * Sign out
     */
    async signOut(): Promise<void> {
        const auth = getFirebaseAuth();
        if (!auth) {
            throw new Error('Firebase Auth not initialized');
        }

        try {
            await signOutWithGoogle(auth);
            // Auth state change handler will disconnect the provider
        } catch (error) {
            logger.error('Sign out failed:', error);
            throw error;
        }
    }

    /**
     * Destroy the sync manager and clean up resources
     */
    destroy(): void {
        this.disconnectFireProvider();

        if (this.unsubscribeAuth) {
            this.unsubscribeAuth();
            this.unsubscribeAuth = null;
        }

        this.statusCallbacks.clear();
        this.authCallbacks.clear();

        logger.debug('Manager destroyed');
    }

    // --- Workspace Management ---

    /**
     * Get the currently active workspace ID.
     */
    getActiveWorkspaceId(): string | null {
        return useSyncStore.getState().activeWorkspaceId;
    }

    /**
     * Create a new workspace.
     * Flow A: Generates ID, writes metadata to Firestore, switches active workspace.
     */
    async createWorkspace(name: string): Promise<string> {
        const user = this.getCurrentUser();
        if (!user) throw new Error('Must be signed in to create a workspace');

        const workspaceId = generateSecureId('ws');

        const metadata: WorkspaceMetadata = {
            workspaceId,
            name,
            createdAt: Date.now(),
            schemaVersion: CURRENT_SCHEMA_VERSION,
        };

        await this.getBackend(user.uid).createWorkspace(metadata);
        logger.info(`Created workspace: ${name} (${workspaceId})`);

        // Update active workspace
        useSyncStore.getState().setActiveWorkspaceId(workspaceId);

        // Reconnect with new path (empty remote = local becomes source of truth)
        this.disconnectFireProvider();
        await this.connectFireProvider(user.uid);

        return workspaceId;
    }

    /**
     * Switch to an existing workspace using the multi-stage commit process.
     * Flow B: Pre-flight → Backup → State Lock → Hydrate → Apply → Reload.
     */
    async switchWorkspace(targetWorkspaceId: string): Promise<void> {
        const user = this.getCurrentUser();
        if (!user) throw new Error('Must be signed in to switch workspaces');

        const currentWorkspaceId = this.getActiveWorkspaceId();
        if (targetWorkspaceId === currentWorkspaceId) {
            logger.info('Already on the target workspace, no switch needed');
            return;
        }

        logger.info(`Switching workspace: ${currentWorkspaceId} → ${targetWorkspaceId}`);
        const events = getSyncEventBus();
        const backend = this.getBackend(user.uid);

        // Step 0: Pre-flight validation
        const isAlive = await backend.isWorkspaceAlive(targetWorkspaceId);
        if (!isAlive) {
            events.emit({ type: 'workspace-tombstoned', workspaceId: targetWorkspaceId, context: 'switch' });
            throw new WorkspaceDeletedError();
        }

        try {
            // Step 1: Backup current state.
            // Protected: the rolling checkpoint prune must not delete the
            // rollback target while the migration state machine is unresolved.
            logger.info('Creating pre-migration checkpoint...');
            const backupId = await CheckpointService.createCheckpoint('pre-migration', { protected: true });
            logger.info(`Pre-migration checkpoint created: #${backupId}`);

            // Step 2: State Lock
            MigrationStateService.setAwaitingConfirmation(targetWorkspaceId, backupId);

            // Step 3: Update active workspace ID (persists across reload)
            useSyncStore.getState().setActiveWorkspaceId(targetWorkspaceId);

            // Step 4: Hydrate remote state into temp Y.Doc
            logger.info('Downloading remote workspace state...');
            events.emit({ type: 'switch', phase: 'downloading' });

            const maxWaitTime = getFirestoreDebounceOverrideMs() || 2000;

            // Legacy switch behavior: a synchronous connect failure rejects
            // (routed to the non-destructive catch below); a timeout resolves
            // with whatever synced.
            const remoteBlob = await downloadWorkspaceState(backend, targetWorkspaceId, {
                maxWaitTimeMs: maxWaitTime,
                maxUpdatesThreshold: this.config.maxUpdatesThreshold,
                timeoutMs: 15000,
                onAttachError: 'reject',
            });

            // Step 4b: Verify — quarantine layer 1 for the switch path
            // (§D4 step 4 / §D5.1): scratch-check the downloaded state's
            // version BEFORE the destructive apply. The throw routes to the
            // non-destructive catch below (state machine cleared, id
            // reverted — the download is a pure read).
            const incomingVersion = readUpdateSchemaVersion(remoteBlob);
            if (incomingVersion > CURRENT_SCHEMA_VERSION) {
                handleObsoleteClient(incomingVersion);
                throw new Error(
                    `Workspace ${targetWorkspaceId} requires schema v${incomingVersion}; this app supports v${CURRENT_SCHEMA_VERSION}`
                );
            }

            // Step 5: Apply & Reload
            logger.info('Applying remote state and reloading...');
            try {
                await CheckpointService.applyRemoteState(remoteBlob);
                // applyRemoteState triggers window.location.reload()
            } catch (applyError) {
                // The destructive phase may already have wiped local
                // persistence — do NOT clear the migration state here.
                // Transition to RESTORING_BACKUP so the boot interceptor
                // restores the pinned pre-migration checkpoint on reload.
                logger.error('Failed to apply remote state, rolling back to backup:', applyError);
                MigrationStateService.setRestoringBackup();
                useSyncStore.getState().setActiveWorkspaceId(currentWorkspaceId);
                events.emit({ type: 'switch', phase: 'failed-rolling-back' });
                window.location.reload();
                return;
            }

        } catch (error) {
            logger.error('Workspace switch failed:', error);
            // Clean up migration state on failure (nothing destructive has
            // run before Step 5, so local IDB is genuinely untouched here)
            MigrationStateService.clear();
            // Revert workspace ID
            useSyncStore.getState().setActiveWorkspaceId(currentWorkspaceId);
            events.emit({ type: 'switch', phase: 'failed-aborted' });
            throw error;
        }
    }

    /**
     * List available workspaces for the current user.
     */
    async listWorkspaces(): Promise<WorkspaceMetadata[]> {
        const user = this.getCurrentUser();
        if (!user) return [];

        // Tombstoned workspaces are filtered by the backend.
        return this.getBackend(user.uid).listWorkspaces();
    }

    /**
     * Delete a workspace (Tombstone Pattern).
     * Reclaims storage but preserves a tombstone to prevent resurrection.
     */
    public async deleteWorkspace(workspaceId: string): Promise<void> {
        const user = this.getCurrentUser();
        if (!user) throw new Error('Must be authenticated to delete workspace');

        const backend = this.getBackend(user.uid);

        // Legacy real/mock divergence preserved as backend data, not
        // branches — see LegacyDeleteBehavior (unified by P4-6).
        if (backend.legacyDeleteBehavior.destroyConnectionFirst) {
            // Terminate the active connection to prevent resurrection
            this.destroy();
        }

        await backend.deleteWorkspace(workspaceId);

        // Sever local tie
        if (backend.legacyDeleteBehavior.severActiveUnconditionally) {
            useSyncStore.getState().setActiveWorkspaceId(null);
        } else {
            const activeWorkspaceId = useSyncStore.getState().activeWorkspaceId;
            if (activeWorkspaceId === workspaceId) {
                useSyncStore.getState().setActiveWorkspaceId(null);
            }
        }

        logger.info(`Workspace deleted and tombstoned: ${workspaceId}`);
    }

    // --- Status Management ---

    private setStatus(status: FirestoreSyncStatus): void {
        this.status = status;
        this.statusCallbacks.forEach(cb => cb(status));
        // Always update the UI store directly
        useSyncStore.getState().setFirestoreStatus(status);
        getSyncEventBus().emit({ type: 'status', status });
    }

    private setAuthStatus(status: FirebaseAuthStatus): void {
        this.authStatus = status;
        this.authCallbacks.forEach(cb => cb(status, this.currentUser));
        getSyncEventBus().emit({
            type: 'auth',
            status,
            email: this.currentUser?.email ?? null,
        });
    }

    /**
     * Subscribe to sync status changes
     */
    onStatusChange(callback: StatusChangeCallback): () => void {
        this.statusCallbacks.add(callback);
        // Immediately call with current status
        callback(this.status);
        return () => this.statusCallbacks.delete(callback);
    }

    /**
     * Subscribe to auth status changes
     */
    onAuthChange(callback: AuthChangeCallback): () => void {
        this.authCallbacks.add(callback);
        // Immediately call with current status
        callback(this.authStatus, this.currentUser);
        return () => this.authCallbacks.delete(callback);
    }

    // --- Getters ---

    getStatus(): FirestoreSyncStatus {
        return this.status;
    }

    getAuthStatus(): FirebaseAuthStatus {
        return this.authStatus;
    }

    getCurrentUser(): User | null {
        if (this.currentUser) return this.currentUser;

        // Fallback for HMR / Dev mode where singleton state might be lost
        const mockSession = this.backendSelection.mockSession;
        if (mockSession) {
            this.currentUser = { uid: mockSession.uid, email: mockSession.email } as User;
            return this.currentUser;
        }

        try {
            const auth = getFirebaseAuth();
            if (auth?.currentUser) {
                this.currentUser = auth.currentUser;
                return this.currentUser;
            }
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (e) {
            // Ignore if Firebase isn't initialized yet
        }

        return null;
    }

    isConnected(): boolean {
        return this.status === 'connected';
    }

    isSignedIn(): boolean {
        return this.authStatus === 'signed-in';
    }
}

// Export the singleton getter
export const getFirestoreSyncManager = (config?: FirestoreSyncConfig): FirestoreSyncManager => {
    return FirestoreSyncManager.getInstance(config);
};

// Export for testing
export { FirestoreSyncManager };

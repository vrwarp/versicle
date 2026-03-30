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
import { FireProvider } from 'y-cinder';
import type { User } from 'firebase/auth';
import { onAuthStateChanged, getRedirectResult } from 'firebase/auth';
import type { FirebaseApp } from 'firebase/app';
import { yDoc, CURRENT_SCHEMA_VERSION } from '../../store/yjs-provider';
import { CheckpointService } from './CheckpointService';
import { MigrationStateService } from './MigrationStateService';
import * as Y from 'yjs';
import { useBookStore } from '../../store/useBookStore';
import { doc, getDoc, setDoc, collection, getDocs, query, limit, writeBatch } from 'firebase/firestore';
import type { WorkspaceMetadata } from '../../types/workspace';
import { WorkspaceDeletedError } from '../../types/errors';

import {
    getFirebaseApp,
    getFirebaseAuth,
    isFirebaseConfigured,
    initializeFirebase,
    getFirestoreDb
} from './firebase-config';
import { MockFireProvider } from './drivers/MockFireProvider';
import { createLogger } from '../logger';
import { signInWithGoogle, signOutWithGoogle } from './auth-helper';
import { useToastStore } from '../../store/useToastStore';
import { useSyncStore } from './hooks/useSyncStore';

const logger = createLogger('FirestoreSync');


// Status types for the sync manager
export type FirestoreSyncStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type FirebaseAuthStatus = 'signed-out' | 'signed-in' | 'loading';

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
* Singleton service managing Firestore sync via y-fire.
*/
class FirestoreSyncManager {
    private static instance: FirestoreSyncManager | null = null;

    private fireProvider: FireProvider | null = null;
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
     * Initialize the sync manager.
     * Sets up auth state listener and auto-connects when authenticated.
     */
    async initialize(): Promise<void> {
        // Support for Mock Firestore (Testing)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = typeof window !== 'undefined' ? (window as any) : null;
        if (w && w.__VERSICLE_MOCK_FIRESTORE__) {
            logger.info('Mock mode detected. Simulating auth and connection.');
            const mockUid = w.__VERSICLE_MOCK_USER_ID__ || 'mock-user';
            const mockUser = { uid: mockUid, email: `${mockUid}@example.com` } as User;
            this.handleAuthStateChange(mockUser);
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
                useToastStore.getState().showToast(`Signed in as ${result.user.email}`, 'success');
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
     * Pre-flight validation: Check if the workspace has been tombstoned.
     * Returns true if workspace is safe to sync, false if tombstoned.
     */
    private async validateWorkspaceIsAlive(uid: string, workspaceId: string): Promise<boolean> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const isMock = typeof window !== 'undefined' && (window as any).__VERSICLE_MOCK_FIRESTORE__;
        if (isMock) {
            // Check both metadata list and document snapshot
            const raw = localStorage.getItem('__VERSICLE_WORKSPACES__') || '[]';
            const workspaces: WorkspaceMetadata[] = JSON.parse(raw);
            const ws = workspaces.find(w => w.workspaceId === workspaceId);
            if (ws && ws.deletedAt) return false;

            const snapshotStr = localStorage.getItem('versicle_mock_firestore_snapshot') || '{}';
            const snapshot = JSON.parse(snapshotStr);
            const path = `users/${uid}/versicle/${workspaceId}`;
            if (snapshot[path]?.isDeleted) return false;

            return true;
        }

        const db = getFirestoreDb();
        if (!db) return true; // Fail-safe (let it pass to allow offline queuing if config is missing)

        const docRef = doc(db, `users/${uid}/versicle/${workspaceId}`);
        try {
            const snapshot = await getDoc(docRef);
            if (snapshot.exists()) {
                const data = snapshot.data();
                if (data?.isDeleted === true) {
                    return false; // Tombstone found
                }
            }
            return true; // Doc missing or not deleted
        } catch (error) {
            logger.error('Failed to validate workspace state', error);
            // If offline, let it pass to allow offline queuing
            return true;
        }
    }

    /**
     * Handle Firebase auth state changes
     */
    private handleAuthStateChange(user: User | null): void {
        this.currentUser = user;

        // Always update the UI store directly
        const syncStore = useSyncStore.getState();

        if (user) {
            logger.info(`User signed in: ${user.email}`);
            this.setAuthStatus('signed-in');
            syncStore.setFirebaseEnabled(true);
            syncStore.setFirebaseAuthStatus('signed-in');
            syncStore.setFirebaseUserEmail(user.email ?? null);
            this.connectFireProvider(user.uid);
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
        const workspaceId = useSyncStore.getState().activeWorkspaceId || FirestoreSyncManager.getDefaultWorkspaceId();

        // Check for Tombstone BEFORE connecting
        const isAlive = await this.validateWorkspaceIsAlive(uid, workspaceId);

        if (!isAlive) {
            logger.warn(`Sync aborted: Workspace ${workspaceId} is tombstoned.`);
            // Sever local tie
            useSyncStore.getState().setActiveWorkspaceId(null);
            useToastStore.getState().showToast('Sync disconnected: Remote workspace was deleted. Operating offline.', 'error', 8000);
            this.setStatus('disconnected');
            throw new WorkspaceDeletedError();
        }

        if (this.fireProvider) {
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

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const isMock = typeof window !== 'undefined' && (window as any).__VERSICLE_MOCK_FIRESTORE__;

        let app = getFirebaseApp();
        if (!app) {
            if (isMock) {
                // Use dummy app for mock provider
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                app = {} as any;
            } else {
                logger.error('Firebase app not available');
                this.setStatus('error');
                return;
            }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const maxWaitTime = (typeof window !== 'undefined' && (window as any).__VERSICLE_FIRESTORE_DEBOUNCE_MS__) || this.config.maxWaitFirestoreTime;

        const path = `users/${uid}/versicle/${workspaceId}`;

        const isCleanClient = Object.keys(useBookStore.getState().books || {}).length === 0;

        if (isCleanClient) {
            logger.info('Clean client detected. Checking for cloud data...');
            this.performCleanSync(path, maxWaitTime, app!, isMock).catch(err => {
                logger.error('Clean sync failed:', err);
                this.setStatus('error');
            });
        } else {
            this.connectFireProviderNormal(path, maxWaitTime, app!, isMock);
        }
    }

    private async performCleanSync(path: string, maxWaitTime: number, app: FirebaseApp, isMock: boolean): Promise<void> {
        this.setStatus('connecting');
        const toast = useToastStore.getState().showToast;

        try {
            if (!isMock) {
                const db = getFirestoreDb();
                if (!db) throw new Error('Firestore not initialized');

                // Check main document for snapshot/state vector
                const docRef = doc(db, path);
                const docSnap = await getDoc(docRef);
                const hasMainDocData = docSnap.exists() && (
                    docSnap.data()?.content ||
                    docSnap.data()?.stateVector ||
                    docSnap.data()?.snapshotBase64
                );

                // Check updates collection in case compaction hasn't run yet
                const updatesQ = query(collection(db, path, 'updates'), limit(1));
                const updatesSnap = await getDocs(updatesQ);

                if (!hasMainDocData && updatesSnap.empty) {
                    logger.info('No cloud data found. Client is officially the first device.');
                    this.connectFireProviderNormal(path, maxWaitTime, app, isMock);
                    return;
                }
            } else {
                const mockDataStr = localStorage.getItem('versicle_mock_firestore_snapshot');
                if (!mockDataStr) {
                    logger.info('[Mock] No cloud data found. Client is officially the first device.');
                    this.connectFireProviderNormal(path, maxWaitTime, app, isMock);
                    return;
                }
                try {
                    const mockData = JSON.parse(mockDataStr);
                    if (!mockData[path] || !mockData[path].snapshotBase64) {
                        logger.info('[Mock] No cloud data found for path. Client is explicitly clean.');
                        this.connectFireProviderNormal(path, maxWaitTime, app, isMock);
                        return;
                    }
                } catch (e) {
                    logger.error('Failed to parse mock data', e);
                }
            }

            logger.info('Cloud data found. Initiating temporary Y.Doc sync...');
            toast('Syncing library from cloud...', 'info');

            const tempDoc = new Y.Doc();

            await new Promise<void>((resolve) => {
                let resolved = false;

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                let tempProvider: any = null;

                const syncHandler = (isSynced: boolean) => {
                    if (isSynced && !resolved) {
                        logger.info('Received sync complete event from temp provider.');
                        resolved = true;
                        clearTimeout(timeout);
                        if (tempProvider) tempProvider.off('sync', syncHandler);
                        resolve();
                    }
                };

                const timeout = setTimeout(() => {
                    if (!resolved) {
                        logger.warn('Clean sync timeout reached. Proceeding.');
                        resolved = true;
                        if (tempProvider) tempProvider.off('sync', syncHandler);
                        resolve();
                    }
                }, 15000);

                const providerConfig = {
                    firebaseApp: app,
                    ydoc: tempDoc,
                    path,
                    maxWaitTime: maxWaitTime,
                    maxUpdatesThreshold: this.config.maxUpdatesThreshold
                };

                try {
                    if (isMock) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        tempProvider = new MockFireProvider(providerConfig as any);
                    } else {
                        tempProvider = new FireProvider(providerConfig);
                    }
                    tempProvider.on('sync', syncHandler);
                } catch (e) {
                    logger.error('Failed to connect temp provider:', e);
                    if (!resolved) {
                        clearTimeout(timeout);
                        resolved = true;
                        resolve();
                    }
                }

                // Expose to outer scope for cleanup if it doesn't resolve inside
                if (tempProvider) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (tempDoc as any)._tempProvider = tempProvider;
                }
            });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const tempProvider = (tempDoc as any)._tempProvider;
            if (tempProvider) {
                try {
                    tempProvider.destroy();
                } catch (e) {
                    logger.error('Error destroying temporary provider', e);
                }
            }
            logger.info('Applying downloaded cloud data to main Y.Doc...');
            const stateVector = Y.encodeStateAsUpdate(tempDoc);
            Y.applyUpdate(yDoc, stateVector);

            logger.info('Clean sync complete. Connecting main provider...');
            toast('Sync complete!', 'success');

            // Connect the main provider now that the initial load is done
            this.connectFireProviderNormal(path, maxWaitTime, app, isMock);

        } catch (error) {
            logger.error('Failed clean sync:', error);
            this.setStatus('error');
            toast('Failed to sync. Please try again.', 'error');
        }
    }

    private connectFireProviderNormal(path: string, maxWaitTime: number, app: FirebaseApp, isMock: boolean): void {
        this.setStatus('connecting');

        const providerConfig = {
            firebaseApp: app,
            ydoc: yDoc,
            path,
            maxWaitTime: maxWaitTime,
            maxUpdatesThreshold: this.config.maxUpdatesThreshold
        };

        try {
            // Use MockFireProvider for testing when flag is set
            if (isMock) {
                logger.debug('Using MockFireProvider (test mode)');
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                this.fireProvider = new MockFireProvider(providerConfig as any) as unknown as FireProvider;
            } else {
                this.fireProvider = new FireProvider(providerConfig);
            }
            this.currentApp = app;

            // Setup new y-cinder error event listeners
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.fireProvider.on('connection-error', (event: any) => {
                logger.error('Firestore connection error:', event);
                this.setStatus('error');
            });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.fireProvider.on('sync-failure', (error: any) => {
                logger.error('Firestore sync failure after max retries:', error);
                this.setStatus('error');
                useToastStore.getState().showToast('Sync failed after multiple attempts. Please check your connection.', 'error', 5000);
            });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.fireProvider.on('save-rejected', (event: any) => {
                logger.error('Firestore save rejected:', event);
                this.setStatus('error');

                if (event.code === 'document-too-large') {
                    useToastStore.getState().showToast(`Sync disabled: Document too large (${event.sizeBytes} bytes). Please export and clear data.`, 'error', 8000);
                } else if (event.code === 'max-retries-exceeded') {
                    useToastStore.getState().showToast('Sync save failed: Max retries exceeded. Check connection.', 'error', 5000);
                }
            });

            // y-fire connects automatically
            logger.info(`Connected to path: ${path}`);
            this.setStatus('connected');

        } catch (error) {
            logger.error('Failed to connect:', error);
            this.setStatus('error');
        }
    }

    /**
     * Disconnect y-fire provider
     */
    private disconnectFireProvider(): void {
        if (this.fireProvider) {
            try {
                this.fireProvider.destroy();
                logger.debug('Provider destroyed');
            } catch (error) {
                logger.error('Error destroying provider:', error);
            }
            this.fireProvider = null;
        }
        this.setStatus('disconnected');
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
     * Returns the default workspace ID for backward compatibility.
     * Maps to the old path structure: main${schemaSuffix} or dev${schemaSuffix}.
     */
    static getDefaultWorkspaceId(): string {
        const isDev = import.meta.env.DEV;
        const schemaSuffix = CURRENT_SCHEMA_VERSION > 1 ? `${CURRENT_SCHEMA_VERSION}` : '';
        return isDev ? `dev${schemaSuffix}` : `main${schemaSuffix}`;
    }

    /**
     * Get the currently active workspace ID.
     */
    getActiveWorkspaceId(): string {
        const { activeWorkspaceId } = useSyncStore.getState();
        return activeWorkspaceId || FirestoreSyncManager.getDefaultWorkspaceId();
    }

    /**
     * Create a new workspace.
     * Flow A: Generates ID, writes metadata to Firestore, switches active workspace.
     */
    async createWorkspace(name: string): Promise<string> {
        const user = this.getCurrentUser();
        if (!user) throw new Error('Must be signed in to create a workspace');

        const workspaceId = `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

        const metadata: WorkspaceMetadata = {
            workspaceId,
            name,
            createdAt: Date.now(),
            schemaVersion: CURRENT_SCHEMA_VERSION,
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const isMock = typeof window !== 'undefined' && (window as any).__VERSICLE_MOCK_FIRESTORE__;

        if (isMock) {
            // Store workspace metadata in localStorage for mock mode
            const raw = localStorage.getItem('__VERSICLE_WORKSPACES__') || '[]';
            const workspaces: WorkspaceMetadata[] = JSON.parse(raw);
            if (workspaces.length === 0) {
                workspaces.push({ workspaceId: FirestoreSyncManager.getDefaultWorkspaceId(), name: 'Default', createdAt: Date.now(), schemaVersion: 4 });
            }
            workspaces.push(metadata);
            localStorage.setItem('__VERSICLE_WORKSPACES__', JSON.stringify(workspaces));
            logger.info(`[Mock] Created workspace: ${name} (${workspaceId})`);
        } else {
            const db = getFirestoreDb();
            if (!db) throw new Error('Firestore not initialized');
            const metaRef = doc(db, `users/${user.uid}/workspaces/${workspaceId}`);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await setDoc(metaRef, metadata as any);
            logger.info(`Created workspace: ${name} (${workspaceId})`);
        }

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
        const toast = useToastStore.getState().showToast;

        // Step 0: Pre-flight validation
        const isAlive = await this.validateWorkspaceIsAlive(user.uid, targetWorkspaceId);
        if (!isAlive) {
            toast('Cannot switch: This workspace has been deleted.', 'error');
            throw new WorkspaceDeletedError();
        }

        try {
            // Step 1: Backup current state
            logger.info('Creating pre-migration checkpoint...');
            const backupId = await CheckpointService.createCheckpoint('pre-migration');
            logger.info(`Pre-migration checkpoint created: #${backupId}`);

            // Step 2: State Lock
            MigrationStateService.setAwaitingConfirmation(targetWorkspaceId, backupId);

            // Step 3: Update active workspace ID (persists across reload)
            useSyncStore.getState().setActiveWorkspaceId(targetWorkspaceId);

            // Step 4: Hydrate remote state into temp Y.Doc
            logger.info('Downloading remote workspace state...');
            toast('Downloading workspace data...', 'info');

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const isMock = typeof window !== 'undefined' && (window as any).__VERSICLE_MOCK_FIRESTORE__;
            const app = getFirebaseApp();

            if (!app && !isMock) {
                throw new Error('Firebase app not available');
            }

            const targetPath = `users/${user.uid}/versicle/${targetWorkspaceId}`;
            const tempDoc = new Y.Doc();

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const maxWaitTime = (typeof window !== 'undefined' && (window as any).__VERSICLE_FIRESTORE_DEBOUNCE_MS__) || 2000;

            const remoteBlob = await new Promise<Uint8Array>((resolve, reject) => {
                let resolved = false;

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                let tempProvider: any;

                const syncHandler = (isSynced: boolean) => {
                    if (isSynced && !resolved) {
                        logger.info('Received sync complete event from temp workspace provider.');
                        resolved = true;
                        clearTimeout(timeout);
                        if (tempProvider) tempProvider.off('sync', syncHandler);
                        resolve(Y.encodeStateAsUpdate(tempDoc));
                    }
                };

                const timeout = setTimeout(() => {
                    if (!resolved) {
                        logger.warn('Workspace sync timeout reached. Assuming empty or unreachable remote.');
                        resolved = true;
                        if (tempProvider) tempProvider.off('sync', syncHandler);
                        resolve(Y.encodeStateAsUpdate(tempDoc));
                    }
                }, 15000);

                const providerConfig = {
                    firebaseApp: app || ({} as FirebaseApp),
                    ydoc: tempDoc,
                    path: targetPath,
                    maxWaitTime,
                    maxUpdatesThreshold: this.config.maxUpdatesThreshold,
                };

                try {
                    if (isMock) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        tempProvider = new MockFireProvider(providerConfig as any);
                    } else {
                        tempProvider = new FireProvider(providerConfig);
                    }
                    tempProvider.on('sync', syncHandler);
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (tempDoc as any)._tempProvider = tempProvider;
                } catch (e) {
                    if (!resolved) {
                        clearTimeout(timeout);
                        resolved = true;
                        reject(e);
                    }
                }
            });

            // Cleanup temp provider
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const tempProvider = (tempDoc as any)._tempProvider;
            if (tempProvider) {
                try { tempProvider.destroy(); } catch (e) { logger.error('Error destroying temp provider', e); }
            }
            tempDoc.destroy();

            // Step 5: Apply & Reload
            logger.info('Applying remote state and reloading...');
            await CheckpointService.applyRemoteState(remoteBlob);
            // applyRemoteState triggers window.location.reload()

        } catch (error) {
            logger.error('Workspace switch failed:', error);
            // Clean up migration state on failure (local IDB untouched)
            MigrationStateService.clear();
            // Revert workspace ID
            useSyncStore.getState().setActiveWorkspaceId(currentWorkspaceId === FirestoreSyncManager.getDefaultWorkspaceId() ? null : currentWorkspaceId);
            toast('Workspace switch failed. Please try again.', 'error');
            throw error;
        }
    }

    /**
     * List available workspaces for the current user.
     */
    async listWorkspaces(): Promise<WorkspaceMetadata[]> {
        const user = this.getCurrentUser();
        if (!user) return [];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const isMock = typeof window !== 'undefined' && (window as any).__VERSICLE_MOCK_FIRESTORE__;

        if (isMock) {
            const raw = localStorage.getItem('__VERSICLE_WORKSPACES__') || '[]';
            const workspaces: WorkspaceMetadata[] = JSON.parse(raw);
            const filtered = workspaces.filter(ws => !ws.deletedAt);
            if (filtered.length === 0) {
                return [{
                    workspaceId: FirestoreSyncManager.getDefaultWorkspaceId(),
                    name: 'Default',
                    createdAt: Date.now(),
                    schemaVersion: 4
                }];
            }
            return filtered;
        }

        const db = getFirestoreDb();
        if (!db) return [];

        try {
            const workspacesRef = collection(db, `users/${user.uid}/workspaces`);
            const snapshot = await getDocs(workspacesRef);
            return snapshot.docs
                .map(d => d.data() as WorkspaceMetadata)
                .filter(ws => !ws.deletedAt); // Filter out tombstoned workspaces
        } catch (error) {
            logger.error('Failed to list workspaces:', error);
            return [];
        }
    }

    /**
     * Delete a workspace (Tombstone Pattern).
     * Reclaims storage but preserves a tombstone to prevent resurrection.
     */
    public async deleteWorkspace(workspaceId: string): Promise<void> {
        const user = this.getCurrentUser();
        if (!user) throw new Error('Must be authenticated to delete workspace');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const isMock = typeof window !== 'undefined' && (window as any).__VERSICLE_MOCK_FIRESTORE__;

        if (isMock) {
            const uid = user.uid;
            // Mock Deletion logic: update localStorage
            const raw = localStorage.getItem('__VERSICLE_WORKSPACES__') || '[]';
            const workspaces: WorkspaceMetadata[] = JSON.parse(raw);
            const updated = workspaces.map(ws => 
                ws.workspaceId === workspaceId ? { ...ws, deletedAt: Date.now() } : ws
            );
            localStorage.setItem('__VERSICLE_WORKSPACES__', JSON.stringify(updated));

            // Mock tombstone in snapshot storage
            const mockDataStr = localStorage.getItem('versicle_mock_firestore_snapshot') || '{}';
            const mockData = JSON.parse(mockDataStr);
            const path = `users/${uid}/versicle/${workspaceId}`;
            mockData[path] = { isDeleted: true, deletedAt: Date.now() };
            localStorage.setItem('versicle_mock_firestore_snapshot', JSON.stringify(mockData));
            
            logger.info(`[Mock] Workspace deleted and tombstoned: ${workspaceId}`);
            
            // Only clear if it was active
            const activeWorkspaceId = useSyncStore.getState().activeWorkspaceId;
            if (activeWorkspaceId === workspaceId) {
                useSyncStore.getState().setActiveWorkspaceId(null);
            }
            return;
        }

        const db = getFirestoreDb();
        if (!db) throw new Error('Firestore not initialized');

        const uid = user.uid;
        
        // 1. Terminate active connection to prevent resurrection
        this.destroy();

        // 2. Reclaim Storage: Recursively delete the updates subcollection
        // (This happens background, but we await the batches)
        const updatesRef = collection(db, `users/${uid}/versicle/${workspaceId}/updates`);
        let isDeleting = true;

        while (isDeleting) {
            const q = query(updatesRef, limit(500));
            const snapshot = await getDocs(q);

            if (snapshot.size === 0) {
                isDeleting = false;
                break;
            }

            const batch = writeBatch(db);
            snapshot.docs.forEach((docSnap) => {
                batch.delete(docSnap.ref);
            });
            await batch.commit();
        }

        // 3. Plant Tombstone on the root document
        const rootDocRef = doc(db, `users/${uid}/versicle/${workspaceId}`);
        await setDoc(rootDocRef, { isDeleted: true, deletedAt: Date.now() }, { merge: true });

        // 4. Update Metadata Index (Filter it out from future lists)
        const metaDocRef = doc(db, `users/${uid}/workspaces`, workspaceId);
        await setDoc(metaDocRef, { deletedAt: Date.now() }, { merge: true });

        // 5. Sever Local Tie
        useSyncStore.getState().setActiveWorkspaceId(null);
        
        logger.info(`Workspace deleted and tombstoned: ${workspaceId}`);
    }

    // --- Status Management ---

    private setStatus(status: FirestoreSyncStatus): void {
        this.status = status;
        this.statusCallbacks.forEach(cb => cb(status));
        // Always update the UI store directly
        useSyncStore.getState().setFirestoreStatus(status);
    }

    private setAuthStatus(status: FirebaseAuthStatus): void {
        this.authStatus = status;
        this.authCallbacks.forEach(cb => cb(status, this.currentUser));
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const isMock = typeof window !== 'undefined' && (window as any).__VERSICLE_MOCK_FIRESTORE__;
        if (isMock) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const mockUid = (typeof window !== 'undefined' && (window as any).__VERSICLE_MOCK_USER_ID__) || 'mock-user';
            this.currentUser = { uid: mockUid, email: `${mockUid}@example.com` } as User;
            return this.currentUser;
        }

        try {
            const auth = getFirebaseAuth();
            if (auth?.currentUser) {
                this.currentUser = auth.currentUser;
                return this.currentUser;
            }
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

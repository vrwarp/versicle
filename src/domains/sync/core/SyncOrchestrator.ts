/**
 * `SyncOrchestrator` — the sync domain's lifecycle owner
 * (phase4-sync-strangler.md §D2): the only `start()`, the auth→connect
 * sequencing, clean-sync routing, the §D5 quarantine layers 1+3 on the
 * connect path, and the status fan-out onto the typed SyncEvent bus.
 *
 * This is the decomposition of the deleted 1046→862-line
 * FirestoreSyncManager: AuthSession owns auth, ProviderConnection owns the
 * live attachment, WorkspaceService owns the workspace flows; this module
 * owns the order they run in. Everything stateful it touches arrives via
 * the injected deps (src/domains/sync/core/ports.ts) — no store imports in
 * here. Constructed ONCE by the composition root
 * (src/app/sync/createSync.ts), which the `syncInit` boot task drives.
 *
 * Architecture (unchanged from the legacy manager):
 * - y-idb persistence: primary (always active, source of truth offline)
 * - the C3 SyncBackend connection: secondary cloud overlay, active only
 *   when authenticated.
 */
import type { User } from 'firebase/auth';
import { getFirebaseApp } from '@lib/sync/firebase-config';
import type { FirebaseApp } from 'firebase/app';
import * as Y from 'yjs';
import { createLogger } from '@lib/logger';
import type { FirestoreSyncStatus } from '~types/sync';
import type { WorkspaceMetadata } from '~types/workspace';
import { WorkspaceDeletedError } from '~types/errors';
import type { PurgeReport, SyncBackend } from '../backend/SyncBackend';
import { downloadWorkspaceState } from './downloadWorkspaceState';
import { readDocSchemaVersion, readUpdateSchemaVersion } from './quarantine';
import { AuthSession, type AuthChangeCallback } from './AuthSession';
import { ProviderConnection } from './ProviderConnection';
import { WorkspaceService } from '../workspaces/WorkspaceService';
import type { SyncBackendSelection, SyncOrchestratorConfig, SyncOrchestratorDeps } from './ports';

const logger = createLogger('SyncOrchestrator');

type StatusChangeCallback = (status: FirestoreSyncStatus) => void;

const DEFAULT_CONFIG: Required<SyncOrchestratorConfig> = {
  maxWaitFirestoreTime: 2000,
  maxUpdatesThreshold: 50,
};

export class SyncOrchestrator {
  private readonly config: Required<SyncOrchestratorConfig>;
  private backendSelection: SyncBackendSelection;
  private backend: SyncBackend | null = null;
  private status: FirestoreSyncStatus = 'disconnected';
  private statusCallbacks: Set<StatusChangeCallback> = new Set();
  private currentApp: FirebaseApp | null = null;
  private started = false;

  private readonly auth: AuthSession;
  private readonly provider: ProviderConnection;
  private readonly workspaces: WorkspaceService;

  constructor(private readonly deps: SyncOrchestratorDeps) {
    this.config = { ...DEFAULT_CONFIG, ...deps.config };
    this.backendSelection = deps.backendSelection;

    this.auth = new AuthSession({
      events: deps.events,
      getMockSession: () => this.backendSelection.mockSession,
    });

    this.provider = new ProviderConnection({
      events: deps.events,
      doc: deps.doc,
      currentSchemaVersion: deps.currentSchemaVersion,
      onObsolete: deps.onObsolete,
      setStatus: (status) => this.setStatus(status),
    });

    this.workspaces = new WorkspaceService({
      events: deps.events,
      syncState: deps.syncState,
      checkpoints: deps.checkpoints,
      migrationState: deps.migrationState,
      currentSchemaVersion: deps.currentSchemaVersion,
      onObsolete: deps.onObsolete,
      debounceOverrideMs: deps.debounceOverrideMs,
      maxUpdatesThreshold: () => this.config.maxUpdatesThreshold,
      disconnect: () => this.provider.detach(),
      reconnect: (uid) => this.connect(uid),
    });
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
   * Start the orchestrator: evaluate the single enablement gate
   * (`(firebaseEnabled && isConfigured) || mockEnabled` — §D2; the legacy
   * boot path ignored the flag), then run the auth session, which drives
   * connection through handleAuthStateChange. Re-runnable: the settings UI
   * re-initializes after enabling/configuring Firebase without a reload.
   *
   * `bypassEnabledGate` exists for the explicit sign-in path: clicking
   * "Sign in" on a configured-but-not-yet-enabled client must be able to
   * register the auth listener (success then stamps `firebaseEnabled`).
   */
  async start(opts?: { bypassEnabledGate?: boolean }): Promise<void> {
    if (!opts?.bypassEnabledGate && !this.deps.isEnabled()) {
      logger.info('Sync disabled (firebaseEnabled flag off or not configured). Not starting.');
      this.auth.setAuthStatus('signed-out');
      return;
    }
    this.started = true;
    await this.auth.start((user) => {
      this.handleAuthStateChange(user);
    });
  }

  /** Handle Firebase auth state changes (incl. the synthesized mock user). */
  private async handleAuthStateChange(user: User | null): Promise<void> {
    this.auth.noteUser(user);

    if (user) {
      logger.info(`User signed in: ${user.email}`);
      this.auth.setAuthStatus('signed-in');
      // Successful sign-in stamps the persisted enablement flag (the
      // status/email mirrors ride the `auth` SyncEvent → wireSyncEvents).
      this.deps.syncState.setFirebaseEnabled(true);

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
          logger.info(
            `${availableWorkspaces.length} workspaces found. Halting connection until user selection.`
          );
          // Leave activeWorkspaceId as null. The UI must prompt them to choose.
          this.setStatus('disconnected');
          return;
        }
      }

      // Only connect if we have a defined destination.
      // NOT awaited (legacy parity, pinned debt — prep doc item 17).
      this.connect(user.uid);
    } else {
      logger.info('User signed out');
      this.auth.setAuthStatus('signed-out');
      this.provider.detach();
    }
  }

  /**
   * The connect sequence for an authenticated uid (was the manager's
   * `connectFireProvider`): tombstone pre-flight, §D5 layer-1 pre-attach
   * quarantine probe, pre-sync checkpoint, local hydration barrier, §D5
   * layer-3 metadata stamp, then clean-sync routing.
   */
  async connect(uid: string): Promise<void> {
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
      this.deps.syncState.setActiveWorkspaceId(null);
      this.deps.events.emit({ type: 'workspace-tombstoned', workspaceId, context: 'connect' });
      this.setStatus('disconnected');
      throw new WorkspaceDeletedError();
    }

    // Quarantine layer 1 — cheap pre-attach probe (§D5.1): a client
    // that was offline during a fleet migration is locked BEFORE any
    // remote bytes can reach the live doc. Maintained by layer 3 below.
    const workspaceMeta = (await backend.listWorkspaces()).find(
      (ws) => ws.workspaceId === workspaceId
    );
    if (workspaceMeta && workspaceMeta.schemaVersion > this.deps.currentSchemaVersion) {
      logger.warn(
        `Pre-attach quarantine: workspace metadata declares schema v${workspaceMeta.schemaVersion} > supported v${this.deps.currentSchemaVersion}.`
      );
      this.deps.onObsolete(workspaceMeta.schemaVersion);
      return;
    }

    if (this.provider.isAttached()) {
      const currentApp = getFirebaseApp();
      if (currentApp !== this.currentApp) {
        logger.debug('Firebase app changed, reconnecting...');
        this.provider.detach();
      } else {
        logger.debug('Already connected, skipping');
        return;
      }
    }

    // Create a safety checkpoint before connecting (which triggers download)
    try {
      logger.debug('Creating pre-sync checkpoint (if needed)...');
      // Limit to once per 24 hours (86400000 ms)
      const id = await this.deps.checkpoints.createAutomaticCheckpoint('pre-sync', 86400000);
      if (id) {
        logger.info(`Created pre-sync checkpoint #${id}`);
      } else {
        logger.debug('Skipped pre-sync checkpoint (recent one exists)');
      }
    } catch (error) {
      logger.warn('Failed to create pre-sync checkpoint', error);
      // Non-blocking: proceed with sync even if checkpoint fails
    }

    const maxWaitTime = this.deps.debounceOverrideMs() || this.config.maxWaitFirestoreTime;

    await this.deps.whenLocalSynced();

    // Quarantine layer 3 — metadata maintenance (§D5.3): after a local
    // migration the doc's version is ahead of the creation-time stamp;
    // keep the workspace directory tracking it so layer 1 (and the
    // workspace-list version gate) stay honest. Non-blocking: an
    // offline stamp failure just retries on a later connect.
    const docVersion = readDocSchemaVersion(this.deps.doc());
    if (workspaceMeta && docVersion > workspaceMeta.schemaVersion) {
      backend
        .updateWorkspaceMetadata(workspaceId, { schemaVersion: docVersion })
        .then(() => {
          logger.info(
            `Stamped workspace ${workspaceId} metadata: schema v${workspaceMeta.schemaVersion} → v${docVersion}`
          );
        })
        .catch((error) => {
          logger.warn('Failed to stamp workspace metadata schemaVersion', error);
        });
    }

    if (this.deps.isCleanClient()) {
      logger.info('Clean client detected. Checking for cloud data...');
      this.performCleanSync(backend, workspaceId, maxWaitTime).catch((err) => {
        logger.error('Clean sync failed:', err);
        this.setStatus('error');
      });
    } else {
      this.attachProvider(backend, workspaceId, maxWaitTime);
    }
  }

  private async performCleanSync(
    backend: SyncBackend,
    workspaceId: string,
    maxWaitTime: number
  ): Promise<void> {
    this.setStatus('connecting');
    const events = this.deps.events;

    try {
      const hasCloudData = await backend.probeHasData(workspaceId);
      if (!hasCloudData) {
        logger.info('No cloud data found. Client is officially the first device.');
        this.attachProvider(backend, workspaceId, maxWaitTime);
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
      // any byte touches the live doc.
      const incomingVersion = readUpdateSchemaVersion(downloaded);
      if (incomingVersion > this.deps.currentSchemaVersion) {
        logger.warn(
          `Clean-sync quarantine: cloud data is schema v${incomingVersion} > supported v${this.deps.currentSchemaVersion}. Nothing was applied.`
        );
        this.deps.onObsolete(incomingVersion);
        return;
      }

      logger.info('Applying downloaded cloud data to main Y.Doc...');
      Y.applyUpdate(this.deps.doc(), downloaded);

      logger.info('Clean sync complete. Connecting main provider...');
      events.emit({ type: 'clean-sync', phase: 'applied' });

      // Connect the main provider now that the initial load is done
      this.attachProvider(backend, workspaceId, maxWaitTime);
    } catch (error) {
      logger.error('Failed clean sync:', error);
      this.setStatus('error');
      events.emit({ type: 'clean-sync', phase: 'failed' });
    }
  }

  private attachProvider(backend: SyncBackend, workspaceId: string, maxWaitTime: number): void {
    this.provider.attach(backend, workspaceId, {
      maxWaitTimeMs: maxWaitTime,
      maxUpdatesThreshold: this.config.maxUpdatesThreshold,
    });
    if (this.provider.isAttached()) {
      this.currentApp = getFirebaseApp();
    }
  }

  /**
   * Quarantine severing (§D5): called by wireSyncEvents on the `obsolete`
   * SyncEvent. A real provider destroy — zero outbound writes afterwards —
   * not the pre-P4 status-label flip. Idempotent.
   */
  severObsoleteConnection(): void {
    if (this.provider.isAttached()) {
      logger.warn('Obsolete client: destroying provider connection.');
    }
    this.provider.detach();
  }

  /**
   * Sign in with Google. Ensures the auth session is started first: a
   * configured client whose `firebaseEnabled` flag is still off never ran
   * start() at boot (the §D2 gate), but an explicit sign-in click is the
   * enabling act — success stamps the flag via handleAuthStateChange.
   */
  async signIn(): Promise<void> {
    if (!this.started) {
      await this.start({ bypassEnabledGate: true });
    }
    await this.auth.signIn();
  }

  /** Sign out (the auth state change handler disconnects the provider). */
  async signOut(): Promise<void> {
    await this.auth.signOut();
  }

  /** Stop the orchestrator and release every resource (was destroy()). */
  stop(): void {
    this.provider.detach();
    this.auth.stop();
    this.statusCallbacks.clear();
    this.started = false;
    logger.debug('Orchestrator stopped');
  }

  // ── Workspace management (delegated to WorkspaceService) ──────────────────

  getActiveWorkspaceId(): string | null {
    return this.deps.syncState.getActiveWorkspaceId();
  }

  async createWorkspace(name: string): Promise<string> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('Must be signed in to create a workspace');
    return this.workspaces.create(this.getBackend(user.uid), user.uid, name);
  }

  async switchWorkspace(targetWorkspaceId: string): Promise<void> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('Must be signed in to switch workspaces');
    return this.workspaces.switch(this.getBackend(user.uid), targetWorkspaceId);
  }

  async listWorkspaces(): Promise<WorkspaceMetadata[]> {
    const user = this.getCurrentUser();
    if (!user) return [];
    // Tombstoned workspaces are filtered by the backend.
    return this.workspaces.list(this.getBackend(user.uid));
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('Must be authenticated to delete workspace');
    return this.workspaces.delete(this.getBackend(user.uid), workspaceId);
  }

  /** The "Purge deleted workspaces" maintenance action (P4-6). */
  async purgeDeletedWorkspaces(): Promise<PurgeReport> {
    const user = this.getCurrentUser();
    if (!user) throw new Error('Must be authenticated to purge workspaces');
    return this.workspaces.purgeDeleted(this.getBackend(user.uid));
  }

  // ── Status management ──────────────────────────────────────────────────────

  private setStatus(status: FirestoreSyncStatus): void {
    this.status = status;
    this.statusCallbacks.forEach((cb) => cb(status));
    // The useSyncStore mirror is written by the ONE subscriber
    // (wireSyncEvents) off this event — §D3 single-writer rule.
    this.deps.events.emit({ type: 'status', status });
  }

  /** Subscribe to sync status changes; fires immediately with the current. */
  onStatusChange(callback: StatusChangeCallback): () => void {
    this.statusCallbacks.add(callback);
    callback(this.status);
    return () => this.statusCallbacks.delete(callback);
  }

  /** Subscribe to auth status changes; fires immediately with the current. */
  onAuthChange(callback: AuthChangeCallback): () => void {
    return this.auth.onAuthChange(callback);
  }

  // ── Getters ────────────────────────────────────────────────────────────────

  getStatus(): FirestoreSyncStatus {
    return this.status;
  }

  getAuthStatus(): ReturnType<AuthSession['getAuthStatus']> {
    return this.auth.getAuthStatus();
  }

  getCurrentUser(): User | null {
    return this.auth.getCurrentUser();
  }

  isConnected(): boolean {
    return this.status === 'connected';
  }

  isSignedIn(): boolean {
    return this.getAuthStatus() === 'signed-in';
  }

  /**
   * The artifact-lane backend handle for the app-layer ArtifactConsult adapter
   * (shared-ai-cache-design.md §2.4; Phase B). Additive and read-only — it
   * exposes ONLY the `{ backend, workspaceId }` pair the consult needs to call
   * the C3 artifact trio (headArtifact/getArtifact).
   *
   * Returns `null` unless the orchestrator is live on a definite destination:
   * connected AND signed-in (a current user) AND an active workspace selected.
   * The null-gate is deliberate — it ensures the returned backend is bound to
   * the right uid and the path is scoped to the right workspace, so a consult
   * can never read an artifact under the wrong account/workspace (the §2.4/M-7
   * precondition). Adds NO new C3 method (the three sync contract suites stay
   * green); it only re-exposes the existing {@link getBackend} +
   * {@link getActiveWorkspaceId} the connect path already uses.
   */
  getConnectedArtifactBackend(): { backend: SyncBackend; workspaceId: string } | null {
    if (!this.isConnected()) return null;
    const user = this.getCurrentUser();
    if (!user) return null;
    const workspaceId = this.getActiveWorkspaceId();
    if (!workspaceId) return null;
    return { backend: this.getBackend(user.uid), workspaceId };
  }
}

/**
 * Construct an orchestrator over the injected deps. No singleton here: the
 * composition root (src/app/sync/createSync.ts) owns the one production
 * instance (replacing the legacy `FirestoreSyncManager.getInstance()`).
 */
export function createSyncOrchestrator(deps: SyncOrchestratorDeps): SyncOrchestrator {
  return new SyncOrchestrator(deps);
}

/**
 * `WorkspaceService` — create/switch/delete/list over the C3 `SyncBackend`
 * (phase4-sync-strangler.md §D2): absorbs FirestoreSyncManager's workspace
 * flows verbatim, over injected ports (no store imports — the
 * `activeWorkspaceId` reads/writes go through SyncStatePort, the connection
 * hooks come from the orchestrator).
 *
 * `switchWorkspace` is still the legacy multi-stage commit (pre-flight →
 * protected backup → state lock → download → verify → destructive apply →
 * reload). The staged-swap item (§D4) re-orders it onto durable local
 * staging; until then every step here is pinned by the orchestrator
 * characterization + quarantine suites.
 */
import type { WorkspaceMetadata } from '~types/workspace';
import { WorkspaceDeletedError } from '~types/errors';
import { createLogger } from '@lib/logger';
import { generateSecureId } from '@lib/crypto';
import type { SyncBackend } from '../backend/SyncBackend';
import type { SyncEventBus } from '../events';
import { downloadWorkspaceState } from '../core/downloadWorkspaceState';
import { readUpdateSchemaVersion } from '../core/quarantine';
import type { CheckpointsPort, MigrationStatePort, SyncStatePort } from '../core/ports';

const logger = createLogger('WorkspaceService');

export interface WorkspaceServiceDeps {
  events: SyncEventBus;
  syncState: SyncStatePort;
  checkpoints: CheckpointsPort;
  migrationState: MigrationStatePort;
  currentSchemaVersion: number;
  onObsolete: (incomingVersion: number) => void;
  /** Test-flag debounce override in ms; 0 when unset. */
  debounceOverrideMs: () => number;
  maxUpdatesThreshold: () => number;
  // ── Orchestrator hooks (the connection lifecycle stays its property) ──
  /** Sever the live provider connection (createWorkspace reconnect prep). */
  disconnect: () => void;
  /** Re-run the connect sequence for the given uid (after create). */
  reconnect: (uid: string) => Promise<void>;
  /** Legacy real-backend delete semantics: full manager destroy(). */
  stopAll: () => void;
}

export class WorkspaceService {
  constructor(private readonly deps: WorkspaceServiceDeps) {}

  /**
   * Create a new workspace.
   * Flow A: Generates ID, writes metadata to the backend, switches active
   * workspace, reconnects (empty remote = local becomes source of truth).
   */
  async create(backend: SyncBackend, uid: string, name: string): Promise<string> {
    const workspaceId = generateSecureId('ws');

    const metadata: WorkspaceMetadata = {
      workspaceId,
      name,
      createdAt: Date.now(),
      schemaVersion: this.deps.currentSchemaVersion,
    };

    await backend.createWorkspace(metadata);
    logger.info(`Created workspace: ${name} (${workspaceId})`);

    // Update active workspace
    this.deps.syncState.setActiveWorkspaceId(workspaceId);

    // Reconnect with new path (empty remote = local becomes source of truth)
    this.deps.disconnect();
    await this.deps.reconnect(uid);

    return workspaceId;
  }

  /**
   * Switch to an existing workspace using the multi-stage commit process.
   * Flow B: Pre-flight → Backup → State Lock → Hydrate → Apply → Reload.
   */
  async switch(backend: SyncBackend, targetWorkspaceId: string): Promise<void> {
    const { events, syncState, checkpoints, migrationState } = this.deps;

    const currentWorkspaceId = syncState.getActiveWorkspaceId();
    if (targetWorkspaceId === currentWorkspaceId) {
      logger.info('Already on the target workspace, no switch needed');
      return;
    }

    logger.info(`Switching workspace: ${currentWorkspaceId} → ${targetWorkspaceId}`);

    // Step 0: Pre-flight validation
    const isAlive = await backend.isWorkspaceAlive(targetWorkspaceId);
    if (!isAlive) {
      events.emit({
        type: 'workspace-tombstoned',
        workspaceId: targetWorkspaceId,
        context: 'switch',
      });
      throw new WorkspaceDeletedError();
    }

    try {
      // Step 1: Backup current state.
      // Protected: the rolling checkpoint prune must not delete the
      // rollback target while the migration state machine is unresolved.
      logger.info('Creating pre-migration checkpoint...');
      const backupId = await checkpoints.createCheckpoint('pre-migration', { protected: true });
      logger.info(`Pre-migration checkpoint created: #${backupId}`);

      // Step 2: State Lock
      migrationState.setAwaitingConfirmation(targetWorkspaceId, backupId);

      // Step 3: Update active workspace ID (persists across reload)
      syncState.setActiveWorkspaceId(targetWorkspaceId);

      // Step 4: Hydrate remote state into temp Y.Doc
      logger.info('Downloading remote workspace state...');
      events.emit({ type: 'switch', phase: 'downloading' });

      const maxWaitTime = this.deps.debounceOverrideMs() || 2000;

      // Legacy switch behavior: a synchronous connect failure rejects
      // (routed to the non-destructive catch below); a timeout resolves
      // with whatever synced.
      const remoteBlob = await downloadWorkspaceState(backend, targetWorkspaceId, {
        maxWaitTimeMs: maxWaitTime,
        maxUpdatesThreshold: this.deps.maxUpdatesThreshold(),
        timeoutMs: 15000,
        onAttachError: 'reject',
      });

      // Step 4b: Verify — quarantine layer 1 for the switch path
      // (§D4 step 4 / §D5.1): scratch-check the downloaded state's
      // version BEFORE the destructive apply. The throw routes to the
      // non-destructive catch below (state machine cleared, id
      // reverted — the download is a pure read).
      const incomingVersion = readUpdateSchemaVersion(remoteBlob);
      if (incomingVersion > this.deps.currentSchemaVersion) {
        this.deps.onObsolete(incomingVersion);
        throw new Error(
          `Workspace ${targetWorkspaceId} requires schema v${incomingVersion}; this app supports v${this.deps.currentSchemaVersion}`
        );
      }

      // Step 5: Apply & Reload
      logger.info('Applying remote state and reloading...');
      try {
        await checkpoints.applyRemoteState(remoteBlob);
        // applyRemoteState triggers window.location.reload()
      } catch (applyError) {
        // The destructive phase may already have wiped local
        // persistence — do NOT clear the migration state here.
        // Transition to RESTORING_BACKUP so the boot interceptor
        // restores the pinned pre-migration checkpoint on reload.
        logger.error('Failed to apply remote state, rolling back to backup:', applyError);
        migrationState.setRestoringBackup();
        syncState.setActiveWorkspaceId(currentWorkspaceId);
        events.emit({ type: 'switch', phase: 'failed-rolling-back' });
        window.location.reload();
        return;
      }
    } catch (error) {
      logger.error('Workspace switch failed:', error);
      // Clean up migration state on failure (nothing destructive has
      // run before Step 5, so local IDB is genuinely untouched here)
      migrationState.clear();
      // Revert workspace ID
      syncState.setActiveWorkspaceId(currentWorkspaceId);
      events.emit({ type: 'switch', phase: 'failed-aborted' });
      throw error;
    }
  }

  /** List available workspaces (tombstoned filtered by the backend). */
  async list(backend: SyncBackend): Promise<WorkspaceMetadata[]> {
    return backend.listWorkspaces();
  }

  /**
   * Delete a workspace (Tombstone Pattern).
   * Reclaims storage but preserves a tombstone to prevent resurrection.
   */
  async delete(backend: SyncBackend, workspaceId: string): Promise<void> {
    // Legacy real/mock divergence preserved as backend data, not
    // branches — see LegacyDeleteBehavior (unified by the honest-delete
    // item, P4-6).
    if (backend.legacyDeleteBehavior.destroyConnectionFirst) {
      // Terminate the active connection to prevent resurrection
      this.deps.stopAll();
    }

    await backend.deleteWorkspace(workspaceId);

    // Sever local tie
    if (backend.legacyDeleteBehavior.severActiveUnconditionally) {
      this.deps.syncState.setActiveWorkspaceId(null);
    } else {
      const activeWorkspaceId = this.deps.syncState.getActiveWorkspaceId();
      if (activeWorkspaceId === workspaceId) {
        this.deps.syncState.setActiveWorkspaceId(null);
      }
    }

    logger.info(`Workspace deleted and tombstoned: ${workspaceId}`);
  }
}

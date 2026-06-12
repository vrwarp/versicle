/**
 * `WorkspaceService` — create/switch/delete/list over the C3 `SyncBackend`
 * (phase4-sync-strangler.md §D2): absorbs FirestoreSyncManager's workspace
 * flows verbatim, over injected ports (no store imports — the
 * `activeWorkspaceId` reads/writes go through SyncStatePort, the connection
 * hooks come from the orchestrator).
 *
 * `switchWorkspace` is the §D4 staged swap: pre-flight → protected backup →
 * download (pure read) → verify on scratch → durable staging → STAGED
 * commit → reload. The destructive apply happens on the NEXT boot, in the
 * migration interceptor's STAGED arm (stagedSwap.applyStagedSwap), which is
 * idempotent and crash-resumable. Nothing destructive — and no state-machine
 * engagement — happens before the downloaded state has been verified and
 * durably staged.
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
import { stageWorkspaceState, pauseIfArmed } from './stagedSwap';

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
   * Switch to an existing workspace — the §D4 staged swap.
   *
   * Everything before the STAGED commit is a PURE READ of live state: no
   * state-machine engagement, no `activeWorkspaceId` write, no wipe. (The
   * legacy flow locked the state machine and flipped the id BEFORE the
   * download — a crash during download left a dangling AWAITING state; the
   * new ordering shrinks the pre-commit crash window to zero.) The
   * destructive apply runs on the next boot, idempotently, from durable
   * staging (stagedSwap.applyStagedSwap).
   */
  async switch(backend: SyncBackend, targetWorkspaceId: string): Promise<void> {
    const { events, syncState, checkpoints, migrationState } = this.deps;

    const currentWorkspaceId = syncState.getActiveWorkspaceId();
    if (targetWorkspaceId === currentWorkspaceId) {
      logger.info('Already on the target workspace, no switch needed');
      return;
    }

    logger.info(`Switching workspace: ${currentWorkspaceId} → ${targetWorkspaceId}`);

    // Step 1: Pre-flight validation (unchanged).
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
      // Step 2: Backup current state (unchanged).
      // Protected: the rolling checkpoint prune must not delete the
      // rollback target while the migration state machine is unresolved.
      logger.info('Creating pre-migration checkpoint...');
      const backupId = await checkpoints.createCheckpoint('pre-migration', { protected: true });
      logger.info(`Pre-migration checkpoint created: #${backupId}`);

      // Step 3: Download — a pure read into a temp doc. A synchronous
      // connect failure rejects (routed to the non-destructive catch
      // below); a timeout resolves with whatever synced (legacy behavior,
      // pinned by the characterization suite).
      logger.info('Downloading remote workspace state...');
      events.emit({ type: 'switch', phase: 'downloading' });

      const maxWaitTime = this.deps.debounceOverrideMs() || 2000;
      const remoteBlob = await downloadWorkspaceState(backend, targetWorkspaceId, {
        maxWaitTimeMs: maxWaitTime,
        maxUpdatesThreshold: this.deps.maxUpdatesThreshold(),
        timeoutMs: 15000,
        onAttachError: 'reject',
      });

      // Step 4: Verify on a scratch doc — quarantine layer 1 for the
      // switch path (§D4 step 4 / §D5.1): the schema-version gate runs
      // BEFORE anything is staged or applied. A garbage blob throws here
      // (same non-destructive catch).
      events.emit({ type: 'switch', phase: 'verifying' });
      const incomingVersion = readUpdateSchemaVersion(remoteBlob);
      if (incomingVersion > this.deps.currentSchemaVersion) {
        this.deps.onObsolete(incomingVersion);
        throw new Error(
          `Workspace ${targetWorkspaceId} requires schema v${incomingVersion}; this app supports v${this.deps.currentSchemaVersion}`
        );
      }

      // Step 5: Stage durably. Still non-destructive — the staging
      // database is scratch space until the state machine commits.
      await stageWorkspaceState(remoteBlob);
      events.emit({ type: 'switch', phase: 'staged' });

      // Step 6: THE commit point. From here the switch is resolvable on
      // every subsequent boot: STAGED → idempotent apply → the existing
      // AWAITING_CONFIRMATION flow. Order per §D4: state machine first —
      // the apply reconciles `activeWorkspaceId` itself, so a kill between
      // these lines cannot strand the id.
      migrationState.setStaged(
        targetWorkspaceId,
        backupId,
        currentWorkspaceId ?? undefined
      );
      syncState.setActiveWorkspaceId(targetWorkspaceId);

      await pauseIfArmed('swap:staged');
      window.location.reload();
    } catch (error) {
      logger.error('Workspace switch failed:', error);
      // Nothing destructive has run and the state machine was never
      // engaged (the STAGED commit is the last fallible step), so abort
      // is a pure cleanup: drop any partial state-machine write and keep
      // the user exactly where they were.
      migrationState.clear();
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

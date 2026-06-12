import { checkpoints } from '@data/repos/checkpoints';
import * as Y from 'yjs';
import { getYDoc, getYjsPersistence, disconnectYjs } from '@store/yjs-provider';
import type { SyncCheckpoint } from '~types/sync';
import {
  captureDoc,
  validateSnapshot,
  applySnapshot,
  deleteYjsDatabase,
} from '@data/snapshot/YjsSnapshotService';
import { isStorageSupported } from '@lib/sync/support';
import { createLogger } from '@lib/logger';
import { MigrationStateService } from '../workspaces/MigrationStateService';
import { withSwapLock } from '../workspaces/stagedSwap';

const logger = createLogger('CheckpointService');

/**
 * The shutdown handle the destructive operations take (§D7 inversion): the
 * legacy module imported FirestoreSyncManager only to `destroy()` it before
 * wiping persistence — a circular import (the manager imported this module
 * for its pre-sync/pre-migration checkpoints). Callers that have the
 * orchestrator pass the handle instead: the boot interceptor and
 * RecoverySettingsTab via `stopSyncConnections` (app/sync/createSync.ts),
 * WorkspaceService via its injected checkpoints port.
 */
export interface DestructiveRestoreOptions {
  /** Sever cloud sync before the local wipe; failures are non-blocking. */
  pauseSync?: () => void | Promise<void>;
  /**
   * Revert the persisted active-workspace tie during a rollback whose
   * migration state carries `previousWorkspaceId` (staged swaps, P4-5).
   * Injected by the boot interceptor — domains/sync stays store-free.
   */
  setActiveWorkspaceId?: (id: string) => void;
}

/**
 * Service to manage synchronization checkpoints.
 * Handles creation, restoration, and pruning of checkpoints.
 *
 * NOTE on the `@store/yjs-provider` import: domains/ is store-free by rule
 * (depcruise `domains-no-store`), but the live doc/persistence handles are
 * that rule's one named carve-out — this module relocated as a PURE MOVE
 * (phase4-sync-strangler.md §D7). The staged swap (§D4) moved the
 * switch-path destructive apply into `stagedSwap.ts` (fully injected); the
 * checkpoint capture/restore here still legitimately needs the live doc.
 */
export class CheckpointService {
  /**
   * Captures the current Yjs state as a binary update.
   *
   * Pass `options.protected: true` to pin the checkpoint against the rolling
   * prune (used for pre-migration backups that an in-flight workspace switch
   * may need to roll back to). Only the latest protected checkpoint stays
   * pinned: creating a new protected checkpoint returns any older protected
   * ones to the normal pruning rotation, so they cannot accumulate forever.
   * (Abandoned pre-migration backups are also aged out by the 7-day zombie
   * cleanup at boot, which deletes by ID and is unaffected by the flag.)
   */
  static async createCheckpoint(trigger: string, options?: { protected?: boolean }): Promise<number> {
    const stateBlob = captureDoc(getYDoc());

    // The IDB transaction — including the supersede-older-protected and
    // prune-skip-protected invariants, both inside ONE gated transaction —
    // lives in the checkpoints repo (P3-10).
    return checkpoints.add({
      timestamp: Date.now(),
      trigger,
      blob: stateBlob,
      size: Math.round(stateBlob.byteLength / 1024) || 1, // Min 1KB display
    }, options);
  }

  /**
   * Creates a checkpoint only if the last checkpoint with the same trigger
   * was created more than `intervalMs` ago.
   * Returns the new checkpoint ID if created, or null if skipped.
   */
  static async createAutomaticCheckpoint(trigger: string, intervalMs: number): Promise<number | null> {
    const lastCheckpoint = await checkpoints.latestByTrigger(trigger);

    if (lastCheckpoint) {
      const timeSinceLast = Date.now() - lastCheckpoint.timestamp;
      if (timeSinceLast < intervalMs) {
        return null; // Skip checkpoint
      }
    }

    return this.createCheckpoint(trigger);
  }

  /** Run the injected sync-shutdown handle; never blocks the restore. */
  private static async pauseSync(
    opts: DestructiveRestoreOptions | undefined,
    why: string
  ): Promise<void> {
    if (!opts?.pauseSync) return;
    try {
      await opts.pauseSync();
      logger.info(`Sync disconnected for ${why}`);
    } catch (e) {
      logger.warn(`Failed to disconnect sync during ${why}`, e);
    }
  }

  /**
   * Destructive Restore: Clears current Yjs types and applies snapshot.
   *
   * Validate-before-destroy: the blob is proven to be an applicable Yjs
   * update (scratch-doc dry-run, `validateSnapshot`) BEFORE anything
   * destructive runs, so a corrupted checkpoint can never wipe live data.
   *
   * Clears the migration state machine only AFTER the snapshot has been
   * fully written back. Clearing it earlier would let a failed or
   * interrupted rollback silently boot into the target workspace; keeping
   * it set means a crash mid-restore retries the rollback on next boot.
   *
   * The hard-reset path runs whenever IndexedDB exists — INCLUDING at boot,
   * where no live persistence binding has been constructed yet (the
   * RESTORING_BACKUP interceptor arm precedes `startYjsPersistence`; the
   * wipe is then a plain database deletion). Pre-P4-5 this branched on the
   * live binding alone, so a boot-time rollback silently fell into the
   * in-memory soft path: nothing was persisted, the state machine was
   * cleared anyway, and the next manual reload booted into the TARGET
   * workspace's data — a P1b boot-sequencing regression the staged-swap
   * crash-resume suite now pins closed. The destructive section also runs
   * under the cross-tab swap lock (§D4), like the staged apply.
   */
  static async restoreCheckpoint(id: number, opts?: DestructiveRestoreOptions): Promise<void> {
    const checkpoint = await checkpoints.get(id);
    if (!checkpoint || !checkpoint.blob) throw new Error('Checkpoint corrupted');

    // 0a. Prove the blob applies cleanly BEFORE any destructive step.
    validateSnapshot(checkpoint.blob);

    // 0b. Disconnect cloud sync to prevent concurrent modifications during
    // restore (injected handle — §D7 inversion).
    await this.pauseSync(opts, 'restore');

    const persistence = getYjsPersistence();
    if (persistence || isStorageSupported()) {
      await withSwapLock(async () => {
        logger.info('Performing Hard Reset restore...');
        if (persistence) {
          // 1. Wipe existing persistence
          await persistence.clearData();

          // 2. Disconnect current persistence to close IDB connections and
          // release locks
          await disconnectYjs();
        } else {
          // Boot path: no live binding — wipe the database directly.
          await deleteYjsDatabase();
        }

        // 3. Write the snapshot durably. applySnapshot resolves only after
        // the transaction has COMMITTED (vendored y-idb writeSnapshot through
        // the cross-context write gate) — this replaces the temp-doc +
        // temp-IndexeddbPersistence + whenSynced dance, which was durable
        // only via IDBDatabase.close() waiting out in-flight transactions.
        await applySnapshot(checkpoint.blob);

        // 4. The restored data is durable, but the active-workspace tie may
        // still point at the abandoned switch target — revert it BEFORE the
        // state machine clears (a crash between these lines retries the
        // whole rollback; previousWorkspaceId is absent on states written by
        // pre-P4-5 clients, which keep legacy behavior).
        const migrationState = MigrationStateService.getState();
        if (migrationState?.previousWorkspaceId && opts?.setActiveWorkspaceId) {
          opts.setActiveWorkspaceId(migrationState.previousWorkspaceId);
        }

        // 5. Restore is fully persisted — only now is it safe to clear the
        // migration state machine (no-op outside a workspace-switch rollback).
        MigrationStateService.clear();
      });

      logger.info('Hard Reset complete. Reloading...');
      window.location.reload();
    } else {
      logger.warn('Yjs Persistence not active. Falling back to In-Memory Soft Restore (Unsafe).');
      // Atomic transaction to swap state (Fallback)
      const liveDoc = getYDoc();
      liveDoc.transact(() => {
        const allKeys = Array.from(liveDoc.share.keys());

        for (const key of allKeys) {
          const type = liveDoc.share.get(key);

          if (type instanceof Y.Map) {
            Array.from(type.keys()).forEach(k => type.delete(k));
          } else if (type instanceof Y.Array) {
            type.delete(0, type.length);
          } else if (type instanceof Y.XmlFragment) {
            type.delete(0, type.length);
          } else if (type instanceof Y.Text) {
            type.delete(0, type.length);
          }
        }

        Y.applyUpdate(liveDoc, checkpoint.blob);
      }, 'restore-checkpoint');

      // Restore applied — safe to clear the migration state machine.
      MigrationStateService.clear();
    }
  }

  // NOTE: the legacy `applyRemoteState` (wipe main + write a downloaded
  // network blob + reload, called mid-switch) was ABSORBED into the staged
  // swap (phase4-sync-strangler.md §D4): the switch path now stages the
  // verified blob durably (stagedSwap.stageWorkspaceState) and the boot
  // interceptor's STAGED arm performs the destructive apply idempotently
  // (stagedSwap.applyStagedSwap). Its durability/validate-before-destroy
  // pins moved to stagedSwap.test.ts ('regression: …' blocks, ledger rule 8).

  /**
   * Deletes a specific checkpoint by ID.
   * Used to clean up migration backups after successful switch.
   */
  static async deleteCheckpoint(id: number): Promise<void> {
    await checkpoints.remove(id);
    logger.info(`Deleted checkpoint #${id}`);
  }

  /**
   * Retrieves all available checkpoints, sorted by timestamp descending.
   */
  static async listCheckpoints(): Promise<SyncCheckpoint[]> {
    return checkpoints.list();
  }

  /**
   * Retrieves a specific checkpoint by ID.
   */
  static async getCheckpoint(id: number): Promise<SyncCheckpoint | undefined> {
    return checkpoints.get(id);
  }
}

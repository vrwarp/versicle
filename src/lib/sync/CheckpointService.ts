import { checkpoints } from '@data/repos/checkpoints';
import * as Y from 'yjs';
import { getYDoc, getYjsPersistence, disconnectYjs } from '@store/yjs-provider';
import type { SyncCheckpoint } from '~types/db';
import { captureDoc, validateSnapshot, applySnapshot } from '@data/snapshot/YjsSnapshotService';
import { createLogger } from '../logger';
import { getFirestoreSyncManager } from './FirestoreSyncManager';
import { MigrationStateService } from './MigrationStateService';

const logger = createLogger('CheckpointService');

/**
 * Service to manage synchronization checkpoints.
 * Handles creation, restoration, and pruning of checkpoints.
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
   */
  static async restoreCheckpoint(id: number): Promise<void> {
    const checkpoint = await checkpoints.get(id);
    if (!checkpoint || !checkpoint.blob) throw new Error('Checkpoint corrupted');

    // 0a. Prove the blob applies cleanly BEFORE any destructive step.
    validateSnapshot(checkpoint.blob);

    // 0b. Disconnect cloud sync to prevent concurrent modifications during restore
    try {
      getFirestoreSyncManager().destroy();
      logger.info('Firestore disconnected for restore');
    } catch (e) {
      logger.warn('Failed to disconnect Firestore during restore', e);
    }

    const persistence = getYjsPersistence();
    if (persistence) {
      logger.info('Performing Hard Reset restore...');
      // 1. Wipe existing persistence
      await persistence.clearData();

      // 2. Disconnect current persistence to close IDB connections and release locks
      await disconnectYjs();

      // 3. Write the snapshot durably. applySnapshot resolves only after
      // the transaction has COMMITTED (vendored y-idb writeSnapshot through
      // the cross-context write gate) — this replaces the temp-doc +
      // temp-IndexeddbPersistence + whenSynced dance, which was durable
      // only via IDBDatabase.close() waiting out in-flight transactions.
      await applySnapshot(checkpoint.blob);

      // 4. Restore is fully persisted — only now is it safe to clear the
      // migration state machine (no-op outside a workspace-switch rollback).
      MigrationStateService.clear();

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

  /**
   * Applies a downloaded remote state vector to the primary IDB persistence.
   * Validates the blob, destroys existing data, writes the new state
   * durably, and triggers a reload. Used during workspace context switching.
   */
  static async applyRemoteState(remoteBlob: Uint8Array): Promise<void> {
    // 0a. Prove the blob applies cleanly BEFORE any destructive step.
    validateSnapshot(remoteBlob);

    // 0b. Disconnect cloud sync to prevent concurrent modifications
    try {
      getFirestoreSyncManager().destroy();
      logger.info('Firestore disconnected for remote state application');
    } catch (e) {
      logger.warn('Failed to disconnect Firestore during remote state apply', e);
    }

    const persistence = getYjsPersistence();
    if (persistence) {
      logger.info('Applying remote state via Hard Reset...');
      // 1. Wipe existing persistence
      await persistence.clearData();

      // 2. Disconnect current persistence to close IDB connections and release locks
      await disconnectYjs();

      // 3. Write the remote state durably (commit-awaited; see
      // restoreCheckpoint step 3 for why this replaced the temp-provider
      // dance).
      await applySnapshot(remoteBlob);

      logger.info('Remote state applied. Reloading...');
      window.location.reload();
    } else {
      logger.error('Cannot apply remote state: Yjs Persistence not active.');
      throw new Error('Yjs Persistence not active. Cannot apply remote state.');
    }
  }

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

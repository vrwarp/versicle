import { getDB } from '../../db/db';
import * as Y from 'yjs';
import { getYDoc, getYjsPersistence, disconnectYjs } from '../../store/yjs-provider';
import type { SyncCheckpoint } from '../../types/db';
import { IndexeddbPersistence } from 'y-idb';
import { createLogger } from '../logger';
import { getFirestoreSyncManager } from './FirestoreSyncManager';
import { MigrationStateService } from './MigrationStateService';

const logger = createLogger('CheckpointService');
const CHECKPOINT_LIMIT = 10;

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
    const stateBlob = Y.encodeStateAsUpdate(getYDoc());
    const db = await getDB();

    // SyncCheckpoint has 'id', 'timestamp', 'blob', 'size', 'trigger', 'protected'.
    // id is auto-incremented, so we cast to any to satisfy TS or Omit it.
    const checkpoint = {
      timestamp: Date.now(),
      trigger,
      blob: stateBlob,
      size: Math.round(stateBlob.byteLength / 1024) || 1, // Min 1KB display
      ...(options?.protected ? { protected: true } : {})
    };

    const tx = db.transaction('checkpoints', 'readwrite');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const id = await tx.store.add(checkpoint as any);

    // Supersede older protected checkpoints: only one migration can be in
    // flight at a time, so only the newest protected checkpoint stays pinned.
    if (options?.protected) {
      let cursor = await tx.store.openCursor();
      while (cursor) {
        if (cursor.value?.protected === true && cursor.primaryKey !== id) {
          const unprotected = { ...cursor.value };
          delete unprotected.protected;
          await cursor.update(unprotected);
          logger.info(`Unprotected superseded checkpoint #${cursor.primaryKey}`);
        }
        cursor = await cursor.continue();
      }
    }

    // Prune old checkpoints
    const count = await tx.store.count();
    if (count > CHECKPOINT_LIMIT) {
      // Get the oldest keys
      // Since keys are auto-incrementing integers, the smallest keys are the oldest.
      // Protected checkpoints (in-flight migration backups) are never pruned;
      // records persisted before the flag existed are treated as unprotected.
      let deleted = 0;
      let cursor = await tx.store.openCursor();
      while (cursor && deleted < count - CHECKPOINT_LIMIT) {
        if (cursor.value?.protected !== true) {
          await cursor.delete();
          deleted++;
        }
        cursor = await cursor.continue();
      }
    }

    await tx.done;
    return id as number;
  }

  /**
   * Creates a checkpoint only if the last checkpoint with the same trigger
   * was created more than `intervalMs` ago.
   * Returns the new checkpoint ID if created, or null if skipped.
   */
  static async createAutomaticCheckpoint(trigger: string, intervalMs: number): Promise<number | null> {
    const db = await getDB();
    const checkpoints = await db.getAll('checkpoints');
    const lastCheckpoint = checkpoints
      .filter(cp => cp.trigger === trigger)
      .sort((a, b) => b.timestamp - a.timestamp)[0];

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
   * Clears the migration state machine only AFTER the snapshot has been
   * fully written back. Clearing it earlier would let a failed or
   * interrupted rollback silently boot into the target workspace; keeping
   * it set means a crash mid-restore retries the rollback on next boot.
   */
  static async restoreCheckpoint(id: number): Promise<void> {
    const db = await getDB();
    const checkpoint = await db.get('checkpoints', id);
    if (!checkpoint || !checkpoint.blob) throw new Error('Checkpoint corrupted');

    // 0. Disconnect cloud sync to prevent concurrent modifications during restore
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

      // 3. Create a temporary Doc/Persistence to write the snapshot to IDB
      // We do this in a clean environment to ensure no in-memory state leaks
      const tempDoc = new Y.Doc();
      Y.applyUpdate(tempDoc, checkpoint.blob);

      const tempProvider = new IndexeddbPersistence('versicle-yjs', tempDoc);

      // Wait for it to write to IDB
      await tempProvider.whenSynced;

      // 4. Cleanup
      await tempProvider.destroy();
      tempDoc.destroy();

      // 5. Restore is fully persisted — only now is it safe to clear the
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
   * Destroys existing data, writes the new state, and triggers a reload.
   * Used during workspace context switching.
   */
  static async applyRemoteState(remoteBlob: Uint8Array): Promise<void> {
    // 0. Disconnect cloud sync to prevent concurrent modifications
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

      // 3. Write remote state to IDB via temp Doc
      const tempDoc = new Y.Doc();
      Y.applyUpdate(tempDoc, remoteBlob);

      const tempProvider = new IndexeddbPersistence('versicle-yjs', tempDoc);
      await tempProvider.whenSynced;

      // 4. Cleanup and reload
      await tempProvider.destroy();
      tempDoc.destroy();

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
    const db = await getDB();
    await db.delete('checkpoints', id);
    logger.info(`Deleted checkpoint #${id}`);
  }

  /**
   * Retrieves all available checkpoints, sorted by timestamp descending.
   */
  static async listCheckpoints(): Promise<SyncCheckpoint[]> {
    const db = await getDB();
    const checkpoints = await db.getAll('checkpoints');
    return checkpoints.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Retrieves a specific checkpoint by ID.
   */
  static async getCheckpoint(id: number): Promise<SyncCheckpoint | undefined> {
    const db = await getDB();
    return db.get('checkpoints', id);
  }
}

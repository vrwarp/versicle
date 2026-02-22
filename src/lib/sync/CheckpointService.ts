import { getDB } from '../../db/db';
import * as Y from 'yjs';
import { yDoc, yjsPersistence, disconnectYjs } from '../../store/yjs-provider';
import type { SyncCheckpoint } from '../../types/db';
import { IndexeddbPersistence } from 'y-indexeddb';

const CHECKPOINT_LIMIT = 10;

/**
 * Service to manage synchronization checkpoints.
 * Handles creation, restoration, and pruning of checkpoints.
 */
export class CheckpointService {
  /**
   * Captures the current Yjs state as a binary update.
   */
  static async createCheckpoint(trigger: string): Promise<number> {
    const stateBlob = Y.encodeStateAsUpdate(yDoc);
    const db = await getDB();

    // SyncCheckpoint has 'id', 'timestamp', 'blob', 'size', 'trigger'.
    // id is auto-incremented, so we cast to any to satisfy TS or Omit it.
    const checkpoint = {
      timestamp: Date.now(),
      trigger,
      blob: stateBlob,
      size: Math.round(stateBlob.byteLength / 1024) || 1 // Min 1KB display
    };

    const tx = db.transaction('checkpoints', 'readwrite');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const id = await tx.store.add(checkpoint as any);

    // Prune old checkpoints
    const count = await tx.store.count();
    if (count > CHECKPOINT_LIMIT) {
      // Get the oldest keys
      // Since keys are auto-incrementing integers, the smallest keys are the oldest.
      let deleted = 0;
      let cursor = await tx.store.openCursor();
      while (cursor && deleted < count - CHECKPOINT_LIMIT) {
        await cursor.delete();
        deleted++;
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
   * Destructive Restore: Clears current persistence and applies snapshot.
   *
   * WARNING: This performs a full database wipe and restore.
   * The application MUST be reloaded after this completes.
   */
  static async restoreCheckpoint(id: number): Promise<void> {
    const db = await getDB();
    const checkpoint = await db.get('checkpoints', id);
    if (!checkpoint || !checkpoint.blob) throw new Error('Checkpoint corrupted');

    // 1. Clear existing persistence and disconnect
    // We clear data first, then disconnect to ensure no pending updates overwrite it.
    if (yjsPersistence) {
      await yjsPersistence.clearData();
      await disconnectYjs();
    }

    // 2. Create isolated YDoc and Persistence to write the snapshot as fresh state
    const tempDoc = new Y.Doc();
    Y.applyUpdate(tempDoc, checkpoint.blob);

    // Write to the same store name 'versicle-yjs'
    const tempPersistence = new IndexeddbPersistence('versicle-yjs', tempDoc);

    // 3. Wait for temp persistence to save
    await new Promise<void>((resolve) => {
      // IndexeddbPersistence saves updates immediately, but we wait for 'synced' to ensure connection
      tempPersistence.once('synced', () => {
        // Add a small buffer for write completion just in case
        setTimeout(resolve, 500);
      });
    });

    tempPersistence.destroy();
    tempDoc.destroy();
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

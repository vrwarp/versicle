import { getDB } from '../../db/db';
import type { SyncCheckpoint, SyncManifest } from '../../types/db';

const CHECKPOINT_LIMIT = 10;

/**
 * Service to manage synchronization checkpoints.
 * Handles creation, restoration, and pruning of checkpoints.
 */
export class CheckpointService {
  /**
   * Creates a new checkpoint from the current SyncManifest.
   * Prunes old checkpoints if the limit is exceeded.
   *
   * @param manifest The SyncManifest to snapshot.
   * @param trigger The reason for creating the checkpoint (e.g., 'pre-sync', 'manual').
   * @returns The ID of the created checkpoint.
   */
  static async createCheckpoint(manifest: SyncManifest, trigger: string): Promise<number> {
    const db = await getDB();
    const checkpoint: Omit<SyncCheckpoint, 'id'> = {
      timestamp: Date.now(),
      manifest,
      trigger,
    };

    // Use a transaction to ensure atomicity of add and prune
    const tx = db.transaction('user_checkpoints', 'readwrite');
    const store = tx.objectStore('user_checkpoints');
    const id = await store.add(checkpoint as SyncCheckpoint); // ID is auto-incremented

    // Prune old checkpoints
    const count = await store.count();
    if (count > CHECKPOINT_LIMIT) {
      // Get the oldest keys
      // Since keys are auto-incrementing integers, the smallest keys are the oldest.
      // We need to delete (count - CHECKPOINT_LIMIT) items.
      // idb doesn't have a direct "limit" on getAllKeys, so we might need to iterate or assume keys.
      // A cursor is safest.
      let deleted = 0;
      const numberToDelete = count - CHECKPOINT_LIMIT;
      let cursor = await store.openCursor();

      while (cursor && deleted < numberToDelete) {
        await cursor.delete();
        deleted++;
        cursor = await cursor.continue();
      }
    }

    await tx.done;
    return id as number;
  }

  /**
   * Retrieves all available checkpoints, sorted by timestamp descending.
   */
  static async listCheckpoints(): Promise<SyncCheckpoint[]> {
    const db = await getDB();
    const checkpoints = await db.getAll('user_checkpoints');
    return checkpoints.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Retrieves a specific checkpoint by ID.
   */
  static async getCheckpoint(id: number): Promise<SyncCheckpoint | undefined> {
    const db = await getDB();
    return db.get('user_checkpoints', id);
  }

  /**
   * Restores a checkpoint by returning its manifest.
   * NOTE: The actual application state restoration logic should be handled by the SyncManager
   * or a higher-level orchestrator that knows how to write the manifest back to the DB.
   * This method serves as a retrieval helper.
   */
  static async restoreCheckpoint(id: number): Promise<SyncManifest | undefined> {
    const checkpoint = await this.getCheckpoint(id);
    return checkpoint?.manifest;
  }
}

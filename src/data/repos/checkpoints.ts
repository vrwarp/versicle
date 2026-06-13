/**
 * `checkpoints` repository — local Yjs recovery checkpoints (Phase 3, D5.5
 * in plan/overhaul/prep/phase3-storage-gateway.md; carved LAST, after the
 * Phase 2 checkpoint work settled). Only the IDB access moved here:
 * CheckpointService itself lives in domains/sync/checkpoints (P4-3; its
 * legacy FirestoreSyncManager import cycle was cut by the §D7 inversion).
 */
import { getConnection } from '../connection';
import { runExclusiveIdbWrite, write } from '../write-gate';
import { createLogger } from '@lib/logger';
import type { SyncCheckpointRow } from '../rows/app';

const logger = createLogger('CheckpointsRepo');

/** Rolling cap on unprotected checkpoints (the prune skips protected rows). */
const CHECKPOINT_LIMIT = 10;

class CheckpointsRepo {
  /**
   * Persist a checkpoint. Owns BOTH protected-flag invariants inside ONE
   * gated transaction (moved verbatim from CheckpointService.createCheckpoint):
   *
   * - Supersede-older-protected: only one migration can be in flight at a
   *   time, so only the NEWEST protected checkpoint stays pinned — older
   *   protected rows are returned to the normal pruning rotation.
   * - Prune-skip-protected: when over CHECKPOINT_LIMIT, oldest rows are
   *   deleted first but protected rows are never pruned (rows persisted
   *   before the flag existed are treated as unprotected).
   *
   * The cursor awaits keep the transaction active via continue() requests
   * (not the inactive-across-await WebKit trap), and the whole transaction
   * holds the cross-context write gate.
   */
  async add(
    record: Omit<SyncCheckpointRow, 'id' | 'protected'>,
    opts?: { protected?: boolean },
  ): Promise<number> {
    const db = await getConnection();
    return runExclusiveIdbWrite(async () => {
      const checkpoint = {
        ...record,
        ...(opts?.protected ? { protected: true } : {}),
      };

      const tx = db.transaction('checkpoints', 'readwrite');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const id = await tx.store.add(checkpoint as any);

      // Supersede older protected checkpoints: only one migration can be in
      // flight at a time, so only the newest protected checkpoint stays pinned.
      if (opts?.protected) {
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
    }, 'checkpoints.add');
  }

  /** All checkpoints, sorted by timestamp descending. */
  async list(): Promise<SyncCheckpointRow[]> {
    const db = await getConnection();
    const checkpoints = await db.getAll('checkpoints');
    return checkpoints.sort((a, b) => b.timestamp - a.timestamp);
  }

  async get(id: number): Promise<SyncCheckpointRow | undefined> {
    const db = await getConnection();
    return db.get('checkpoints', id);
  }

  async remove(id: number): Promise<void> {
    await write(['checkpoints'], (tx) => {
      tx.objectStore('checkpoints').delete(id);
    });
  }

  /** Newest checkpoint with the given trigger (createAutomaticCheckpoint's read). */
  async latestByTrigger(trigger: string): Promise<SyncCheckpointRow | undefined> {
    const db = await getConnection();
    const checkpoints = await db.getAll('checkpoints');
    return checkpoints
      .filter(cp => cp.trigger === trigger)
      .sort((a, b) => b.timestamp - a.timestamp)[0];
  }
}

export const checkpoints = new CheckpointsRepo();

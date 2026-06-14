/**
 * `cache_audio_blobs` repository — synthesized TTS audio segments
 * (Phase 3, D5.1 in plan/overhaul/prep/phase3-storage-gateway.md; carved
 * from src/db/DBService.ts getCachedSegment/cacheSegment).
 *
 * Worker-safe: the TTS engine worker imports this module (via TTSCache).
 * It must never import stores, sync services, React, or zustand — only
 * `~types/*`, `@lib/logger`, and the data layer itself.
 *
 * Differences from the DBService it replaces (both design decisions, D5.1):
 * - The `lastAccessed` bump on read used to be a gate-bypassing
 *   fire-and-forget `db.put` on EVERY cache hit — the highest-frequency
 *   readwrite bypass during playback. It now goes through `write()` and is
 *   debounced: skipped while the stored `lastAccessed` is under 1 h old.
 * - New rows are stamped with an additive `size` field (audio byteLength)
 *   so the eviction scan can avoid touching the blob. Additive only — NOT
 *   a schema version bump; older rows fall back to `audio.byteLength`.
 *
 * LRU eviction (format-free design): streams a readonly cursor over the
 * store one row at a time (never `getAll` — the BOLT serialization-OOM
 * comments in the manifest bulk reads apply doubly to audio blobs), then
 * deletes oldest-first in small gated batches until under budget, skipping
 * rows touched in the last 24 h so audio cannot vanish mid-playback.
 *
 * IDB v25 (P3-13, D7) added the `by_lastAccessed` index and this module's
 * post-open idle `size` backfill ({@link AudioCacheRepo.backfillSizesOnce},
 * run once from the `background` boot phase). Re-pointing the eviction scan
 * at the index (iterate oldest-first, stop early once under budget) is a
 * named follow-up in the prep doc — the scan still needs the total-bytes
 * pass today.
 */
import { getConnection } from '../connection';
import { write } from '../write-gate';
import { handleDbError } from '../errors';
import type { CacheAudioBlobRow } from '../rows/cache';
import { APP_METADATA_KEYS } from '../rows/app';
import type { Timepoint } from '~types/tts';
import { createLogger } from '@lib/logger';

const logger = createLogger('AudioCacheRepo');

/** Default audio-cache budget (bytes) the eviction job enforces. */
export const AUDIO_CACHE_BUDGET_BYTES = 512 * 1024 * 1024;

/** Skip the read-path lastAccessed bump while the stored stamp is this fresh. */
const LAST_ACCESSED_BUMP_INTERVAL_MS = 60 * 60 * 1000;

/** Rows touched within this window are never evicted (mid-playback safety). */
const EVICTION_RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Deletes per gated transaction during eviction pass 2. */
const EVICTION_DELETE_BATCH = 50;

/** Run an eviction sweep after every N segment puts. */
export const EVICTION_PUT_INTERVAL = 50;

/** Rows re-read + stamped per gated transaction during the size backfill. */
const SIZE_BACKFILL_BATCH = 10;

class AudioCacheRepo {
  private putsSinceEviction = 0;

  /**
   * Read a cached segment. Keeps the `alignmentData` read-shim: rows written
   * by older builds stored alignment under `alignmentData`; they are
   * normalized onto the canonical `alignment` field so cached cloud-TTS
   * timepoints are never silently dropped on a cache hit (~types/cache.ts).
   * New rows never write the legacy field.
   */
  async getSegment(key: string): Promise<CacheAudioBlobRow | undefined> {
    try {
      const db = await getConnection();
      const segment = await db.get('cache_audio_blobs', key);
      if (!segment) return undefined;

      const now = Date.now();
      if (now - segment.lastAccessed >= LAST_ACCESSED_BUMP_INTERVAL_MS) {
        // Debounced LRU stamp, serialized through the write gate.
        // Fire-and-forget like its predecessor: a failed bump must never
        // fail the read.
        const bumped = { ...segment, lastAccessed: now };
        void write(['cache_audio_blobs'], (tx) => {
          tx.objectStore('cache_audio_blobs').put(bumped);
        }).catch(() => {});
      }

      if (!segment.alignment && segment.alignmentData) {
        return { ...segment, alignment: segment.alignmentData };
      }
      return segment;
    } catch (error) {
      handleDbError(error);
    }
  }

  /** Write a synthesized segment (stamps `size` for the eviction scan). */
  async putSegment(key: string, audio: ArrayBuffer, alignment?: Timepoint[]): Promise<void> {
    try {
      const now = Date.now();
      await write(['cache_audio_blobs'], (tx) => {
        tx.objectStore('cache_audio_blobs').put({
          key,
          audio,
          alignment,
          createdAt: now,
          lastAccessed: now,
          size: audio.byteLength,
        });
      });
    } catch (error) {
      handleDbError(error);
    }

    // Opportunistic budget enforcement: a sweep after every N puts (plus the
    // background boot task) keeps the cache bounded without a format change.
    this.putsSinceEviction += 1;
    if (this.putsSinceEviction >= EVICTION_PUT_INTERVAL) {
      this.putsSinceEviction = 0;
      void this.runEviction().catch((error) => {
        logger.warn('Audio cache eviction sweep failed (will retry later):', error);
      });
    }
  }

  /**
   * v25 post-open idle backfill (D7 step 3): stamp the additive `size`
   * field on rows written before P3-6 introduced it, so the eviction scan
   * never has to touch the audio blob. Runs once — a completion flag in
   * `app_metadata` short-circuits later boots. Returns the number of rows
   * stamped.
   *
   * Pass 1 streams a readonly cursor collecting only the KEYS of rows
   * missing `size`; pass 2 re-reads each row outside the gate (D1's
   * read-modify-write recipe), stamps `size = audio.byteLength`, and puts
   * synchronously in small gated batches. Last-write-wins between read and
   * stamp: a concurrent putSegment stamps `size` itself, so the worst case
   * is reverting one row's sub-hour lastAccessed bump.
   */
  async backfillSizesOnce(): Promise<number> {
    try {
      const db = await getConnection();
      const done = await db.get('app_metadata', APP_METADATA_KEYS.audioSizeBackfillV25);
      if (done === true) return 0;

      // Pass 1: keys only (no getAll — rows hold multi-MB blobs).
      const missing: string[] = [];
      {
        const tx = db.transaction('cache_audio_blobs', 'readonly');
        let cursor = await tx.store.openCursor();
        while (cursor) {
          if (cursor.value.size === undefined) missing.push(cursor.value.key);
          cursor = await cursor.continue();
        }
        await tx.done;
      }

      // Pass 2: stamp in small batches.
      let stamped = 0;
      for (let i = 0; i < missing.length; i += SIZE_BACKFILL_BATCH) {
        const keys = missing.slice(i, i + SIZE_BACKFILL_BATCH);
        const rows: CacheAudioBlobRow[] = [];
        for (const key of keys) {
          const row = await db.get('cache_audio_blobs', key);
          if (row && row.size === undefined) {
            rows.push({ ...row, size: row.audio?.byteLength ?? 0 });
          }
        }
        if (rows.length > 0) {
          await write(['cache_audio_blobs'], (tx) => {
            const store = tx.objectStore('cache_audio_blobs');
            for (const row of rows) store.put(row);
          });
          stamped += rows.length;
        }
      }

      await write(['app_metadata'], (tx) => {
        tx.objectStore('app_metadata').put(true, APP_METADATA_KEYS.audioSizeBackfillV25);
      });
      if (stamped > 0) {
        logger.info(`v25 size backfill stamped ${stamped} audio cache row(s).`);
      }
      return stamped;
    } catch (error) {
      handleDbError(error);
    }
  }

  /**
   * LRU eviction. Pass 1 streams a readonly cursor collecting
   * `{key, lastAccessed, size}` one row at a time; pass 2 deletes
   * oldest-first through the write gate in batches until the cache is under
   * `budgetBytes`, skipping rows touched in the last 24 h.
   */
  async runEviction(
    budgetBytes: number = AUDIO_CACHE_BUDGET_BYTES,
  ): Promise<{ deleted: number; freedBytes: number }> {
    try {
      const db = await getConnection();

      // Pass 1: streaming scan (no getAll — rows hold multi-MB blobs).
      const entries: { key: string; lastAccessed: number; size: number }[] = [];
      let totalBytes = 0;
      {
        const tx = db.transaction('cache_audio_blobs', 'readonly');
        let cursor = await tx.store.openCursor();
        while (cursor) {
          const row = cursor.value;
          const size = row.size ?? row.audio?.byteLength ?? 0;
          entries.push({ key: row.key, lastAccessed: row.lastAccessed ?? 0, size });
          totalBytes += size;
          cursor = await cursor.continue();
        }
        await tx.done;
      }

      if (totalBytes <= budgetBytes) {
        return { deleted: 0, freedBytes: 0 };
      }

      // Pass 2: oldest-first deletes, skipping recently-used rows.
      const cutoff = Date.now() - EVICTION_RECENT_WINDOW_MS;
      const candidates = entries
        .filter((e) => e.lastAccessed < cutoff)
        .sort((a, b) => a.lastAccessed - b.lastAccessed);

      let deleted = 0;
      let freedBytes = 0;
      let remaining = totalBytes;
      let batch: string[] = [];

      const flushBatch = async (): Promise<void> => {
        if (batch.length === 0) return;
        const keys = batch;
        batch = [];
        await write(['cache_audio_blobs'], (tx) => {
          const store = tx.objectStore('cache_audio_blobs');
          for (const key of keys) store.delete(key);
        });
      };

      for (const entry of candidates) {
        if (remaining <= budgetBytes) break;
        batch.push(entry.key);
        deleted += 1;
        freedBytes += entry.size;
        remaining -= entry.size;
        if (batch.length >= EVICTION_DELETE_BATCH) {
          await flushBatch();
        }
      }
      await flushBatch();

      if (deleted > 0) {
        logger.info(
          `Audio cache eviction: deleted ${deleted} segment(s), freed ${freedBytes} bytes ` +
            `(${remaining} of ${budgetBytes} budget in use).`,
        );
      }
      return { deleted, freedBytes };
    } catch (error) {
      handleDbError(error);
    }
    return { deleted: 0, freedBytes: 0 };
  }
}

/** Singleton — the put-counter (eviction cadence) is process-wide state. */
export const audioCache = new AudioCacheRepo();

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
 * The scan is now GUARDED by a persisted running byte total
 * (`app_metadata['audio-cache-total-bytes']`, additive KV key — no DB bump):
 * a sweep whose tracked total is under budget returns without opening a
 * cursor at all. This is what keeps the boot sweep and the every-50-puts
 * sweep off the main thread — a value cursor deserializes each row's
 * multi-hundred-KB `audio` ArrayBuffer, so the old unconditional scan cost
 * the whole 512 MiB budget in deserialization per sweep.
 *
 * The tracked total is a HINT only. It is maintained in memory by
 * {@link AudioCacheRepo.putSegment} (+= byteLength) and by the eviction
 * delete batches (-= freed), and is persisted inside those same gated
 * transactions. It never decides WHAT to evict: whenever it says "over
 * budget" (or is absent) the sweep falls back to the full scan, which is the
 * source of truth and re-seeds the total from the rows themselves. A
 * stale-high total costs one extra scan; a stale-low total delays a sweep
 * until the next scan corrects it.
 *
 * IDB v25 (P3-13, D7) added the `by_lastAccessed` index and this module's
 * post-open idle `size` backfill ({@link AudioCacheRepo.backfillSizesOnce},
 * run once from the `background` boot phase).
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

/**
 * The eviction sweep's result. `scanned` is the number of rows the sweep
 * deserialized — 0 whenever the tracked-total fast path held. (Not exported:
 * callers use it structurally through `runEviction`'s return type.)
 */
interface AudioEvictionResult {
  deleted: number;
  freedBytes: number;
  scanned: number;
}

class AudioCacheRepo {
  private putsSinceEviction = 0;

  /**
   * Net byte change this context has made since the persisted total was last
   * written (puts add, evictions reset it). The persisted value itself is
   * re-read per sweep rather than cached, so another tab's or the TTS
   * worker's writes are picked up; concurrent deltas are last-write-wins,
   * which a later scan corrects.
   */
  private deltaBytes = 0;

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
      // Running total (hint): a put that REPLACES an existing key over-counts
      // by the old row's size — which only ever buys an earlier full scan,
      // and that scan re-establishes the truth.
      this.deltaBytes += audio.byteLength;
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
   * The tracked byte total (persisted hint + this session's net delta), or
   * null while it has never been established. Read OUTSIDE the gate.
   */
  private async trackedTotal(
    db: Awaited<ReturnType<typeof getConnection>>,
  ): Promise<number | null> {
    const stored = await db.get('app_metadata', APP_METADATA_KEYS.audioCacheTotalBytes);
    if (typeof stored !== 'number' || !Number.isFinite(stored)) return null;
    return Math.max(0, stored + this.deltaBytes);
  }

  /** Adopt `total` as the established value and persist it (one gated put). */
  private async persistTotal(total: number): Promise<void> {
    this.deltaBytes = 0;
    await write(['app_metadata'], (tx) => {
      tx.objectStore('app_metadata').put(total, APP_METADATA_KEYS.audioCacheTotalBytes);
    });
  }

  /**
   * LRU eviction. The tracked byte total gates the scan: while it says the
   * cache is under `budgetBytes` the sweep returns immediately (`scanned: 0`)
   * — no cursor, no blob deserialization. Otherwise pass 1 streams a readonly
   * cursor collecting `{key, lastAccessed, size}` one row at a time (and
   * re-establishes the total from the rows themselves); pass 2 deletes
   * oldest-first through the write gate in batches until the cache is under
   * budget, skipping rows touched in the last 24 h.
   */
  async runEviction(budgetBytes: number = AUDIO_CACHE_BUDGET_BYTES): Promise<AudioEvictionResult> {
    try {
      const db = await getConnection();

      // Fast path: the tracked total proves we are under budget. This is the
      // common case for both callers (boot + every EVICTION_PUT_INTERVAL
      // puts) and the whole point of tracking — the scan below deserializes
      // every row's audio buffer.
      const tracked = await this.trackedTotal(db);
      if (tracked !== null && tracked <= budgetBytes) {
        if (this.deltaBytes !== 0) await this.persistTotal(tracked);
        return { deleted: 0, freedBytes: 0, scanned: 0 };
      }

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
      const scanned = entries.length;

      if (totalBytes <= budgetBytes) {
        // The scan is the source of truth — seed/correct the tracked total.
        await this.persistTotal(totalBytes);
        return { deleted: 0, freedBytes: 0, scanned };
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

      // Each batch carries the updated total in the SAME transaction, so a
      // sweep interrupted between batches leaves the hint consistent with
      // what was actually deleted (no extra gate acquisitions).
      const flushBatch = async (runningTotal: number): Promise<void> => {
        if (batch.length === 0) return;
        const keys = batch;
        batch = [];
        this.deltaBytes = 0;
        await write(['cache_audio_blobs', 'app_metadata'], (tx) => {
          const store = tx.objectStore('cache_audio_blobs');
          for (const key of keys) store.delete(key);
          tx.objectStore('app_metadata').put(runningTotal, APP_METADATA_KEYS.audioCacheTotalBytes);
        });
      };

      for (const entry of candidates) {
        if (remaining <= budgetBytes) break;
        batch.push(entry.key);
        deleted += 1;
        freedBytes += entry.size;
        remaining -= entry.size;
        if (batch.length >= EVICTION_DELETE_BATCH) {
          await flushBatch(remaining);
        }
      }
      await flushBatch(remaining);
      // Nothing was evictable (every row inside the 24 h window): the scan's
      // total still has to land so the next sweep does not rescan.
      if (deleted === 0) await this.persistTotal(totalBytes);

      if (deleted > 0) {
        logger.info(
          `Audio cache eviction: deleted ${deleted} segment(s), freed ${freedBytes} bytes ` +
            `(${remaining} of ${budgetBytes} budget in use).`,
        );
      }
      return { deleted, freedBytes, scanned };
    } catch (error) {
      handleDbError(error);
    }
    return { deleted: 0, freedBytes: 0, scanned: 0 };
  }
}

/** Singleton — the put-counter (eviction cadence) is process-wide state. */
export const audioCache = new AudioCacheRepo();

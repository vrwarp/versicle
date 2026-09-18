/**
 * Repo for `cache_embeddings` + `cache_embed_jobs` — the per-book int8 embedding
 * vectors (used for semantic search) and the resumable progress of the job that
 * computes them.
 *
 * Device-local cache: rebuildable, never synced as ordinary user data, and
 * DELETED with the book (book deletion removes both rows in the same gated
 * transaction). Absence simply means the indexer re-embeds the book.
 *
 * Persisted format: each section's `vectors`/`scales` are stored as raw
 * ArrayBuffers (the typed array's `.buffer`); the read path re-wraps them as the
 * Int8Array/Float32Array views the cosine-ranking worker expects, so a
 * wrong-view bug cannot leak past this boundary.
 *
 * Worker-safe like every repo: no store/UI imports; writes go through the
 * navigator.locks write-gate.
 *
 * {@link EmbeddingsRepo.putHydrated} exists for the case where another device
 * already embedded this book and shared the vectors via the user's own cloud:
 * it writes the embeddings row AND its `complete` job row in ONE gated
 * cross-store transaction. That atomicity means a refill from the cloud can
 * never leave a section the job marks done while its vectors are absent — the
 * crash window the two independent {@link EmbeddingsRepo.put} /
 * {@link EmbeddingsRepo.putJob} transactions could otherwise open.
 *
 * The eviction sweep is GUARDED by a persisted running byte total
 * (`app_metadata['embedding-cache-total-bytes']`, additive KV key — no DB
 * bump), exactly as the audio cache's sweep is: a sweep whose tracked total is
 * under budget returns without opening a cursor at all. That matters because
 * the scan streams a VALUE cursor, so every book's packed int8 vectors (budget
 * 256 MiB) were deserialized on the main thread before the under-budget
 * early-out could run — at boot, every boot.
 *
 * The total is a HINT. It never decides WHAT to evict: whenever it says "over
 * budget", or is absent, the full scan runs, and the scan — the source of
 * truth — re-seeds it from the rows themselves.
 *
 * It is maintained DURABLY, not just in memory: BOTH write paths
 * ({@link EmbeddingsRepo.put} and {@link EmbeddingsRepo.putHydrated}) fold the
 * row's bytes into the total inside the SAME gated transaction that writes the
 * row (the base value is read outside the gate — the read-modify-write recipe
 * in write-gate.ts — and the populate callback stays synchronous). That matters
 * even more here than for the audio cache, whose sweep also runs every N puts:
 * this sweep runs ONLY as a boot task (app/boot/backgroundTasks.ts), and at
 * boot the in-memory remainder is empty, so a hint written exclusively from
 * inside the sweep could never advance again — every session's writes died with
 * the page, the stored value sat frozen under budget, and the sweep went on
 * skipping a cache that had grown past the budget, where the pre-change code
 * rescanned at every boot and could not drift. The eviction delete batches keep
 * carrying the corrected total in their own transactions.
 *
 * {@link EmbeddingsRepo.deltaBytes} is only the remainder that could not be
 * folded yet (the hint absent, or a write that raced a sweep's own write).
 * Every gated write that carries a total subtracts EXACTLY the snapshot it
 * folded in — never a blind reset — so bytes another write added meanwhile stay
 * pending instead of being erased. The ways the hint can still be wrong are
 * mostly the safe way (reading high ⇒ one extra scan, which corrects it): a put
 * that REPLACES a book's row over-counts by the old row's size, and the indexer
 * re-puts the whole growing row once per flush batch, so embedding one book
 * counts its bytes several times over; {@link EmbeddingsRepo.delete} (plus the
 * book-deletion path, which clears both rows inline) does not subtract at all.
 * The one way it can read low is last-write-wins: two writes that overlap read
 * the same base, so the later commit can drop the earlier's bytes (a sweep's
 * scan-derived total can likewise clobber a fold that landed while it ran) —
 * bounded by how often writes overlap, never frozen, and any scan
 * re-establishes the truth.
 *
 * (design: plan/shared-ai-cache-design.md)
 */
import { getConnection } from '../connection';
import { write } from '../write-gate';
import { handleDbError } from '../errors';
import type { CacheEmbeddingsRow, CacheEmbedJobsRow } from '../rows/cache';
import { APP_METADATA_KEYS } from '../rows/app';
import { createLogger } from '@lib/logger';

const logger = createLogger('EmbeddingsRepo');

/**
 * Default `cache_embeddings` budget (bytes) the eviction sweep enforces.
 * Conservative relative to the audio cache (512 MiB): vectors are int8-packed
 * and re-derivable from `cache_search_text` + the API, so a tighter budget
 * costs only a re-embed on next read.
 */
export const EMBEDDING_CACHE_BUDGET_BYTES = 256 * 1024 * 1024;

/** Deletes per gated transaction during eviction pass 2 (mirrors audioCache). */
const EVICTION_DELETE_BATCH = 50;

/** Shared empty protected set (the no-protection default; avoids a per-call alloc). */
const EMPTY_PROTECTED: ReadonlySet<string> = new Set();

/**
 * The eviction sweep's result. `scanned` is the number of rows the sweep
 * deserialized — 0 whenever the tracked-total fast path held. (Not exported:
 * callers consume it structurally through `runEviction`'s return type, as with
 * the audio cache.)
 */
interface EmbeddingEvictionResult {
  deleted: number;
  freedBytes: number;
  scanned: number;
}

/**
 * One write's planned fold into the running byte total: the value its own gated
 * transaction should carry (`null` while the hint has never been established —
 * there is nothing to fold into), the {@link EmbeddingsRepo.deltaBytes}
 * snapshot that value already covers, and the row's own bytes (which stay
 * pending when the fold cannot happen).
 */
interface FoldPlan {
  folded: number | null;
  accounted: number;
  bytes: number;
}

/** Persisted byte cost of one embeddings row (never re-wraps the buffers). */
function rowBytes(row: CacheEmbeddingsRow): number {
  let size = 0;
  for (const section of row.sections) {
    size += section.vectors.byteLength + section.scales.byteLength;
  }
  return size;
}

/**
 * A `cache_embeddings` row as the read path hands it to callers: identical to
 * {@link CacheEmbeddingsRow} except the persisted binary buffers are re-wrapped
 * as the typed-array views the compute layer consumes. Persisting always uses
 * the ArrayBuffer-shaped {@link CacheEmbeddingsRow}.
 *
 * Internal for now (knip's "every export needs a consumer" policy): callers
 * get it via inference on {@link EmbeddingsRepo.get}'s return type. It will be
 * exported once the indexer/search worker consume it by name directly.
 */
type CacheEmbeddingsView = Omit<CacheEmbeddingsRow, 'sections'> & {
  sections: (Omit<CacheEmbeddingsRow['sections'][number], 'vectors' | 'scales'> & {
    vectors: Int8Array;
    scales: Float32Array;
  })[];
};

class EmbeddingsRepo {
  /**
   * Bytes this context has committed that the persisted total does NOT include
   * yet — the remainder {@link EmbeddingsRepo.put} /
   * {@link EmbeddingsRepo.putHydrated}'s fold could not carry (the hint absent,
   * or a write that raced a sweep's own write). The persisted value is re-read
   * per write and per sweep rather than cached, so another tab's writes are
   * picked up; concurrent writes are last-write-wins, which a later scan
   * corrects.
   */
  private deltaBytes = 0;

  /**
   * The persisted embedding row for a book, or undefined when never embedded.
   * Re-wraps each section's `vectors` (→ Int8Array) and `scales`
   * (→ Float32Array) from the stored ArrayBuffers.
   */
  async get(bookId: string): Promise<CacheEmbeddingsView | undefined> {
    try {
      const db = await getConnection();
      const row = await db.get('cache_embeddings', bookId);
      if (!row) return undefined;
      return {
        ...row,
        sections: row.sections.map((section) => ({
          ...section,
          vectors: new Int8Array(section.vectors),
          scales: new Float32Array(section.scales),
        })),
      };
    } catch (error) {
      handleDbError(error);
    }
  }

  /**
   * The resumable embed-job progress for a book, or undefined when none.
   * (Read as stored — no binary fields to re-wrap.)
   */
  async getJob(bookId: string): Promise<CacheEmbedJobsRow | undefined> {
    try {
      const db = await getConnection();
      return await db.get('cache_embed_jobs', bookId);
    } catch (error) {
      handleDbError(error);
    }
  }

  /**
   * Upsert the embedding row (one row per book; keyPath bookId). Persists the
   * raw `.buffer` ArrayBuffers carried on `row.sections[*].vectors/scales`.
   */
  async put(row: CacheEmbeddingsRow): Promise<void> {
    try {
      const db = await getConnection();
      // Running total (hint): read the base OUTSIDE the gate, then fold this
      // row's bytes (plus whatever an earlier write could not fold) into the
      // SAME gated transaction as the row, so the hint survives a page close
      // even though the sweep only ever runs at boot. A put that REPLACES this
      // book's row over-counts by the old row's size — which only ever buys an
      // earlier full scan, and that scan re-establishes the truth.
      const plan = await this.planFold(db, rowBytes(row));
      await write(['cache_embeddings', 'app_metadata'], (tx) => {
        tx.objectStore('cache_embeddings').put(row);
        if (plan.folded !== null) {
          tx.objectStore('app_metadata').put(
            plan.folded,
            APP_METADATA_KEYS.embeddingCacheTotalBytes,
          );
        }
      });
      this.settleFold(plan);
    } catch (error) {
      handleDbError(error);
    }
  }

  /** Upsert the resumable embed-job progress (one row per book). */
  async putJob(row: CacheEmbedJobsRow): Promise<void> {
    try {
      await write(['cache_embed_jobs'], (tx) => {
        tx.objectStore('cache_embed_jobs').put(row);
      });
    } catch (error) {
      handleDbError(error);
    }
  }

  /**
   * Fill in a book's embeddings from a copy another device uploaded to the
   * user's own cloud (avoids re-spending Gemini quota to recompute them). Writes
   * the embedding row AND its companion `complete` job row in ONE gated
   * cross-store transaction (the same cross-store `write(...)` shape as
   * {@link EmbeddingsRepo.delete}, carrying the running-total fold as
   * {@link EmbeddingsRepo.put} does). Atomicity is the point: the plain
   * {@link EmbeddingsRepo.put} / {@link EmbeddingsRepo.putJob} are two
   * INDEPENDENT transactions, so a crash between them here could mark a
   * section done in the job row while its vectors are absent — and the resume
   * logic, seeing it "done", would skip it forever (silently un-searchable).
   * One transaction closes that window. The caller's `jobRow` must mark ONLY
   * the sections actually present in `row` as complete, so a partial fill stays
   * correct.
   */
  async putHydrated(row: CacheEmbeddingsRow, jobRow: CacheEmbedJobsRow): Promise<void> {
    try {
      const db = await getConnection();
      // Same durable fold as put(): base read outside the gate, the new value
      // written by the row's own transaction (the atomic pair is untouched —
      // app_metadata simply joins the same scope).
      const plan = await this.planFold(db, rowBytes(row));
      await write(['cache_embeddings', 'cache_embed_jobs', 'app_metadata'], (tx) => {
        tx.objectStore('cache_embeddings').put(row);
        tx.objectStore('cache_embed_jobs').put(jobRow);
        if (plan.folded !== null) {
          tx.objectStore('app_metadata').put(
            plan.folded,
            APP_METADATA_KEYS.embeddingCacheTotalBytes,
          );
        }
      });
      this.settleFold(plan);
    } catch (error) {
      handleDbError(error);
    }
  }

  /**
   * Remove a book's vectors AND its resumable job state in one gated
   * transaction, so the job progress dies with the vectors. (The
   * book-deletion path also clears both inline in its own tx.)
   */
  async delete(bookId: string): Promise<void> {
    try {
      await write(['cache_embeddings', 'cache_embed_jobs'], (tx) => {
        tx.objectStore('cache_embeddings').delete(bookId);
        tx.objectStore('cache_embed_jobs').delete(bookId);
      });
    } catch (error) {
      handleDbError(error);
    }
  }

  /**
   * The persisted hint as it stands on disk, or null while it has never been
   * established (or holds a non-number). Read OUTSIDE the gate — the
   * read-modify-write recipe in write-gate.ts.
   */
  private async readStoredTotal(
    db: Awaited<ReturnType<typeof getConnection>>,
  ): Promise<number | null> {
    const stored = await db.get('app_metadata', APP_METADATA_KEYS.embeddingCacheTotalBytes);
    if (typeof stored !== 'number' || !Number.isFinite(stored)) return null;
    return stored;
  }

  /**
   * Plan a write's fold into the running total: read the base OUTSIDE the gate
   * and compute the value the write's own transaction will carry, together with
   * the {@link deltaBytes} snapshot that value covers. Hand the plan back to
   * {@link settleFold} once — and only once — the write has landed.
   *
   * The audio cache folds inline inside its single write path; this repo has
   * TWO ({@link EmbeddingsRepo.put} and {@link EmbeddingsRepo.putHydrated}), so
   * the arithmetic lives in one place and cannot drift between them.
   */
  private async planFold(
    db: Awaited<ReturnType<typeof getConnection>>,
    bytes: number,
  ): Promise<FoldPlan> {
    const stored = await this.readStoredTotal(db);
    if (stored === null) return { folded: null, accounted: 0, bytes };
    const accounted = this.deltaBytes;
    return { folded: Math.max(0, stored + accounted + bytes), accounted, bytes };
  }

  /** Retire a fold once ITS gated write has committed. */
  private settleFold(plan: FoldPlan): void {
    if (plan.folded === null) {
      // The hint has never been established: the next sweep's scan seeds it
      // from the rows themselves, this row included.
      this.deltaBytes += plan.bytes;
      return;
    }
    // Subtract exactly what the written value accounted for (this row's own
    // bytes are in it), leaving anything a concurrent write added meanwhile.
    this.settleDelta(plan.accounted);
  }

  /**
   * Retire the part of {@link deltaBytes} a just-committed total accounted for.
   * NEVER a reset: bytes a write added after `accounted` was snapshotted are
   * not in the written value, so they stay pending for the next fold.
   */
  private settleDelta(accounted: number): void {
    if (accounted <= 0) return;
    this.deltaBytes = Math.max(0, this.deltaBytes - accounted);
  }

  /**
   * Adopt `total` as the established value and persist it (one gated put).
   * `accounted` is the {@link deltaBytes} snapshot `total` already covers; it
   * is settled only AFTER the write lands.
   */
  private async persistTotal(total: number, accounted: number): Promise<void> {
    await write(['app_metadata'], (tx) => {
      tx.objectStore('app_metadata').put(total, APP_METADATA_KEYS.embeddingCacheTotalBytes);
    });
    this.settleDelta(accounted);
  }

  /**
   * Least-recently-read eviction over `cache_embeddings` to keep it under a byte
   * budget — the same streaming-cursor + gated-batch-delete shape as the audio
   * cache eviction, but with NO per-row `lastAccessed` field or recency index.
   * `cache_embeddings` is keyed by bookId only, so the recency signal is INJECTED
   * by the caller: it builds `recencyByBookId` from each book's last-read time
   * and passes it in, which keeps this repo store-free. Recently-read books evict
   * LAST; a book absent from the map ranks oldest (0) and evicts FIRST.
   *
   * Pass 1 streams a readonly cursor collecting `{bookId, size}`, reading
   * `section.vectors.byteLength + section.scales.byteLength` straight off the
   * STORED ArrayBuffers (never the re-wrapped {@link CacheEmbeddingsView} —
   * re-wrapping multi-KB blobs just to measure them would defeat the streaming
   * goal). Pass 2 deletes least-recently-read-first via the same two-store
   * delete semantics as {@link EmbeddingsRepo.delete} (both `cache_embeddings`
   * and `cache_embed_jobs` in one gated transaction) until the total is under
   * budget. Vectors are re-derivable from the cached search text plus the
   * embedding API, so an evicted book simply re-embeds on next read.
   *
   * `protectedBookIds`: any book in this set is NEVER evicted (skipped in pass 2
   * even when oldest/over-budget); its bytes still count toward the total. Like
   * `recencyByBookId`, the set is INJECTED so this repo stays store-free. It is
   * how the caller protects a book whose embeddings exist ONLY on this device:
   * when the user has opted in to sharing AI caches across their devices, the
   * caller checks whether each locally-embedded book has been uploaded yet and
   * protects the ones that have not, so eviction can never destroy the last
   * remaining copy before it reaches the cloud. When sharing is off, the set is
   * empty and everything is evictable as usual.
   *
   * The whole thing is gated by the persisted running byte total: while it
   * proves the cache is under `budgetBytes` the sweep returns immediately
   * (`scanned: 0`) — no cursor, no vector deserialization. See the module
   * docs for why that total is only ever a hint.
   */
  async runEviction(
    recencyByBookId: Map<string, number>,
    budgetBytes: number = EMBEDDING_CACHE_BUDGET_BYTES,
    protectedBookIds: ReadonlySet<string> = EMPTY_PROTECTED,
  ): Promise<EmbeddingEvictionResult> {
    try {
      const db = await getConnection();

      // Fast path: the tracked total proves we are under budget. This is the
      // common case for the boot task and the whole point of tracking — the
      // scan below deserializes every book's packed int8 vectors.
      const stored = await this.readStoredTotal(db);
      const pending = this.deltaBytes;
      const tracked = stored === null ? null : Math.max(0, stored + pending);
      if (tracked !== null && tracked <= budgetBytes) {
        if (pending > 0) await this.persistTotal(tracked, pending);
        return { deleted: 0, freedBytes: 0, scanned: 0 };
      }

      // Pass 1: streaming scan (no getAll — rows hold packed vector blobs). The
      // scan's own total supersedes the hint, so it covers the bytes pending
      // RIGHT NOW (their rows are committed) but not a write that lands while
      // it runs — hence the snapshot, settled once a scan-derived total
      // commits.
      let credit = this.deltaBytes;
      const entries: { bookId: string; size: number }[] = [];
      let totalBytes = 0;
      {
        const tx = db.transaction('cache_embeddings', 'readonly');
        let cursor = await tx.store.openCursor();
        while (cursor) {
          const row = cursor.value;
          let size = 0;
          for (const section of row.sections) {
            // Read off the STORED ArrayBuffers — do NOT re-wrap as typed-array
            // views just to size them.
            size += section.vectors.byteLength + section.scales.byteLength;
          }
          entries.push({ bookId: row.bookId, size });
          totalBytes += size;
          cursor = await cursor.continue();
        }
        await tx.done;
      }
      const scanned = entries.length;

      if (totalBytes <= budgetBytes) {
        // The scan is the source of truth — seed/correct the tracked total.
        await this.persistTotal(totalBytes, credit);
        return { deleted: 0, freedBytes: 0, scanned };
      }

      // Pass 2: least-recently-read-first deletes (unknown bookId → 0 → first).
      const candidates = entries.sort(
        (a, b) => (recencyByBookId.get(a.bookId) ?? 0) - (recencyByBookId.get(b.bookId) ?? 0),
      );

      let deleted = 0;
      let freedBytes = 0;
      let remaining = totalBytes;
      let batch: string[] = [];

      // Each batch carries the updated total in the SAME transaction, so a
      // sweep interrupted between batches leaves the hint consistent with what
      // was actually deleted (no extra gate acquisitions).
      const flushBatch = async (runningTotal: number): Promise<void> => {
        if (batch.length === 0) return;
        const ids = batch;
        batch = [];
        // Every batch total derives from the one scan, so the scan's credit is
        // settled once — by the first batch that commits. A write that lands
        // between batches keeps its bytes pending (this total does not carry
        // them) and the next fold or sweep picks them up.
        const spend = credit;
        credit = 0;
        await write(['cache_embeddings', 'cache_embed_jobs', 'app_metadata'], (tx) => {
          const embeddings = tx.objectStore('cache_embeddings');
          const jobs = tx.objectStore('cache_embed_jobs');
          for (const id of ids) {
            // Delete BOTH rows (the job dies with the vectors, like delete()).
            embeddings.delete(id);
            jobs.delete(id);
          }
          tx.objectStore('app_metadata').put(
            runningTotal,
            APP_METADATA_KEYS.embeddingCacheTotalBytes,
          );
        });
        this.settleDelta(spend);
      };

      for (const entry of candidates) {
        if (remaining <= budgetBytes) break;
        // Skip a protected book (e.g. one not yet uploaded to the user's cloud)
        // even when it is oldest/over-budget; its bytes stay counted in
        // `remaining`, so the loop keeps looking for an evictable candidate.
        if (protectedBookIds.has(entry.bookId)) continue;
        batch.push(entry.bookId);
        deleted += 1;
        freedBytes += entry.size;
        remaining -= entry.size;
        if (batch.length >= EVICTION_DELETE_BATCH) {
          await flushBatch(remaining);
        }
      }
      await flushBatch(remaining);
      // Nothing was evictable (every candidate protected): the scan's total
      // still has to land so the next sweep does not rescan.
      if (deleted === 0) await this.persistTotal(totalBytes, credit);

      if (deleted > 0) {
        logger.info(
          `Embedding cache eviction: deleted ${deleted} book(s), freed ${freedBytes} bytes ` +
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

export const embeddingsRepo = new EmbeddingsRepo();
export type { CacheEmbeddingsRow, CacheEmbedJobsRow };

/**
 * Repo for `cache_embeddings` + `cache_embed_jobs` — the per-book int8
 * embedding vectors and resumable embed-job progress (Increment B; stores
 * created by the v27 migration step).
 *
 * Device-local CACHE domain: rebuildable, never synced, and DELETED with the
 * book (bookContent.deleteBook removes both rows in the same gated
 * transaction). Absence simply means the (Phase-C) indexer re-embeds.
 *
 * Persisted format (§6.1 convention): each section's `vectors`/`scales` are
 * stored as raw ArrayBuffers (the typed array's `.buffer`); the read path
 * re-wraps them as the Int8Array/Float32Array views the Phase-C worker cosine
 * ranking expects, so a wrong-view bug cannot leak past this boundary.
 *
 * Worker-safe like every repo: no store/UI imports; writes go through the
 * navigator.locks write-gate.
 */
import { getConnection } from '../connection';
import { write } from '../write-gate';
import { handleDbError } from '../errors';
import type { CacheEmbeddingsRow, CacheEmbedJobsRow } from '../rows/cache';
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

/**
 * A `cache_embeddings` row as the read path hands it to callers: identical to
 * {@link CacheEmbeddingsRow} except the persisted binary buffers are re-wrapped
 * as the typed-array views the compute layer consumes. Persisting always uses
 * the ArrayBuffer-shaped {@link CacheEmbeddingsRow}.
 *
 * Internal for now (knip's "every export needs a consumer" policy): callers
 * get it via inference on {@link EmbeddingsRepo.get}'s return type. The
 * Phase-C indexer/worker that consume it directly will export it then.
 */
type CacheEmbeddingsView = Omit<CacheEmbeddingsRow, 'sections'> & {
  sections: (Omit<CacheEmbeddingsRow['sections'][number], 'vectors' | 'scales'> & {
    vectors: Int8Array;
    scales: Float32Array;
  })[];
};

class EmbeddingsRepo {
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
      await write(['cache_embeddings'], (tx) => {
        tx.objectStore('cache_embeddings').put(row);
      });
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
   * LRU eviction over `cache_embeddings` (design §6/§8.3) — the same
   * streaming-cursor + gated-batch-delete shape as
   * {@link AudioCacheRepo.runEviction}, but with NO per-row `lastAccessed`
   * field or `by_lastAccessed` index. `cache_embeddings` is keyed by bookId
   * (no secondary index), so the recency signal is INJECTED: the boot task
   * builds `recencyByBookId` from the reading-state store's progress
   * (`getMostRecentProgress(...).lastRead`) and passes it in — the repo stays
   * store-free (data-no-upward). Recently-read books evict LAST; an unknown
   * bookId ranks oldest (0) and evicts FIRST.
   *
   * Pass 1 streams a readonly cursor collecting `{bookId, size}`, reading
   * `section.vectors.byteLength + section.scales.byteLength` straight off the
   * STORED ArrayBuffers (never the re-wrapped {@link CacheEmbeddingsView} —
   * re-wrapping multi-KB blobs just to size them would defeat the streaming
   * goal, exactly as the audio scan avoids touching blobs). Pass 2 deletes
   * least-recently-read-first via the {@link EmbeddingsRepo.delete} semantics
   * (both `cache_embeddings` and `cache_embed_jobs` in the gated tx) until the
   * total is under budget. Vectors are re-derivable (cache_search_text + the
   * API), so an evicted book simply re-embeds on next read — absence is the
   * not-embedded state.
   */
  async runEviction(
    recencyByBookId: Map<string, number>,
    budgetBytes: number = EMBEDDING_CACHE_BUDGET_BYTES,
  ): Promise<{ deleted: number; freedBytes: number }> {
    try {
      const db = await getConnection();

      // Pass 1: streaming scan (no getAll — rows hold packed vector blobs).
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

      if (totalBytes <= budgetBytes) {
        return { deleted: 0, freedBytes: 0 };
      }

      // Pass 2: least-recently-read-first deletes (unknown bookId → 0 → first).
      const candidates = entries.sort(
        (a, b) => (recencyByBookId.get(a.bookId) ?? 0) - (recencyByBookId.get(b.bookId) ?? 0),
      );

      let deleted = 0;
      let freedBytes = 0;
      let remaining = totalBytes;
      let batch: string[] = [];

      const flushBatch = async (): Promise<void> => {
        if (batch.length === 0) return;
        const ids = batch;
        batch = [];
        await write(['cache_embeddings', 'cache_embed_jobs'], (tx) => {
          const embeddings = tx.objectStore('cache_embeddings');
          const jobs = tx.objectStore('cache_embed_jobs');
          for (const id of ids) {
            // Delete BOTH rows (the job dies with the vectors, like delete()).
            embeddings.delete(id);
            jobs.delete(id);
          }
        });
      };

      for (const entry of candidates) {
        if (remaining <= budgetBytes) break;
        batch.push(entry.bookId);
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
          `Embedding cache eviction: deleted ${deleted} book(s), freed ${freedBytes} bytes ` +
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

export const embeddingsRepo = new EmbeddingsRepo();
export type { CacheEmbeddingsRow, CacheEmbedJobsRow };

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
}

export const embeddingsRepo = new EmbeddingsRepo();
export type { CacheEmbeddingsRow, CacheEmbedJobsRow };

/**
 * Repo for `cache_query_embeddings` — the persistent query embedding vector cache.
 * Key: `${model}|${dims}|${query}`
 *
 * Worker-safe: no store/UI imports; writes go through the navigator.locks write-gate.
 */
import { getConnection } from '../connection';
import { write } from '../write-gate';
import { handleDbError } from '../errors';
import type { CacheQueryEmbeddingsRow } from '../rows/cache';

class QueryEmbeddingsRepo {
  /** Retrieves a query embedding row if cached. */
  async get(key: string): Promise<CacheQueryEmbeddingsRow | undefined> {
    try {
      const db = await getConnection();
      return await db.get('cache_query_embeddings', key);
    } catch (error) {
      handleDbError(error);
    }
  }

  /** Upsert a query embedding row. */
  async put(row: CacheQueryEmbeddingsRow): Promise<void> {
    try {
      await write(['cache_query_embeddings'], (tx) => {
        tx.objectStore('cache_query_embeddings').put(row);
      });
    } catch (error) {
      handleDbError(error);
    }
  }

  /** Delete a query embedding row. */
  async delete(key: string): Promise<void> {
    try {
      await write(['cache_query_embeddings'], (tx) => {
        tx.objectStore('cache_query_embeddings').delete(key);
      });
    } catch (error) {
      handleDbError(error);
    }
  }
}

export const queryEmbeddingsRepo = new QueryEmbeddingsRepo();
export type { CacheQueryEmbeddingsRow };

/**
 * QueryEmbeddingCache — memoizes the query embedding so a
 * repeated search reuses the cached float32 vector with NO second `embed` call,
 * protecting the shared daily RPD budget (design §5.2/§8.1).
 *
 * Keyed by `model | dims | profile | bookId | query` (the query normalized:
 * trimmed + lowercased) so book-scoped, stamp-aware lookups never collide.
 * The PROMISE is memoized — concurrent identical queries share one in-flight
 * `embed` call, and a resolved entry is reused without recomputing.
 *
 * Store/kernel-state-free: it owns a bounded in-memory Map (small FIFO cap so a
 * long reading session can't grow it unboundedly) and, when callers pass
 * `keyParts`, reads/writes the device-wide persistent `queryEmbeddingsRepo`.
 */
import type { EmbeddingProfile } from './embeddingPort';
import { queryEmbeddingsRepo } from '@data/repos/queryEmbeddings';

/** The fields that uniquely identify a query embedding (the cache key). */
export interface QueryEmbeddingKeyParts {
  model: string;
  dims: number;
  profile: EmbeddingProfile;
  bookId: string;
  query: string;
}

/** FIFO cap — generous for a single reading session, never unbounded. */
const MAX_ENTRIES = 64;

export class QueryEmbeddingCache {
  /** Insertion-ordered (Map preserves it) so eviction is FIFO. */
  private readonly entries = new Map<string, Promise<Float32Array>>();

  /** Normalized string key: query trimmed + lowercased, fields delimited. */
  keyOf(parts: QueryEmbeddingKeyParts): string {
    const query = parts.query.trim().toLowerCase();
    return [parts.model, String(parts.dims), parts.profile, parts.bookId, query].join(' ');
  }

  /**
   * Return the cached embedding promise for `key`, or compute it via `compute`
   * (and cache the PROMISE so concurrent identical queries share one call). A
   * rejected computation is evicted so a later retry can recompute.
   *
   * This uses a hybrid persistent cache: the vector is saved in IndexedDB
   * under a global key `${model}|${dims}|${query}` so it can be shared across
   * different books and sessions on this device.
   */
  getOrCompute(
    key: string,
    compute: () => Promise<Float32Array>,
    keyParts?: { query: string; model: string; dims: number }
  ): Promise<Float32Array> {
    const existing = this.entries.get(key);
    if (existing) return existing;

    const promise = (async () => {
      // 1. Check persistent database cache if keyParts are provided
      let globalDbKey = '';
      if (keyParts) {
        const queryNorm = keyParts.query.trim().toLowerCase();
        globalDbKey = `${keyParts.model}|${keyParts.dims}|${queryNorm}`;
        try {
          const cached = await queryEmbeddingsRepo.get(globalDbKey);
          if (cached) {
            return new Float32Array(cached.vector);
          }
        } catch (_err) {
          // Fallback to compute if DB read fails
        }
      }

      // 2. Compute vector
      const vector = await compute();

      // 3. Write to persistent database cache
      if (globalDbKey && keyParts) {
        try {
          await queryEmbeddingsRepo.put({
            key: globalDbKey,
            query: keyParts.query.trim(),
            model: keyParts.model,
            dims: keyParts.dims,
            vector: vector.buffer as ArrayBuffer,
            createdAt: Date.now(),
          });
        } catch (_err) {
          // Ignore write failures, don't block search
        }
      }

      return vector;
    })().catch((error) => {
      // Don't poison the cache with a failed embed — a retry must re-call.
      this.entries.delete(key);
      throw error;
    });

    this.entries.set(key, promise);
    this.evictIfNeeded();
    return promise;
  }

  private evictIfNeeded(): void {
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

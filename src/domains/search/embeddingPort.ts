/**
 * The embedding/repo PORT shapes the search-side semantic query path consumes
 * (Increment D). Declared HERE (not imported from @domains/google) so
 * domains/search stays inside its own boundary — the app reader controller
 * injects the real @domains/google embedding facade + repos, exactly like the
 * EmbeddingIndexer's injected ports (EmbeddingIndexer.ts:31-49).
 */
import type { CacheEmbeddingsRow } from '@data/rows/cache';

/**
 * The embedding task profile (mirrors @domains/google EmbeddingProfile —
 * contract.ts:20): `document` for corpus indexing, `query` for search-time
 * lookup. The asymmetric pair is what makes the cosine meaningful.
 */
export type EmbeddingProfile = 'document' | 'query';

/** The slice of the EmbeddingClient the semantic query path consumes. */
export interface EmbeddingClientPort {
  embed(
    texts: string[],
    opts: { profile: EmbeddingProfile; bookId?: string; interactive?: boolean; signal?: AbortSignal },
  ): Promise<{ vectors: Float32Array[] }>;
  /** Whether the client currently holds a usable configuration (API key). */
  isConfigured(): boolean;
}

/**
 * A `cache_embeddings` row as the repo READ path hands it over: the persisted
 * binary buffers are already re-wrapped as the typed-array views the cosine
 * ranking consumes (embeddings.ts:46 CacheEmbeddingsView).
 */
export type EmbeddedRowView = Omit<CacheEmbeddingsRow, 'sections'> & {
  sections: (Omit<CacheEmbeddingsRow['sections'][number], 'vectors' | 'scales'> & {
    vectors: Int8Array;
    scales: Float32Array;
  })[];
};

/** The slice of the embeddings repo the semantic query path consumes. */
export interface EmbeddingsSourcePort {
  get(bookId: string): Promise<EmbeddedRowView | undefined>;
}

/** The B3 int8 quantizer port (SearchEngine.quantizeInt8PerVector). */
export type QuantizePort = (vec: Float32Array) => { vectors: Int8Array; scale: number };

/** Semantic on/off + {model, dims}, read per call from the app store (injected). */
export type SemanticConfigPort = () => { enabled: boolean; model: string; dims: number };

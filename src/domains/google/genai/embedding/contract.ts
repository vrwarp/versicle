/**
 * EmbeddingClient contract (Increment C §1) — the GenAI EMBEDDING capability,
 * a sibling of the GenAIClient family (contract.ts:61). Implementations:
 * GeminiEmbeddingClient (REST `:embedContent` via the kernel NetworkGateway)
 * and MockEmbeddingClient (composition-root/test builds only — boundary
 * rule 9, like MockGenAIClient).
 *
 * The client returns FLOAT32 vectors; quantization to int8 is the
 * indexer/worker's job (B3 — `SearchEngine.quantizeInt8PerVector`), never the
 * client's, so the wire format stays a single concern of the storage layer.
 */

/**
 * The embedding task profile. `document` (corpus indexing) vs `query`
 * (search-time lookup) map to DIFFERENT API hints — the matched pair is what
 * makes the cosine meaningful (asymmetric retrieval embeddings):
 *  - gemini-embedding-001: `taskType: RETRIEVAL_DOCUMENT | RETRIEVAL_QUERY`,
 *  - gemini-embedding-2:   a prepended profile instruction on the text.
 */
export type EmbeddingProfile = 'document' | 'query';

export interface EmbeddingClient {
  /**
   * Embed `texts` under `opts.profile`. One `:embedContent` POST per text
   * (batching off by design §0/§8.1). The returned `vectors` are float32 and
   * positionally aligned with `texts`. `bookId`/`interactive` thread the
   * gateway's per-book consent gate; `signal` cancels.
   */
  embed(
    texts: string[],
    opts: {
      profile: EmbeddingProfile;
      bookId?: string;
      /** True when an explicit user gesture drove this exact call. */
      interactive?: boolean;
      signal?: AbortSignal;
    },
  ): Promise<{ vectors: Float32Array[] }>;
  /** Whether the client currently holds a usable configuration (API key). */
  isConfigured(): boolean;
}

export interface EmbeddingConfig {
  apiKey: string;
  /** The embedding model id (e.g. 'gemini-embedding-001'). */
  model: string;
  /** Requested output dimensionality (`outputDimensionality`). */
  dims: number;
}

/**
 * Read per call (never cached): mirrors {@link GenAIConfigProvider}
 * (contract.ts:80, GG-8) — a settings edit takes effect on the very next
 * embed call, with no mutable-singleton clobber.
 */
export type EmbeddingConfigProvider = () => EmbeddingConfig;

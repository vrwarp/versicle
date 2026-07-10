/**
 * EmbeddingClient contract — the GenAI text-embedding capability, a sibling of
 * the GenAIClient (chat) family. Implementations: GeminiEmbeddingClient (REST
 * `:embedContent` via the kernel NetworkGateway) and MockEmbeddingClient
 * (composition-root/test builds only).
 *
 * The client returns FLOAT32 vectors; quantization to int8 is the
 * indexer/worker's job, never the client's, so the wire format stays a single
 * concern of the storage layer.
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
   * Embed `texts` under `opts.profile`. By default, one `:embedContent` POST
   * per text. The returned `vectors` are float32 and positionally aligned with
   * `texts`. `bookId`/`interactive` thread the gateway's per-book consent gate;
   * `signal` cancels. `lane` selects the gateway quota lane (default `'fg'`):
   * the background backfill passes `lane: 'bg'` + `interactive: false` so it
   * uses the slow quota lane and never claims a user gesture; the profile and
   * consent semantics are otherwise unchanged.
   */
  embed(
    texts: string[],
    opts: {
      profile: EmbeddingProfile;
      bookId?: string;
      /** True when an explicit user gesture drove this exact call. */
      interactive?: boolean;
      /**
       * Gateway quota lane (default `'fg'`, the interactive query posture); the
       * foreground document indexer uses `'fgd'`, the background backfill `'bg'`.
       */
      lane?: 'fg' | 'fgd' | 'bg';
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
  /**
   * Batch-endpoint toggle, read fresh on every embed call. When falsy (the
   * default), the client issues one `:embedContent` POST per text. When true,
   * it packs up to 100 texts into ONE `:batchEmbedContents` requests[] call.
   * Default-off because it is unconfirmed whether Google's daily-request quota
   * counts a batch as one request or as one per content — until verified,
   * enabling it could silently blow the quota.
   */
  useBatchEmbedding?: boolean;
}

/**
 * Read per call, never cached (mirrors {@link GenAIConfigProvider}) — a
 * settings edit takes effect on the very next embed call, with no stale
 * singleton state to clobber.
 */
export type EmbeddingConfigProvider = () => EmbeddingConfig;

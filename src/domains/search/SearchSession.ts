/**
 * SearchSession — reader-session-scoped search (Phase 7 §F, PR-S1).
 *
 * Replaced the module singleton `searchClient` (`src/lib/search.ts`, DELETED
 * with the post-merge reader adoption): created per reading session (the
 * reader controller owns one), owns its engine lifecycle (`index()` /
 * `search()` / `dispose()`), and is constructor-injected with an
 * `engineFactory` so tests run the REAL engine in-process while production
 * wires the Comlink worker (`createWorkerSearchEngineFactory`).
 *
 * Failure semantics (search.md #6 — dead worker left `isIndexed:true` and
 * promises that never settled):
 *  - an engine error RESETS the session: caches cleared, handle disposed,
 *    pending index promises rejected, `onError` notified (UI maps it);
 *  - `dispose()` invalidates in-flight indexing via a generation counter and
 *    rejects pending promises (the old `terminate()` leaked them), and
 *    clears caches unconditionally.
 */
import { AppError, NetRateLimitedError } from '~types/errors';
import type { SearchBatchResult, SearchSection } from '~types/search';
import { QueryEmbeddingCache } from './queryEmbeddingCache';
import { fuseRrf } from './rrf';
import { semanticRank } from './semanticRank';
import type {
  SearchEngineProtocol,
  SearchEngineHandle,
  SearchEngineFactory,
  SearchTextSource,
} from './protocol';
import type {
  EmbeddingClientPort,
  EmbeddingsSourcePort,
  QuantizePort,
  SemanticConfigPort,
} from './embeddingPort';

// Re-exported so the published domain surface (index.ts) and existing importers
// of these contracts from './SearchSession' are unchanged — the declarations
// moved to ./protocol to break the SearchSession↔semanticRank import cycle.
export type {
  SearchEngineProtocol,
  SearchEngineHandle,
  SearchEngineFactory,
  SearchTextSource,
} from './protocol';

export type IndexOutcome = 'indexed' | 'no-text';

const BATCH_SIZE = 50;

/** Top-k chunk rows kept per section before RRF fusion (Increment D §2). */
const SEMANTIC_SECTION_LIMIT = 50;

/** The corpus row shape `textSource.get` resolves (mirrors {@link SearchTextSource}). */
type CorpusRow = Awaited<ReturnType<SearchTextSource['get']>>;

/** FIFO cap for the per-session corpus cache — generous for one reader open. */
const CORPUS_CACHE_MAX = 8;

export class SearchSession {
  private handle: SearchEngineHandle | null = null;
  private unsubscribeError: (() => void) | null = null;
  private indexedBooks = new Set<string>();
  private pendingIndexes = new Map<string, Promise<IndexOutcome>>();
  /** Bumped on dispose()/engine failure; in-flight work from older generations is void. */
  private generation = 0;
  /**
   * One query-embedding cache per session (Increment D §1): a repeated query
   * reuses the cached vector with NO second embed call, protecting the shared
   * daily RPD budget (design §5.2/§8.1).
   */
  private readonly queryEmbeddingCache = new QueryEmbeddingCache();
  /**
   * Per-session corpus cache (cleanup #10c): promise-memoizes the full-corpus
   * read (`textSource.get`) per bookId so repeated semantic queries in one
   * reading session don't re-load the entire book text on every keystroke.
   * Insertion-ordered (FIFO eviction); cleared on {@link reset} so a
   * disposed/failed session re-loads. A rejected read is evicted so a retry
   * re-calls. The extractionVersion stamp guard inside {@link semanticRank}
   * still invalidates on corpus drift, so this never serves a semantically
   * stale corpus past a re-extraction.
   */
  private readonly corpusCache = new Map<string, Promise<CorpusRow>>();

  constructor(
    private readonly opts: {
      engineFactory: SearchEngineFactory;
      /** Persisted-corpus source; index() falls back to it when no sections are passed. */
      textSource?: SearchTextSource;
      /** Notified once per engine failure AFTER the session has reset itself. */
      onError?: (error: unknown) => void;
      /**
       * The foreground document-embedding indexer (Increment C §4), wired by
       * the app reader controller from the @domains/google embedding facade +
       * repos. Optional — absent in the regex-only/test paths, where
       * {@link enqueueEmbedding} is a no-op. Preserves the engineFactory /
       * textSource seam: bookId/CFI flow as arguments, no store edge.
       */
      embeddingIndexer?: { enqueue(bookId: string, currentCfi?: string): Promise<void> };
      /**
       * Increment D — hybrid semantic query ports, ALL optional so the
       * regex-only/test constructions are untouched. When all are present AND
       * semantic is enabled+configured+embedded, {@link search} fuses a
       * semantic-cosine ranking into the regex result (RRF). On ANY miss or
       * thrown error the regex result is returned UNCHANGED (regex is the
       * DEFAULT). Wired by the app reader controller from the @domains/google
       * embedding facade + the embeddings repo + the B3 quantizer; semantic
       * on/off + {model,dims} arrive via {@link getSemanticConfig}, never a
       * store import inside the domain.
       */
      embeddingClient?: EmbeddingClientPort;
      embeddingsSource?: EmbeddingsSourcePort;
      quantize?: QuantizePort;
      getSemanticConfig?: SemanticConfigPort;
    },
  ) {}

  private engine(): SearchEngineProtocol {
    if (!this.handle) {
      this.handle = this.opts.engineFactory();
      this.unsubscribeError = this.handle.onError?.((error) => this.handleEngineFailure(error)) ?? null;
    }
    return this.handle.engine;
  }

  /**
   * A {@link SearchTextSource} that promise-memoizes the per-bookId corpus read
   * against {@link corpusCache} (cleanup #10c), so a stream of semantic queries
   * in one session reads the full corpus at most once per book. A rejected read
   * is evicted (a retry re-calls); the cache is FIFO-bounded and cleared on
   * {@link reset}. `base` is the real injected source.
   */
  private memoizingTextSource(base: SearchTextSource): SearchTextSource {
    return {
      get: (bookId: string): Promise<CorpusRow> => {
        const cached = this.corpusCache.get(bookId);
        if (cached) return cached;

        const promise = base.get(bookId).catch((error) => {
          // Don't poison the cache with a failed read — a retry must re-call.
          this.corpusCache.delete(bookId);
          throw error;
        });
        this.corpusCache.set(bookId, promise);
        while (this.corpusCache.size > CORPUS_CACHE_MAX) {
          const oldest = this.corpusCache.keys().next().value;
          if (oldest === undefined) break;
          this.corpusCache.delete(oldest);
        }
        return promise;
      },
    };
  }

  /** True when the session has a live index for the book. */
  isIndexed(bookId: string): boolean {
    return this.indexedBooks.has(bookId);
  }

  /**
   * Index a book. `sections` (e.g. fresh extraction output) wins; otherwise
   * the persisted corpus is loaded. Returns 'no-text' when neither exists —
   * the caller decides whether to extract (reader-side, post-merge).
   * Concurrent calls for the same book share one task.
   */
  index(bookId: string, sections?: SearchSection[]): Promise<IndexOutcome> {
    if (this.indexedBooks.has(bookId)) return Promise.resolve('indexed');

    const pending = this.pendingIndexes.get(bookId);
    if (pending) return pending;

    const generation = this.generation;
    const task = this.indexInternal(bookId, generation, sections).finally(() => {
      // Only this generation's entry — a reset has already cleared the map.
      if (this.generation === generation) this.pendingIndexes.delete(bookId);
    });
    this.pendingIndexes.set(bookId, task);
    return task;
  }

  private async indexInternal(
    bookId: string,
    generation: number,
    sections?: SearchSection[],
  ): Promise<IndexOutcome> {
    let docs = sections;
    if (!docs) {
      const row = await this.opts.textSource?.get(bookId);
      this.assertLive(generation);
      if (!row) return 'no-text';
      docs = row.sections.map((s, i) => ({ id: `${bookId}-${i}`, href: s.href, title: s.title, text: s.text }));
    }

    const engine = this.engine();
    await engine.initIndex(bookId);
    this.assertLive(generation);

    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      await engine.addDocuments(bookId, docs.slice(i, i + BATCH_SIZE));
      this.assertLive(generation);
    }

    this.indexedBooks.add(bookId);
    return 'indexed';
  }

  /**
   * Per-occurrence results with an honest truncation flag.
   *
   * Regex full-text is the DEFAULT (Increment D §4): the regex `searchDetailed`
   * always runs. The semantic branch is entered ONLY when ALL hold — the
   * semantic ports were injected, semantic search is ON, the embedding client
   * reports configured, and the book has a non-empty embedded row. When it
   * succeeds the semantic ranking is FUSED into the regex result via RRF
   * (regex never disappears). On ANY miss (off / unconfigured / not-embedded)
   * or ANY thrown error (quota-exhausted NET_RATE_LIMITED/429, network
   * failure) the regex result is returned UNCHANGED — semantic is purely
   * additive and can never break or regress full-text search.
   */
  async search(bookId: string, query: string, opts?: { limit?: number }): Promise<SearchBatchResult> {
    const engine = this.engine();
    const regex = await engine.searchDetailed(bookId, query, opts);

    const { embeddingClient, embeddingsSource, quantize, getSemanticConfig, textSource } = this.opts;
    if (!embeddingClient || !embeddingsSource || !quantize || !getSemanticConfig || !textSource) {
      return regex;
    }
    const semanticConfig = getSemanticConfig();
    if (!semanticConfig.enabled || !embeddingClient.isConfigured()) return regex;

    const trimmed = query.trim();
    if (trimmed.length === 0) return regex;

    try {
      const semantic = await semanticRank({
        engine,
        embeddingClient,
        embeddingsSource,
        // Memoize the full-corpus read per book for this session (cleanup #10c):
        // repeated queries reuse the loaded corpus instead of re-reading it.
        textSource: this.memoizingTextSource(textSource),
        quantize,
        queryCache: this.queryEmbeddingCache,
        config: { model: semanticConfig.model, dims: semanticConfig.dims },
        bookId,
        query: trimmed,
        limit: opts?.limit ?? SEMANTIC_SECTION_LIMIT,
      });
      // Not embedded / stamp-mismatch / no hits → keep the pure regex result.
      if (semantic.length === 0) return regex;
      return fuseRrf(regex.results, semantic, { truncated: regex.truncated });
    } catch (error) {
      // Only EXPECTED quota/network errors fall back to regex (semantic is
      // purely additive and must never regress full-text). Anything else (a
      // genuine bug in the semantic path) is rethrown so it surfaces instead of
      // being silently swallowed.
      if (isExpectedSearchFallbackError(error)) return regex;
      throw error;
    }
  }

  /**
   * Trigger the foreground document-embedding pass for `bookId`, outward from
   * `currentCfi` (Increment C §4). No-op when no indexer was injected. bookId
   * and CFI are ARGUMENTS — the trigger context comes from the app reader
   * controller, never a store.
   */
  async enqueueEmbedding(bookId: string, currentCfi?: string): Promise<void> {
    await this.opts.embeddingIndexer?.enqueue(bookId, currentCfi);
  }

  /**
   * Release everything. Idempotent. In-flight `index()` calls reject with
   * SEARCH_SESSION_DISPOSED; caches are cleared unconditionally.
   */
  dispose(): void {
    this.reset();
  }

  private handleEngineFailure(error: unknown): void {
    this.reset();
    this.opts.onError?.(error);
  }

  private reset(): void {
    this.generation += 1;
    this.unsubscribeError?.();
    this.unsubscribeError = null;
    this.handle?.dispose();
    this.handle = null;
    this.indexedBooks.clear();
    this.pendingIndexes.clear();
    // Drop the per-session corpus cache (cleanup #10c) so a disposed/failed
    // session re-loads the corpus on its next semantic query.
    this.corpusCache.clear();
  }

  private assertLive(generation: number): void {
    if (this.generation !== generation) {
      throw new AppError('Search session disposed during indexing', {
        code: 'SEARCH_SESSION_DISPOSED',
      });
    }
  }
}

/**
 * True for the EXPECTED quota/network errors the semantic path may throw, which
 * are tolerated by falling back to the regex result. Branches STRUCTURALLY (no
 * cross-domain import of the google GenAIHttpError class, which would trip the
 * domains barrier): a pre-network {@link NetRateLimitedError}; the GenAI HTTP
 * 429/5xx path (an {@link AppError} with `code === 'GENAI_UNKNOWN'` or
 * `retryable`); or a raw network failure (DOMException `AbortError` / a fetch
 * `TypeError`). Any other error is unexpected and is rethrown by the caller.
 */
function isExpectedSearchFallbackError(error: unknown): boolean {
  if (error instanceof NetRateLimitedError) return true;
  if (error instanceof AppError) {
    return error.code === 'GENAI_UNKNOWN' || error.retryable;
  }
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  return error instanceof TypeError;
}

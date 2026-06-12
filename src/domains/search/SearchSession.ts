/**
 * SearchSession — reader-session-scoped search (Phase 7 §F, PR-S1).
 *
 * Replaces the module singleton `searchClient` (`src/lib/search.ts:204`) for
 * everything OUTSIDE the frozen reader components: created per reading
 * session, owns its engine lifecycle (`index()` / `search()` / `dispose()`),
 * and is constructor-injected with an `engineFactory` so tests run the REAL
 * engine in-process while production wires the Comlink worker
 * (`createWorkerSearchEngineFactory`).
 *
 * NOTE (sub-track boundary): the reader still uses `searchClient` — the P6
 * chain owns `ReaderView`/`SearchPanel`, so reader adoption (providing a
 * session via context, deleting the singleton + `scrollToText`) is the named
 * post-merge follow-up. Nothing here imports reader files.
 *
 * Failure semantics (search.md #6 — dead worker left `isIndexed:true` and
 * promises that never settled):
 *  - an engine error RESETS the session: caches cleared, handle disposed,
 *    pending index promises rejected, `onError` notified (UI maps it);
 *  - `dispose()` invalidates in-flight indexing via a generation counter and
 *    rejects pending promises (the old `terminate()` leaked them), and
 *    clears caches unconditionally.
 */
import { AppError } from '~types/errors';
import type { SearchBatchResult, SearchSection } from '~types/search';

/** The engine surface the session needs — satisfied by the real SearchEngine and its Comlink remote. */
export interface SearchEngineProtocol {
  initIndex(bookId: string): void | Promise<void>;
  addDocuments(bookId: string, sections: SearchSection[]): void | Promise<void>;
  searchDetailed(
    bookId: string,
    query: string,
    opts?: { limit?: number },
  ): SearchBatchResult | Promise<SearchBatchResult>;
}

export interface SearchEngineHandle {
  engine: SearchEngineProtocol;
  /** Release the underlying resource (terminate the worker). */
  dispose(): void;
  /** Subscribe to fatal engine errors (worker `onerror`). Returns unsubscribe. */
  onError?(listener: (error: unknown) => void): () => void;
}

export type SearchEngineFactory = () => SearchEngineHandle;

/** Read access to the persisted corpus (the data repo, injected to keep this module store/data-free in tests). */
export interface SearchTextSource {
  get(bookId: string): Promise<
    | { extractionVersion: number; sections: { href: string; title: string; text: string }[] }
    | undefined
  >;
}

export type IndexOutcome = 'indexed' | 'no-text';

const BATCH_SIZE = 50;

export class SearchSession {
  private handle: SearchEngineHandle | null = null;
  private unsubscribeError: (() => void) | null = null;
  private indexedBooks = new Set<string>();
  private pendingIndexes = new Map<string, Promise<IndexOutcome>>();
  /** Bumped on dispose()/engine failure; in-flight work from older generations is void. */
  private generation = 0;

  constructor(
    private readonly opts: {
      engineFactory: SearchEngineFactory;
      /** Persisted-corpus source; index() falls back to it when no sections are passed. */
      textSource?: SearchTextSource;
      /** Notified once per engine failure AFTER the session has reset itself. */
      onError?: (error: unknown) => void;
    },
  ) {}

  private engine(): SearchEngineProtocol {
    if (!this.handle) {
      this.handle = this.opts.engineFactory();
      this.unsubscribeError = this.handle.onError?.((error) => this.handleEngineFailure(error)) ?? null;
    }
    return this.handle.engine;
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

  /** Per-occurrence results with an honest truncation flag. */
  async search(bookId: string, query: string, opts?: { limit?: number }): Promise<SearchBatchResult> {
    return this.engine().searchDetailed(bookId, query, opts);
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
  }

  private assertLive(generation: number): void {
    if (this.generation !== generation) {
      throw new AppError('Search session disposed during indexing', {
        code: 'SEARCH_SESSION_DISPOSED',
      });
    }
  }
}

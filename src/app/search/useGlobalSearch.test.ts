/**
 * useGlobalSearch suite — the whole-library semantic query.
 *
 * Runs the hook against the REAL library projection (books seeded into
 * `useBookStore`, exactly like libraryViewStore.test.ts) and the REAL GenAI
 * store, with the data repos, the embedding client and the search-engine
 * handle injected as PORTS (the hook's `deps` argument) instead of mocked
 * modules — the harness rule: prefer a DI seam over `vi.mock` of repos.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useGlobalSearch } from './useGlobalSearch';
import { useBookStore } from '@store/useBookStore';
import { useLibraryStore } from '@store/useLibraryStore';
import { useReadingStateStore } from '@store/useReadingStateStore';
import { useReadingListStore } from '@store/useReadingListStore';
import { useGenAIStore } from '@store/useGenAIStore';
import { useSearchHistoryStore } from '@store/useSearchHistoryStore';
import { makeInventoryItem } from '@test/harness';
import type { UserInventoryItem } from '~types/user-data';
import type { CacheEmbedJobsRow, CacheSearchTextRow } from '@data/rows/cache';
import type { EmbeddedRowView } from '@domains/search/embeddingPort';
import type { SearchEngineHandle } from '@domains/search';

const DIMS = 4;
const MODEL = 'gemini-embedding-2';
const SECTION_TEXT =
  'Call me Ishmael. Some years ago, never mind how long precisely, having little or no money in my purse.';

const seedBooks = (...bookIds: string[]) => {
  const books: Record<string, UserInventoryItem> = {};
  for (const bookId of bookIds) books[bookId] = makeInventoryItem({ bookId });
  act(() => {
    useBookStore.setState({ books });
  });
};

/** A `cache_search_text` row with `count` sections. */
const corpusRow = (bookId: string, count: number): CacheSearchTextRow => ({
  bookId,
  extractionVersion: 3,
  sections: Array.from({ length: count }, (_unused, i) => ({
    href: `s${i}.xhtml`,
    title: `Section ${i}`,
    text: SECTION_TEXT,
    sectionTextHash: `h${i}`,
  })),
});

/** A `cache_embeddings` read view with `count` sections of `chunks` rows each. */
const embeddedRow = (bookId: string, count: number, chunks = 1): EmbeddedRowView => ({
  bookId,
  model: MODEL,
  dims: DIMS,
  quant: 'int8-pervec',
  extractionVersion: 3,
  sections: Array.from({ length: count }, (_unused, i) => ({
    href: `s${i}.xhtml`,
    sectionTextHash: `h${i}`,
    chunks: Array.from({ length: chunks }, (_c, row) => ({
      cfiStart: '',
      cfiEnd: '',
      tokenCount: 9,
      charStart: row,
      charEnd: row + 16,
    })),
    vectors: new Int8Array(DIMS * chunks),
    scales: new Float32Array(chunks).fill(1),
  })),
});

const jobRow = (bookId: string, embedded: number, embeddable: number): CacheEmbedJobsRow => ({
  bookId,
  extractionVersion: 3,
  sections: Array.from({ length: embedded }, (_unused, i) => ({
    href: `s${i}.xhtml`,
    embeddedThroughChunk: 1,
    sectionTextHash: `h${i}`,
  })),
  embeddableSections: embeddable,
  updatedAt: 0,
});

interface HarnessOptions {
  corpora?: Map<string, CacheSearchTextRow>;
  embeddings?: Map<string, EmbeddedRowView>;
  jobs?: Map<string, CacheEmbedJobsRow>;
  /** Rows the fake engine returns per section. */
  rowsPerSection?: number;
}

/** Injected ports + the spies each test asserts on. */
function makeDeps(opts: HarnessOptions = {}) {
  const corpora = opts.corpora ?? new Map<string, CacheSearchTextRow>();
  const embeddings = opts.embeddings ?? new Map<string, EmbeddedRowView>();
  const jobs = opts.jobs ?? new Map<string, CacheEmbedJobsRow>();
  const rowsPerSection = opts.rowsPerSection ?? 1;

  const rankInt8 = vi.fn(async () =>
    Array.from({ length: rowsPerSection }, (_unused, row) => ({ row, cosine: 1 - row / 1000 })),
  );
  const engine = {
    rankInt8,
    findBestSentences: vi.fn(async () => [{ index: 0, cosine: 1, scores: [] as number[] }]),
    initIndex: vi.fn(),
    addDocuments: vi.fn(),
    searchDetailed: vi.fn(() => ({ results: [], truncated: false })),
  };
  const dispose = vi.fn();
  const createSearchEngine = vi.fn((): SearchEngineHandle => ({
    engine: engine as unknown as SearchEngineHandle['engine'],
    dispose,
  }));

  const embeddingsGet = vi.fn(async (bookId: string) => embeddings.get(bookId));
  const embeddingsGetJob = vi.fn(async (bookId: string) => jobs.get(bookId));
  const searchTextGet = vi.fn(async (bookId: string) => corpora.get(bookId));
  const embed = vi.fn(async () => ({ vectors: [new Float32Array([1, 0, 0, 0])] }));
  const getExcerpt = vi.fn((text: string, charOffset: number) => text.slice(charOffset, charOffset + 40));
  const segmentSentences = vi.fn(() => [{ start: 0, end: 10 }]);

  // An in-memory stand-in for the module-level QueryEmbeddingCache: same
  // memoization contract, no `cache_query_embeddings` side database, and no
  // state shared between tests.
  const cached = new Map<string, Promise<Float32Array>>();
  const queryCache = {
    keyOf: (parts: { model: string; dims: number; profile: string; bookId: string; query: string }) =>
      [parts.model, String(parts.dims), parts.profile, parts.bookId, parts.query.trim().toLowerCase()].join(' '),
    getOrCompute: (key: string, compute: () => Promise<Float32Array>) => {
      const existing = cached.get(key);
      if (existing) return existing;
      const promise = compute();
      cached.set(key, promise);
      return promise;
    },
  };

  const deps = {
    embeddingsRepo: { get: embeddingsGet, getJob: embeddingsGetJob },
    searchTextRepo: { get: searchTextGet },
    queryEmbeddingsRepo: { get: vi.fn(async () => undefined) },
    getEmbeddingClient: () => ({ embed }),
    queryCache,
    createSearchEngine,
    getExcerpt,
    segmentSentences,
  };

  return {
    deps,
    spies: { embeddingsGet, embeddingsGetJob, searchTextGet, embed, rankInt8, getExcerpt, segmentSentences, createSearchEngine, dispose },
  };
}

describe('useGlobalSearch', () => {
  beforeEach(() => {
    act(() => {
      useBookStore.setState({ books: {} });
      useLibraryStore.setState({ staticMetadata: {}, offloadedBookIds: new Set() });
      useReadingStateStore.setState({ progress: {} });
      useReadingListStore.setState({ entries: {} });
      useSearchHistoryStore.setState({ recentQueries: [], savedQueries: [] });
      useGenAIStore.setState({
        isEnabled: true,
        apiKey: 'test-key',
        embeddingModel: MODEL,
        embeddingDims: DIMS,
      });
    });
    // jsdom reports offline unless told otherwise; the hook short-circuits
    // offline queries that miss the query-vector cache.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  });

  /**
   * `useAllBooks()` hands back a NEW array on every library-projection
   * recompute — a progress write, a sync tick, an import. `executeSearch` used
   * to be keyed on that array, and the view re-runs the query whenever the
   * callback's identity changes, so the whole library was re-read (every book's
   * vectors AND its entire text) several times per reading second, with no
   * in-flight guard. The library is now read through a ref.
   */
  describe('regression: global search does not reload the library per store write', () => {
    it('keeps executeSearch stable and re-reads nothing when a progress write lands', async () => {
      seedBooks('bk-1', 'bk-2');
      const { deps, spies } = makeDeps({
        corpora: new Map([['bk-1', corpusRow('bk-1', 2)], ['bk-2', corpusRow('bk-2', 2)]]),
        embeddings: new Map([['bk-1', embeddedRow('bk-1', 2)], ['bk-2', embeddedRow('bk-2', 2)]]),
        // Stamped job rows, so the badge effect reads neither repo (finding 5)
        // and the counts below belong to the QUERY alone.
        jobs: new Map([['bk-1', jobRow('bk-1', 2, 2)], ['bk-2', jobRow('bk-2', 2, 2)]]),
      });

      const { result, rerender } = renderHook(() => useGlobalSearch(deps));
      await act(async () => {
        await result.current.executeSearch('whale');
      });
      expect(result.current.status).toBe('success');

      const firstExecute = result.current.executeSearch;
      const readsAfterSearch = spies.embeddingsGet.mock.calls.length;
      const textReadsAfterSearch = spies.searchTextGet.mock.calls.length;
      expect(readsAfterSearch).toBe(2); // one per book, once

      // A progress write: same books, brand-new projection array.
      await act(async () => {
        useReadingStateStore.setState({
          progress: { 'bk-1': { device: { bookId: 'bk-1', percentage: 10, lastRead: 5, completedRanges: [] } } },
        });
      });
      rerender();
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.executeSearch).toBe(firstExecute);
      expect(spies.embeddingsGet.mock.calls.length).toBe(readsAfterSearch);
      expect(spies.searchTextGet.mock.calls.length).toBe(textReadsAfterSearch);
    });

    it('still re-runs the active query when the library MEMBERSHIP changes', async () => {
      seedBooks('bk-1');
      const { deps, spies } = makeDeps({
        corpora: new Map([['bk-1', corpusRow('bk-1', 1)], ['bk-2', corpusRow('bk-2', 1)]]),
        embeddings: new Map([['bk-1', embeddedRow('bk-1', 1)], ['bk-2', embeddedRow('bk-2', 1)]]),
      });

      const { result } = renderHook(() => useGlobalSearch(deps));
      await act(async () => {
        await result.current.executeSearch('whale');
      });
      expect(result.current.results.map((g) => g.bookId)).toEqual(['bk-1']);

      // A second book is imported — the query must pick it up.
      await act(async () => {
        seedBooks('bk-1', 'bk-2');
      });
      await waitFor(() => {
        expect(result.current.results.map((g) => g.bookId).sort()).toEqual(['bk-1', 'bk-2']);
      });
      expect(spies.embeddingsGet).toHaveBeenCalledWith('bk-2');
    });

    it('abandons a superseded run (the newest query owns the results)', async () => {
      seedBooks('bk-1');
      const corpora = new Map([['bk-1', corpusRow('bk-1', 1)]]);
      const embeddings = new Map([['bk-1', embeddedRow('bk-1', 1)]]);
      const jobs = new Map([['bk-1', jobRow('bk-1', 1, 1)]]);
      const { deps } = makeDeps({ corpora, embeddings, jobs });

      // The first run parks inside the embeddings read until released.
      let release!: () => void;
      const parked = new Promise<void>((resolve) => {
        release = resolve;
      });
      let reads = 0;
      deps.embeddingsRepo.get = vi.fn(async (bookId: string) => {
        reads += 1;
        if (reads === 1) await parked;
        return embeddings.get(bookId);
      });

      const { result } = renderHook(() => useGlobalSearch(deps));
      let slow!: Promise<void>;
      act(() => {
        slow = result.current.executeSearch('slow query');
      });
      // Only once the first run is parked does the second one start, so the
      // ordering under test is the real one (an older run finishing LAST).
      await waitFor(() => {
        expect(reads).toBe(1);
      });
      await act(async () => {
        await result.current.executeSearch('fast query');
      });
      expect(result.current.query).toBe('fast query');
      const afterFast = result.current.results;

      await act(async () => {
        release();
        await slow;
      });
      // The superseded run wrote nothing.
      expect(result.current.query).toBe('fast query');
      expect(result.current.results).toBe(afterFast);
    });
  });

  /**
   * The engine handle used to be disposed and RE-CREATED for every query, and
   * the worker lazily instantiates a multi-megabyte wasm engine on first use.
   * One handle per hook instance; supersession is the run token's job.
   */
  describe('regression: the search worker is created once per hook instance', () => {
    it('creates one engine across three sequential searches and disposes it on unmount', async () => {
      seedBooks('bk-1');
      const { deps, spies } = makeDeps({
        corpora: new Map([['bk-1', corpusRow('bk-1', 1)]]),
        embeddings: new Map([['bk-1', embeddedRow('bk-1', 1)]]),
      });

      const { result, unmount } = renderHook(() => useGlobalSearch(deps));
      for (const query of ['first', 'second', 'third']) {
        await act(async () => {
          await result.current.executeSearch(query);
        });
      }

      expect(spies.createSearchEngine).toHaveBeenCalledTimes(1);
      expect(spies.dispose).not.toHaveBeenCalled();

      unmount();
      expect(spies.dispose).toHaveBeenCalledTimes(1);
    });

    it('still heals after an engine failure (the next query builds a fresh one)', async () => {
      seedBooks('bk-1');
      const { deps, spies } = makeDeps({
        corpora: new Map([['bk-1', corpusRow('bk-1', 1)]]),
        embeddings: new Map([['bk-1', embeddedRow('bk-1', 1)]]),
        jobs: new Map([['bk-1', jobRow('bk-1', 1, 1)]]),
      });
      spies.rankInt8.mockRejectedValueOnce(new Error('worker died'));

      const { result } = renderHook(() => useGlobalSearch(deps));
      await act(async () => {
        await result.current.executeSearch('first');
      });
      expect(result.current.status).toBe('error');
      expect(spies.dispose).toHaveBeenCalledTimes(1);

      await act(async () => {
        await result.current.executeSearch('second');
      });
      expect(result.current.status).toBe('success');
      expect(spies.createSearchEngine).toHaveBeenCalledTimes(2);
    });
  });

  /**
   * Ranking kept up to 20 rows per section per book and MATERIALIZED every one
   * of them — a `getExcerpt` plus an `Intl.Segmenter` pass each, on the main
   * thread, before anything was sorted. Ranking and materialization are now
   * separate: tuples are sorted and cut to TOP_K first.
   */
  describe('regression: global search caps materialized hits', () => {
    it('materializes at most TOP_K hits however many rows rank', async () => {
      seedBooks('bk-1');
      const { deps, spies } = makeDeps({
        corpora: new Map([['bk-1', corpusRow('bk-1', 200)]]),
        embeddings: new Map([['bk-1', embeddedRow('bk-1', 200, 20)]]),
        rowsPerSection: 20,
      });

      const { result } = renderHook(() => useGlobalSearch(deps));
      await act(async () => {
        await result.current.executeSearch('whale');
      });

      // 200 sections × 20 rows = 4000 ranked hits…
      expect(spies.rankInt8).toHaveBeenCalledTimes(200);
      const total = result.current.results.reduce((n, group) => n + group.matches.length, 0);
      expect(total).toBe(100);
      // …but only the survivors were excerpted/segmented.
      expect(spies.getExcerpt.mock.calls.length).toBeLessThanOrEqual(100);
      // (the async sentence re-rank segments the top 5 again — hence the slack)
      expect(spies.segmentSentences.mock.calls.length).toBeLessThanOrEqual(105);
      // Ordering is preserved: strictly descending similarity.
      const scores = result.current.results.flatMap((g) => g.matches.map((m) => m.similarity ?? 0));
      expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    });
  });

  /**
   * The TOP_K cut was SILENT: nothing in the hook's return value or the view
   * said the list had been cut, so a page filled by one strongly-matching book
   * (20 rows per section, ~15% chunk overlap → near-duplicate high-scoring
   * tuples) read as "Found 100 match(es)" — the whole answer, with every other
   * book's best passage quietly gone.
   */
  describe('regression: global search reports the TOP_K cut', () => {
    it('flags truncation when more tuples ranked than the page holds', async () => {
      seedBooks('bk-1');
      const { deps } = makeDeps({
        corpora: new Map([['bk-1', corpusRow('bk-1', 200)]]),
        embeddings: new Map([['bk-1', embeddedRow('bk-1', 200, 20)]]),
        rowsPerSection: 20,
      });

      const { result } = renderHook(() => useGlobalSearch(deps));
      await act(async () => {
        await result.current.executeSearch('whale');
      });

      // 200 sections x 20 rows = 4000 ranked tuples, cut to a page of 100.
      const total = result.current.results.reduce((n, group) => n + group.matches.length, 0);
      expect(total).toBe(100);
      expect(result.current.truncated).toBe(true);
    });

    it('does not flag truncation when the whole ranking fits on the page', async () => {
      seedBooks('bk-1');
      const { deps } = makeDeps({
        corpora: new Map([['bk-1', corpusRow('bk-1', 2)]]),
        embeddings: new Map([['bk-1', embeddedRow('bk-1', 2)]]),
      });

      const { result } = renderHook(() => useGlobalSearch(deps));
      await act(async () => {
        await result.current.executeSearch('whale');
      });

      const total = result.current.results.reduce((n, group) => n + group.matches.length, 0);
      expect(total).toBe(2);
      expect(result.current.truncated).toBe(false);
    });

    it('clears the flag when a later query is not cut', async () => {
      seedBooks('bk-big', 'bk-small');
      const { deps } = makeDeps({
        corpora: new Map([
          ['bk-big', corpusRow('bk-big', 200)],
          ['bk-small', corpusRow('bk-small', 1)],
        ]),
        embeddings: new Map([
          ['bk-big', embeddedRow('bk-big', 200, 20)],
          ['bk-small', embeddedRow('bk-small', 1)],
        ]),
        rowsPerSection: 20,
      });

      const { result } = renderHook(() => useGlobalSearch(deps));
      await act(async () => {
        await result.current.executeSearch('whale');
      });
      expect(result.current.truncated).toBe(true);

      // An empty query resets the view — the stale notice must go with it.
      await act(async () => {
        await result.current.executeSearch('   ');
      });
      expect(result.current.truncated).toBe(false);
    });
  });

  /**
   * The badge grid read EVERY book's entire search text AND its entire packed
   * vector row just to decide indexed/partial/unindexed. The stamped job row
   * answers it on its own.
   */
  describe('regression: indexing badges read the job row alone', () => {
    it('never loads the corpus or the vectors when every book has a stamped job row', async () => {
      seedBooks('bk-1', 'bk-2');
      const { deps, spies } = makeDeps({
        jobs: new Map([
          ['bk-1', jobRow('bk-1', 4, 4)],
          ['bk-2', jobRow('bk-2', 1, 4)],
        ]),
      });

      const { result } = renderHook(() => useGlobalSearch(deps));
      await waitFor(() => {
        expect(result.current.indexingStatuses).toHaveLength(2);
      });

      const byId = new Map(result.current.indexingStatuses.map((s) => [s.bookId, s]));
      expect(byId.get('bk-1')).toMatchObject({ status: 'indexed' });
      expect(byId.get('bk-2')).toMatchObject({
        status: 'partial',
        progressLabel: '1/4 chapters',
        progressPercent: 25,
      });
      expect(spies.searchTextGet).not.toHaveBeenCalled();
      expect(spies.embeddingsGet).not.toHaveBeenCalled();
      expect(spies.embeddingsGetJob).toHaveBeenCalledTimes(2);
    });

    it('falls back to the full rows for a book whose job row lacks the stamp', async () => {
      seedBooks('bk-legacy');
      const legacyJob: CacheEmbedJobsRow = {
        bookId: 'bk-legacy',
        extractionVersion: 3,
        sections: [{ href: 's0.xhtml', embeddedThroughChunk: 1, sectionTextHash: 'h0' }],
        updatedAt: 0,
      };
      const { deps, spies } = makeDeps({
        corpora: new Map([['bk-legacy', corpusRow('bk-legacy', 4)]]),
        embeddings: new Map([['bk-legacy', embeddedRow('bk-legacy', 1)]]),
        jobs: new Map([['bk-legacy', legacyJob]]),
      });

      const { result } = renderHook(() => useGlobalSearch(deps));
      await waitFor(() => {
        expect(result.current.indexingStatuses).toHaveLength(1);
      });

      expect(result.current.indexingStatuses[0]).toMatchObject({
        status: 'partial',
        progressLabel: '1/4 chapters',
        progressPercent: 25,
      });
      expect(spies.searchTextGet).toHaveBeenCalledWith('bk-legacy');
      expect(spies.embeddingsGet).toHaveBeenCalledWith('bk-legacy');
    });

    it('reports an unindexed book with no rows at all', async () => {
      seedBooks('bk-empty');
      const { deps } = makeDeps();

      const { result } = renderHook(() => useGlobalSearch(deps));
      await waitFor(() => {
        expect(result.current.indexingStatuses).toHaveLength(1);
      });
      expect(result.current.indexingStatuses[0]).toMatchObject({ status: 'unindexed' });
    });
  });

  describe('query lifecycle', () => {
    it('reports an unconfigured client without reading any row', async () => {
      seedBooks('bk-1');
      act(() => {
        useGenAIStore.setState({ apiKey: '' });
      });
      const { deps, spies } = makeDeps({
        corpora: new Map([['bk-1', corpusRow('bk-1', 1)]]),
        embeddings: new Map([['bk-1', embeddedRow('bk-1', 1)]]),
        jobs: new Map([['bk-1', jobRow('bk-1', 1, 1)]]), // badge needs no row read
      });

      const { result } = renderHook(() => useGlobalSearch(deps));
      await act(async () => {
        await result.current.executeSearch('whale');
      });

      expect(result.current.status).toBe('error');
      expect(result.current.errorType).toBe('unconfigured');
      expect(spies.embeddingsGet).not.toHaveBeenCalled();
    });

    it('spends no embedding quota when nothing in the library is indexed', async () => {
      seedBooks('bk-1');
      const { deps, spies } = makeDeps();

      const { result } = renderHook(() => useGlobalSearch(deps));
      await act(async () => {
        await result.current.executeSearch('whale');
      });

      expect(result.current.status).toBe('success');
      expect(result.current.results).toEqual([]);
      expect(spies.embed).not.toHaveBeenCalled();
    });

    it('embeds the query once for the whole library and records it in history', async () => {
      seedBooks('bk-1', 'bk-2');
      const { deps, spies } = makeDeps({
        corpora: new Map([['bk-1', corpusRow('bk-1', 2)], ['bk-2', corpusRow('bk-2', 2)]]),
        embeddings: new Map([['bk-1', embeddedRow('bk-1', 2)], ['bk-2', embeddedRow('bk-2', 2)]]),
      });

      const { result } = renderHook(() => useGlobalSearch(deps));
      await act(async () => {
        await result.current.executeSearch('whale');
      });

      expect(spies.embed).toHaveBeenCalledTimes(1);
      expect(useSearchHistoryStore.getState().recentQueries.map((q) => q.query)).toContain('whale');
      expect(result.current.results.length).toBeGreaterThan(0);
      for (const group of result.current.results) {
        for (const match of group.matches) expect(match.excerpt).not.toBe('');
      }
    });

    it('clears everything on an empty query', async () => {
      seedBooks('bk-1');
      const { deps } = makeDeps({
        corpora: new Map([['bk-1', corpusRow('bk-1', 1)]]),
        embeddings: new Map([['bk-1', embeddedRow('bk-1', 1)]]),
      });

      const { result } = renderHook(() => useGlobalSearch(deps));
      await act(async () => {
        await result.current.executeSearch('whale');
      });
      expect(result.current.results.length).toBeGreaterThan(0);

      await act(async () => {
        await result.current.executeSearch('   ');
      });
      expect(result.current.query).toBe('');
      expect(result.current.results).toEqual([]);
      expect(result.current.status).toBe('idle');
    });
  });
});

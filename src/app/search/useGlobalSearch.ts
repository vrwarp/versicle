import { useState, useEffect, useCallback, useRef } from 'react';
import { useAllBooks, type LibraryBook } from '@store/libraryViewStore';
import { useSearchHistoryStore } from '@store/useSearchHistoryStore';
import { useGenAIStore } from '@store/useGenAIStore';
import { getEmbeddingClient } from '@domains/google';
import {
  createWorkerSearchEngineFactory,
  chunkSection,
  sectionHasEmbeddableText,
  QueryEmbeddingCache,
  segmentSentences,
  type Sentence,
  type SearchEngineHandle,
} from '@domains/search';
import { queryEmbeddingsRepo } from '@data/repos/queryEmbeddings';
import { embeddingsRepo } from '@data/repos/embeddings';
import { searchTextRepo } from '@data/repos/searchText';
import { getExcerpt, SearchEngine } from '@lib/search-engine';
import type { DetailedSearchResult } from '~types/search';
import type { EmbeddedRowView } from '@domains/search/embeddingPort';
import type { CacheSearchTextRow, CacheEmbedJobsRow } from '@data/rows/cache';

export type SearchStatus = 'idle' | 'searching' | 'success' | 'error';
export type SearchErrorType = 'offline' | 'quota' | 'unconfigured' | 'general';

export interface GroupedBookMatches {
  bookId: string;
  bookTitle: string;
  author: string;
  coverPalette?: number[];
  coverUrl?: string;
  coverBlob?: Blob | null;
  matches: DetailedSearchResult[];
  lastRead?: number;
}

export interface BookIndexingStatus {
  bookId: string;
  title: string;
  author: string;
  coverPalette?: number[];
  coverUrl?: string;
  coverBlob?: Blob | null;
  status: 'indexed' | 'partial' | 'unindexed';
  progressLabel?: string;
  progressPercent?: number;
}

// Module-level query cache and quantizer instances
const queryCache = new QueryEmbeddingCache();
const quantizer = new SearchEngine();

/**
 * Chunk rows kept per section by the cosine ranking before the global cut.
 * (The GLOBAL page is capped at {@link TOP_K}; this only bounds what each
 * section may contribute to that ranking.)
 */
const PER_SECTION_ROWS = 20;

/**
 * How many hits the whole-library query MATERIALIZES. Ranking yields up to
 * PER_SECTION_ROWS per section per book (~20 × sections × books — tens of
 * thousands for a real library), and every materialized hit cost a
 * `getExcerpt` + an `Intl.Segmenter` pass on the main thread and a card +
 * IntersectionObserver in the view. Ranking is now separated from
 * materialization: tuples are ranked and CUT first, and only the survivors are
 * turned into results.
 */
const TOP_K = 100;

/** Books whose rows are read+ranked at once (bounds resident corpora/vectors). */
const BOOK_CONCURRENCY = 4;

/** The slice of the embedding client the whole-library query consumes. */
interface QueryEmbeddingClientPort {
  embed(
    texts: string[],
    opts: { profile: 'document' | 'query'; bookId?: string; interactive?: boolean },
  ): Promise<{ vectors: Float32Array[] }>;
}

/**
 * The ports the hook reads through. Production defaults are the repo
 * singletons + the worker engine factory; tests inject doubles (there is no
 * `vi.mock` of the data layer here — the seam is the argument).
 */
interface GlobalSearchDeps {
  embeddingsRepo: {
    get(bookId: string): Promise<EmbeddedRowView | undefined>;
    getJob(bookId: string): Promise<CacheEmbedJobsRow | undefined>;
  };
  searchTextRepo: { get(bookId: string): Promise<CacheSearchTextRow | undefined> };
  queryEmbeddingsRepo: { get(key: string): Promise<unknown> };
  getEmbeddingClient: () => QueryEmbeddingClientPort;
  /**
   * The cross-mount query-vector memo (it also owns the persistent
   * `cache_query_embeddings` round trip). Injected so a test can run the query
   * path without the side database.
   */
  queryCache: Pick<QueryEmbeddingCache, 'keyOf' | 'getOrCompute'>;
  /** Builds THE search-engine handle for this hook instance (one per mount). */
  createSearchEngine: () => SearchEngineHandle;
  getExcerpt: (text: string, charOffset: number, matchLength: number) => string;
  segmentSentences: (text: string, lang: string) => Sentence[];
}

const DEFAULT_DEPS: GlobalSearchDeps = {
  embeddingsRepo,
  searchTextRepo,
  queryEmbeddingsRepo,
  getEmbeddingClient,
  queryCache,
  createSearchEngine: () => createWorkerSearchEngineFactory()(),
  getExcerpt,
  segmentSentences,
};

/**
 * A ranked-but-not-yet-materialized hit: everything the global sort needs, and
 * nothing that would pin a book's corpus in memory. `charStart`/`charEnd` are
 * resolved during ranking (from the persisted chunk offsets, or by re-chunking
 * the section) so materialization needs only the section's text.
 */
interface RankedHit {
  bookId: string;
  href: string;
  sectionTitle: string;
  charStart: number;
  charEnd: number;
  row: number;
  cosine: number;
}

/** Run `worker` over `items` with at most `limit` in flight, preserving index. */
async function forEachWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

/** The indexed/partial/unindexed badge for an embedded/total pair. */
function badgeFor(
  embedded: number,
  total: number,
): Pick<BookIndexingStatus, 'status' | 'progressLabel' | 'progressPercent'> {
  if (embedded === 0) return { status: 'unindexed' };
  if (embedded >= total) return { status: 'indexed' };
  return {
    status: 'partial',
    progressLabel: `${embedded}/${total} chapters`,
    progressPercent: Math.round((embedded / total) * 100),
  };
}

export function useGlobalSearch(deps: Partial<GlobalSearchDeps> = {}) {
  const books = useAllBooks();
  const recentQueries = useSearchHistoryStore((state) => state.recentQueries);
  const savedQueries = useSearchHistoryStore((state) => state.savedQueries);
  const toggleSaved = useSearchHistoryStore((state) => state.toggleSaved);
  const deleteQuery = useSearchHistoryStore((state) => state.deleteQuery);
  const clearHistory = useSearchHistoryStore((state) => state.clearHistory);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GroupedBookMatches[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [errorType, setErrorType] = useState<SearchErrorType | undefined>(undefined);
  /**
   * True when the {@link TOP_K} cut actually dropped ranked hits, so the view
   * can say so instead of presenting a cut page as the whole answer (the
   * reader's SearchPanel carries the same "Showing the first N matches" line
   * for its own truncation).
   */
  const [truncated, setTruncated] = useState(false);
  const [indexingStatuses, setIndexingStatuses] = useState<BookIndexingStatus[]>([]);

  const activeHandleRef = useRef<SearchEngineHandle | null>(null);
  const requestedCardsRef = useRef<Set<string>>(new Set());
  /**
   * The library, read through a REF inside the callbacks. `useAllBooks()`
   * returns a new array on every library-projection recompute (a progress
   * write, a sync tick, an import), so keeping `books` in the callback's
   * dependency list re-created `executeSearch` constantly — and the view
   * re-runs the whole-library query whenever that identity changes.
   */
  const booksRef = useRef<LibraryBook[]>(books);
  const depsRef = useRef<GlobalSearchDeps>({ ...DEFAULT_DEPS, ...deps });
  /** Monotonic run id: a superseded run abandons its results (SearchPanel's guard). */
  const runTokenRef = useRef(0);
  /** The query currently displayed, so a library CHANGE can re-run it. */
  const lastQueryRef = useRef('');

  useEffect(() => {
    depsRef.current = { ...DEFAULT_DEPS, ...deps };
  });

  useEffect(() => {
    booksRef.current = books;
  }, [books]);

  useEffect(() => {
    return () => {
      if (activeHandleRef.current) {
        activeHandleRef.current.dispose();
        activeHandleRef.current = null;
      }
    };
  }, []);

  /**
   * ONE engine handle per hook instance. Disposing + re-creating the worker per
   * query re-instantiated the engine's multi-megabyte wasm every single search;
   * supersession is handled by the run token, not by killing the worker.
   */
  const ensureHandle = useCallback((): SearchEngineHandle => {
    activeHandleRef.current ??= depsRef.current.createSearchEngine();
    return activeHandleRef.current;
  }, []);

  // Load books indexing status
  useEffect(() => {
    let active = true;
    async function loadStatuses() {
      const { embeddingsRepo: embeddings, searchTextRepo: searchText } = depsRef.current;
      const list: BookIndexingStatus[] = [];
      const sortedBooks = [...books].sort((a, b) => (b.lastRead || 0) - (a.lastRead || 0));
      for (const book of sortedBooks) {
        if (!active) return;

        const itemBase = {
          bookId: book.id,
          title: book.title,
          author: book.author || '',
          coverPalette: book.coverPalette,
          coverUrl: book.coverUrl,
          coverBlob: book.coverBlob,
        };

        // The resume journal alone answers the badge: it lists the embedded
        // sections and (since the indexer stamps it) how many sections CAN be
        // embedded. Reading the whole search text AND the whole packed vector
        // row of every book in the library just to render a badge is what this
        // avoids.
        const job = await embeddings.getJob(book.id);
        if (!active) return;
        if (job && typeof job.embeddableSections === 'number') {
          list.push({ ...itemBase, ...badgeFor(job.sections.length, job.embeddableSections) });
          continue;
        }

        // Fallback for books whose journal predates the stamp (or is absent):
        // the original full-row path, unchanged.
        const text = await searchText.get(book.id);
        if (!active) return;
        const embed = await embeddings.get(book.id);
        if (!active) return;

        if (!text) {
          list.push({ ...itemBase, status: 'unindexed' });
        } else if (!embed || embed.sections.length === 0) {
          list.push({ ...itemBase, status: 'unindexed' });
        } else {
          // Only text-bearing sections can be embedded: a text-less spine item
          // (image-only cover page, blank section-break page) yields zero
          // chunks and never lands in the embeddings row, so counting it in the
          // total would strand the book at N-1/N — perpetually one section shy.
          const total = text.sections.filter((s) => sectionHasEmbeddableText(s.text)).length;
          list.push({ ...itemBase, ...badgeFor(embed.sections.length, total) });
        }
      }
      if (active) {
        setIndexingStatuses(list);
      }
    }
    loadStatuses();
    return () => {
      active = false;
    };
  }, [books]);

  const executeSearch = useCallback(async (queryText: string) => {
    const trimmed = queryText.trim();
    // Take the run token FIRST: every older run is superseded from here on and
    // must abandon its results instead of racing this one into setState.
    const runToken = ++runTokenRef.current;
    const isCurrent = () => runTokenRef.current === runToken;
    // Nothing has been cut yet; the slice below re-raises this when it cuts.
    setTruncated(false);

    if (!trimmed) {
      lastQueryRef.current = '';
      setQuery('');
      setResults([]);
      setStatus('idle');
      setErrorType(undefined);
      return;
    }

    lastQueryRef.current = trimmed;
    setQuery(trimmed);
    setStatus('searching');
    setErrorType(undefined);

    const config = useGenAIStore.getState();
    const isUnconfigured = !config.isEnabled || !config.apiKey;

    if (isUnconfigured) {
      setStatus('error');
      setErrorType('unconfigured');
      return;
    }

    const embeddingModel = config.embeddingModel;
    const embeddingDims = config.embeddingDims;
    const ports = depsRef.current;

    // 1. Try to read from local DB cache directly first if offline:
    const queryNorm = trimmed.toLowerCase();
    const globalDbKey = `${embeddingModel}|${embeddingDims}|${queryNorm}`;
    const cachedRow = await ports.queryEmbeddingsRepo.get(globalDbKey);
    if (!isCurrent()) return;
    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

    if (!cachedRow && isOffline) {
      setStatus('error');
      setErrorType('offline');
      return;
    }

    requestedCardsRef.current.clear();

    const handle = ensureHandle();
    const books = booksRef.current;

    try {
      // 2. The query vector, resolved AT MOST ONCE and only when a book turns
      //    out to be searchable — an unindexed library still spends no quota.
      let queryVectorPromise: Promise<{ vectors: Int8Array; scale: number } | null> | null = null;
      const resolveQueryVector = async () => {
        const client = ports.getEmbeddingClient();
        const key = ports.queryCache.keyOf({
          model: embeddingModel,
          dims: embeddingDims,
          profile: 'query',
          bookId: 'global',
          query: trimmed,
        });

        const queryFloat = await ports.queryCache.getOrCompute(
          key,
          async () => {
            const { vectors } = await client.embed([trimmed], {
              profile: 'query',
              bookId: 'global',
              interactive: true,
            });
            return vectors[0];
          },
          {
            query: trimmed,
            model: embeddingModel,
            dims: embeddingDims,
          }
        );

        if (!queryFloat || queryFloat.length === 0) return null;
        return quantizer.quantizeInt8PerVector(queryFloat);
      };
      const queryVector = () => (queryVectorPromise ??= resolveQueryVector());

      // 3. Rank every book, at most BOOK_CONCURRENCY at a time. Each book's
      //    corpus + packed vectors are released as soon as its hits are
      //    extracted — the whole library is never resident at once.
      const rankedByBook: RankedHit[][] = new Array(books.length);
      let candidates = 0;
      let queryVectorMissing = false;

      await forEachWithConcurrency(books, BOOK_CONCURRENCY, async (book, index) => {
        if (!isCurrent() || queryVectorMissing) return;

        const embedded = await ports.embeddingsRepo.get(book.bookId);
        if (!embedded || embedded.sections.length === 0) return;
        if (embedded.model !== embeddingModel || embedded.dims !== embeddingDims) return;

        const corpus = await ports.searchTextRepo.get(book.bookId);
        if (!corpus) return;
        if (embedded.extractionVersion !== corpus.extractionVersion) return;
        if (!isCurrent()) return;

        candidates += 1;

        const quantized = await queryVector();
        if (!quantized) {
          queryVectorMissing = true;
          return;
        }
        if (!isCurrent()) return;

        rankedByBook[index] = await rankBook({
          book,
          embedded,
          corpus,
          embeddingDims,
          engine: handle.engine,
          queryVec: quantized.vectors,
          queryScale: quantized.scale,
        });
      });

      if (!isCurrent()) return;

      if (candidates === 0 || queryVectorMissing) {
        setResults([]);
        setStatus('success');
        return;
      }

      // 4. Sort the LIGHTWEIGHT tuples strictly by similarity, then cut. The
      //    book-order/section-order/row-order of the ranking is preserved
      //    pre-sort, so ties resolve exactly as they did when every hit was
      //    materialized first.
      const rankedHits: RankedHit[] = [];
      for (const bookHits of rankedByBook) {
        if (bookHits) rankedHits.push(...bookHits);
      }
      rankedHits.sort((a, b) => b.cosine - a.cosine);
      // Ranking keeps up to PER_SECTION_ROWS per section per book and the
      // chunker overlaps ~15%, so ONE strongly-matching book routinely ranks
      // more than TOP_K near-duplicate tuples and fills the whole page. Report
      // the cut rather than letting the view present it as the whole answer.
      // (Deliberately NOT a per-book quota: which passages the user gets is a
      // ranking decision, not this perf change's to make, and near-duplicate
      // overlapping chunks are a dedup problem, not a fairness one.)
      const wasCut = rankedHits.length > TOP_K;
      const survivors = wasCut ? rankedHits.slice(0, TOP_K) : rankedHits;

      // 5. Materialize ONLY the survivors: one excerpt + one sentence
      //    segmentation each, reading each surviving book's text once.
      const flatHits = await materializeHits(survivors, ports);
      if (!isCurrent()) return;

      // 6. Group consecutive adjacent results from the same book
      const byId = new Map<string, LibraryBook>();
      for (const book of books) byId.set(book.id, book);

      const grouped: GroupedBookMatches[] = [];
      for (const hit of flatHits) {
        const book = byId.get(hit.bookId);
        if (!book) continue;

        const lastGroup = grouped[grouped.length - 1];
        if (lastGroup && lastGroup.bookId === hit.bookId) {
          lastGroup.matches.push(hit);
        } else {
          grouped.push({
            bookId: hit.bookId,
            bookTitle: book.title,
            author: book.author || '',
            coverPalette: book.coverPalette,
            coverUrl: book.coverUrl,
            coverBlob: book.coverBlob,
            matches: [hit],
            lastRead: book.lastRead,
          });
        }
      }

      setResults(grouped);
      // Published with the results a superseded run never reaches, so the
      // notice can never outlive the page it describes.
      setTruncated(wasCut);
      setStatus('success');

      // 7. Add query to synced search history
      useSearchHistoryStore.getState().addQuery(trimmed);

      // Sentence re-ranking: Ternlight on-device sentence selection on the top 5 overall candidates
      // Runs asynchronously to allow Gemini search results to render immediately.
      void (async () => {
        try {
          const topCandidates = flatHits.slice(0, 5);
          for (let i = 0; i < topCandidates.length; i++) {
            const hit = topCandidates[i];
            const key = `${hit.bookId}|${hit.href}|${hit.charOffset}`;
            requestedCardsRef.current.add(key);

            // Check whether this run is still the current one before sending
            // the next worker message.
            if (!isCurrent()) break;

            const sentences: Sentence[] = ports.segmentSentences(hit.excerpt, 'en');
            const chunkSentences = [sentences.map((s) => hit.excerpt.slice(s.start, s.end))];

            const bestSentences = await handle.engine.findBestSentences(trimmed, chunkSentences);
            const best = bestSentences[0];

            if (best && best.scores && best.scores.length > 0) {
              const validScores = best.scores.filter((s) => s >= 0);
              const minScore = validScores.length > 0 ? Math.min(...validScores) : 0;
              const maxScore = validScores.length > 0 ? Math.max(...validScores) : 0;
              const range = maxScore - minScore;

              const sentenceHighlights = sentences.map((span, sIdx) => {
                const rawScore = best.scores[sIdx] ?? 0;
                const score = range <= 0 ? 0.5 : (rawScore - minScore) / range;
                return {
                  start: span.start,
                  end: span.end,
                  score,
                };
              });

              if (isCurrent()) {
                setResults((prevGrouped) => {
                  return prevGrouped.map((group) => {
                    if (group.bookId !== hit.bookId) return group;

                    const updatedMatches = group.matches.map((match) => {
                      if (match.href === hit.href && match.charOffset === hit.charOffset) {
                        return {
                          ...match,
                          sentenceHighlights,
                        };
                      }
                      return match;
                    });
                    return { ...group, matches: updatedMatches };
                  });
                });
              }
            }
          }
        } catch (err) {
          console.error('Global search failed Ternlight re-ranking async:', err);
        }
      })();
    } catch (err: unknown) {
      if (!isCurrent()) return;
      // A failed run may mean a dead worker. Drop the handle so the NEXT query
      // builds a fresh engine (what the dispose-per-query code did implicitly),
      // while a healthy engine is still reused across successful queries.
      if (activeHandleRef.current === handle) {
        activeHandleRef.current = null;
        handle.dispose();
      }
      setStatus('error');
      const errStr = err instanceof Error ? err.message : String(err);
      if (errStr.includes('429') || errStr.toLowerCase().includes('quota') || errStr.includes('RateLimit')) {
        setErrorType('quota');
      } else {
        setErrorType('general');
      }
    }
  }, [ensureHandle]);

  /**
   * Re-run the active query when the library's MEMBERSHIP changes (a cold-open
   * projection hydrating, an import, a delete) — but NOT on the array-identity
   * churn of a progress write or a sync tick, which used to re-run the whole
   * query several times per second.
   */
  const bookIdsKey = books.map((b) => b.id).join('|');
  useEffect(() => {
    if (!lastQueryRef.current) return;
    void executeSearch(lastQueryRef.current);
  }, [bookIdsKey, executeSearch]);

  const triggerHighlightFor = useCallback(async (bookId: string, href: string, charOffset: number, excerpt: string) => {
    const key = `${bookId}|${href}|${charOffset}`;
    if (requestedCardsRef.current.has(key)) return;
    requestedCardsRef.current.add(key);

    const handle = activeHandleRef.current;
    if (!handle) return;

    try {
      const sentences: Sentence[] = depsRef.current.segmentSentences(excerpt, 'en');
      const chunkSentences = [sentences.map((s) => excerpt.slice(s.start, s.end))];

      const bestSentences = await handle.engine.findBestSentences(query, chunkSentences);
      const best = bestSentences[0];

      if (best && best.scores && best.scores.length > 0) {
        const validScores = best.scores.filter((s: number) => s >= 0);
        const minScore = validScores.length > 0 ? Math.min(...validScores) : 0;
        const maxScore = validScores.length > 0 ? Math.max(...validScores) : 0;
        const range = maxScore - minScore;

        const sentenceHighlights = sentences.map((span, sIdx) => {
          const rawScore = best.scores[sIdx] ?? 0;
          const score = range <= 0 ? 0.5 : (rawScore - minScore) / range;
          return {
            start: span.start,
            end: span.end,
            score,
          };
        });

        setResults((prevGrouped) => {
          return prevGrouped.map((group) => {
            if (group.bookId !== bookId) return group;

            const updatedMatches = group.matches.map((match) => {
              if (match.href === href && match.charOffset === charOffset) {
                return {
                  ...match,
                  sentenceHighlights,
                };
              }
              return match;
            });
            return { ...group, matches: updatedMatches };
          });
        });
      }
    } catch (err) {
      console.error('Failed to trigger highlights dynamically:', err);
    }
  }, [query]);

  return {
    query,
    setQuery,
    results,
    status,
    setStatus,
    errorType,
    truncated,
    indexingStatuses,
    recentQueries,
    savedQueries,
    toggleSaved,
    deleteQuery,
    clearHistory,
    executeSearch,
    triggerHighlightFor,
  };
}

/**
 * Cosine-rank one book's sections and return the LIGHTWEIGHT hit tuples. The
 * caller drops `embedded`/`corpus` the moment this resolves, so nothing here
 * may close over them.
 */
async function rankBook(args: {
  book: LibraryBook;
  embedded: EmbeddedRowView;
  corpus: CacheSearchTextRow;
  embeddingDims: number;
  engine: SearchEngineHandle['engine'];
  queryVec: Int8Array;
  queryScale: number;
}): Promise<RankedHit[]> {
  const { book, embedded, corpus, embeddingDims, engine, queryVec, queryScale } = args;

  const textByHref = new Map<string, { title: string; text: string }>(
    corpus.sections.map((s) => [s.href, { title: s.title, text: s.text }])
  );
  const resolved: {
    section: EmbeddedRowView['sections'][number];
    title: string;
    offsetsFor: (row: number) => { charStart: number; charEnd: number } | undefined;
  }[] = [];

  for (const section of embedded.sections) {
    const source = textByHref.get(section.href);
    if (!source) continue;
    const rowCount = Math.floor(section.vectors.length / embeddingDims);
    const persistedChunks = section.chunks;
    const hasPersistedOffsets =
      persistedChunks.length === rowCount &&
      persistedChunks.every(
        (c) => typeof c.charStart === 'number' && typeof c.charEnd === 'number'
      );

    if (hasPersistedOffsets) {
      resolved.push({
        section,
        title: source.title,
        offsetsFor: (row: number) => {
          const c = persistedChunks[row];
          return c ? { charStart: c.charStart!, charEnd: c.charEnd! } : undefined;
        },
      });
    } else {
      const { chunks } = chunkSection({ href: section.href, title: source.title, text: source.text });
      if (chunks.length !== rowCount) continue;
      resolved.push({
        section,
        title: source.title,
        offsetsFor: (row: number) => {
          const c = chunks[row];
          return c ? { charStart: c.charStart, charEnd: c.charEnd } : undefined;
        },
      });
    }
  }

  const tops = await Promise.all(
    resolved.map((r) =>
      engine.rankInt8(r.section.vectors, r.section.scales, queryVec, queryScale, embeddingDims, PER_SECTION_ROWS)
    )
  );

  const hits: RankedHit[] = [];
  for (let s = 0; s < resolved.length; s++) {
    const { section, title, offsetsFor } = resolved[s];
    for (const { row, cosine } of tops[s]) {
      const offsets = offsetsFor(row);
      if (!offsets) continue;
      hits.push({
        bookId: book.bookId,
        href: section.href,
        sectionTitle: title,
        charStart: offsets.charStart,
        charEnd: offsets.charEnd,
        row,
        cosine,
      });
    }
  }
  return hits;
}

/**
 * Turn the surviving tuples into results, in the SAME order. Each surviving
 * book's text is read once (the ranking pass released it), and the excerpt +
 * sentence segmentation run only here — TOP_K times at most, instead of once
 * per ranked row.
 */
async function materializeHits(
  survivors: readonly RankedHit[],
  ports: GlobalSearchDeps,
): Promise<(DetailedSearchResult & { bookId: string })[]> {
  const byBook = new Map<string, number[]>();
  survivors.forEach((hit, index) => {
    const list = byBook.get(hit.bookId);
    if (list) list.push(index);
    else byBook.set(hit.bookId, [index]);
  });

  const out: (DetailedSearchResult & { bookId: string })[] = new Array(survivors.length);
  const bookIds = [...byBook.keys()];

  await forEachWithConcurrency(bookIds, BOOK_CONCURRENCY, async (bookId) => {
    const indices = byBook.get(bookId) ?? [];
    const corpus = await ports.searchTextRepo.get(bookId);
    if (!corpus) return;
    const needed = new Set(indices.map((i) => survivors[i].href));
    const textByHref = new Map<string, string>();
    for (const s of corpus.sections) {
      if (needed.has(s.href)) textByHref.set(s.href, s.text);
    }

    for (const index of indices) {
      const hit = survivors[index];
      const text = textByHref.get(hit.href);
      if (text === undefined) continue;
      const charOffset = hit.charStart;
      const matchLength = hit.charEnd - hit.charStart;
      const start = Math.max(0, charOffset - 40);
      const matchStartInExcerpt = (start > 0 ? 3 : 0) + (charOffset - start);
      const excerpt = ports.getExcerpt(text, charOffset, matchLength);
      const sentences: Sentence[] = ports.segmentSentences(excerpt, 'en');
      out[index] = {
        bookId: hit.bookId,
        href: hit.href,
        sectionTitle: hit.sectionTitle,
        excerpt,
        charOffset,
        matchLength,
        matchStartInExcerpt,
        matchLengthInExcerpt: matchLength,
        occurrence: hit.row + 1,
        similarity: hit.cosine,
        sentenceHighlights: sentences.map((span) => ({
          start: span.start,
          end: span.end,
          score: 0,
        })),
      };
    }
  });

  return out.filter(Boolean);
}

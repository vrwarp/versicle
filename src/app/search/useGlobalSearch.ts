import { useState, useEffect, useCallback, useRef } from 'react';
import { useAllBooks } from '@store/libraryViewStore';
import { useSearchHistoryStore } from '@store/useSearchHistoryStore';
import { useGenAIStore } from '@store/useGenAIStore';
import { getEmbeddingClient } from '@domains/google';
import {
  createWorkerSearchEngineFactory,
  chunkSection,
  QueryEmbeddingCache,
  segmentSentences,
  type Sentence,
} from '@domains/search';
import { queryEmbeddingsRepo } from '@data/repos/queryEmbeddings';
import { embeddingsRepo } from '@data/repos/embeddings';
import { searchTextRepo } from '@data/repos/searchText';
import { getExcerpt, SearchEngine } from '@lib/search-engine';
import type { DetailedSearchResult } from '~types/search';
import type { UserInventoryItem } from '~types/user-data';
import type { EmbeddedRowView } from '@domains/search/embeddingPort';
import type { CacheSearchTextRow } from '@data/rows/cache';

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

export function useGlobalSearch() {
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
  const [indexingStatuses, setIndexingStatuses] = useState<BookIndexingStatus[]>([]);

  const activeHandleRef = useRef<any>(null);
  const requestedCardsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    return () => {
      if (activeHandleRef.current) {
        activeHandleRef.current.dispose();
      }
    };
  }, []);

  // Load books indexing status
  useEffect(() => {
    let active = true;
    async function loadStatuses() {
      const list: BookIndexingStatus[] = [];
      const sortedBooks = [...books].sort((a, b) => (b.lastRead || 0) - (a.lastRead || 0));
      for (const book of sortedBooks) {
        const text = await searchTextRepo.get(book.id);
        const embed = await embeddingsRepo.get(book.id);

        const itemBase = {
          bookId: book.id,
          title: book.title,
          author: book.author || '',
          coverPalette: book.coverPalette,
          coverUrl: book.coverUrl,
          coverBlob: book.coverBlob,
        };

        if (!text) {
          list.push({
            ...itemBase,
            status: 'unindexed',
          });
        } else if (!embed || embed.sections.length === 0) {
          list.push({
            ...itemBase,
            status: 'unindexed',
          });
        } else {
          const total = text.sections.length;
          const embedded = embed.sections.length;
          if (embedded >= total) {
            list.push({
              ...itemBase,
              status: 'indexed',
            });
          } else {
            list.push({
              ...itemBase,
              status: 'partial',
              progressLabel: `${embedded}/${total} chapters`,
              progressPercent: Math.round((embedded / total) * 100),
            });
          }
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
    if (!trimmed) {
      setQuery('');
      setResults([]);
      setStatus('idle');
      setErrorType(undefined);
      return;
    }

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

    // 1. Try to read from local DB cache directly first if offline:
    const queryNorm = trimmed.toLowerCase();
    const globalDbKey = `${embeddingModel}|${embeddingDims}|${queryNorm}`;
    const cachedRow = await queryEmbeddingsRepo.get(globalDbKey);
    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

    if (!cachedRow && isOffline) {
      setStatus('error');
      setErrorType('offline');
      return;
    }

    requestedCardsRef.current.clear();

    if (activeHandleRef.current) {
      activeHandleRef.current.dispose();
    }

    const factory = createWorkerSearchEngineFactory();
    const handle = factory();
    activeHandleRef.current = handle;
    let isAsyncStarted = false;

    try {
      // 2. Fetch or load candidate books
      const searchPromises = books.map(async (book) => {
        const embedded = await embeddingsRepo.get(book.bookId);
        if (!embedded || embedded.sections.length === 0) return null;

        const corpus = await searchTextRepo.get(book.bookId);
        if (!corpus) return null;

        if (embedded.extractionVersion !== corpus.extractionVersion) return null;
        if (embedded.model !== embeddingModel || embedded.dims !== embeddingDims) return null;

        return { book, embedded, corpus };
      });

      const candidates = (await Promise.all(searchPromises)).filter(Boolean) as {
        book: UserInventoryItem;
        embedded: EmbeddedRowView;
        corpus: CacheSearchTextRow;
      }[];

      if (candidates.length === 0) {
        setResults([]);
        setStatus('success');
        return;
      }

      // 3. Resolve Query Embedding vector
      const client = getEmbeddingClient();
      const key = queryCache.keyOf({
        model: embeddingModel,
        dims: embeddingDims,
        profile: 'query',
        bookId: 'global',
        query: trimmed,
      });

      const queryFloat = await queryCache.getOrCompute(
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

      if (!queryFloat || queryFloat.length === 0) {
        setResults([]);
        setStatus('success');
        return;
      }

      // 4. Quantize query vector
      const { vectors: queryVec, scale: queryScale } = quantizer.quantizeInt8PerVector(queryFloat);

      const textMap = new Map<string, string>();

      const rankPromises = candidates.map(async ({ book, embedded, corpus }) => {
        for (const s of corpus.sections) {
          textMap.set(`${book.bookId}|${s.href}`, s.text);
        }
        const textByHref = new Map<string, { title: string; text: string }>(
          corpus.sections.map((s) => [s.href, { title: s.title, text: s.text }])
        );
        const resolved: {
          section: EmbeddedRowView['sections'][number];
          source: { title: string; text: string };
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
              source,
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
              source,
              offsetsFor: (row: number) => {
                const c = chunks[row];
                return c ? { charStart: c.charStart, charEnd: c.charEnd } : undefined;
              },
            });
          }
        }

        const tops = await Promise.all(
          resolved.map((r) =>
            handle.engine.rankInt8(r.section.vectors, r.section.scales, queryVec, queryScale, embeddingDims, 20)
          )
        );

        const bookResults: DetailedSearchResult[] = [];
        for (let s = 0; s < resolved.length; s++) {
          const { section, source, offsetsFor } = resolved[s];
          for (const { row, cosine } of tops[s]) {
            const offsets = offsetsFor(row);
            if (!offsets) continue;
            const charOffset = offsets.charStart;
            const matchLength = offsets.charEnd - offsets.charStart;
            const start = Math.max(0, charOffset - 40);
            const matchStartInExcerpt = (start > 0 ? 3 : 0) + (charOffset - start);
            const excerpt = getExcerpt(source.text, charOffset, matchLength);
            const sentences: Sentence[] = segmentSentences(excerpt, 'en');
            bookResults.push({
              href: section.href,
              sectionTitle: source.title,
              excerpt,
              charOffset,
              matchLength,
              matchStartInExcerpt,
              matchLengthInExcerpt: matchLength,
              occurrence: row + 1,
              similarity: cosine,
              sentenceHighlights: sentences.map((span) => ({
                start: span.start,
                end: span.end,
                score: 0,
              })),
            });
          }
        }
        return { book, results: bookResults };
      });

      const bookRankedResults = await Promise.all(rankPromises);

      // 6. Flatten and sort strictly by similarity score descending
      const flatHits: (DetailedSearchResult & { bookId: string })[] = [];
      for (const { book, results } of bookRankedResults) {
        for (const res of results) {
          flatHits.push({
            ...res,
            bookId: book.bookId,
          });
        }
      }
      flatHits.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));

      // 7. Group consecutive adjacent results from the same book
      const grouped: GroupedBookMatches[] = [];
      for (const hit of flatHits) {
        const book = books.find((b) => b.id === hit.bookId);
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
      setStatus('success');

      // 8. Add query to synced search history
      useSearchHistoryStore.getState().addQuery(trimmed);

      // Sentence re-ranking: Ternlight on-device sentence selection on the top 5 overall candidates
      // Runs asynchronously to allow Gemini search results to render immediately.
      isAsyncStarted = true;
      (async () => {
        try {
          const topCandidates = flatHits.slice(0, 5);
          for (let i = 0; i < topCandidates.length; i++) {
            const hit = topCandidates[i];
            const key = `${hit.bookId}|${hit.href}|${hit.charOffset}`;
            requestedCardsRef.current.add(key);

            // Check if handle is still active before sending the next worker message
            if (activeHandleRef.current !== handle) break;

            const sentences: Sentence[] = segmentSentences(hit.excerpt, 'en');
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

              if (activeHandleRef.current === handle) {
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
      setStatus('error');
      const errStr = err instanceof Error ? err.message : String(err);
      if (errStr.includes('429') || errStr.toLowerCase().includes('quota') || errStr.includes('RateLimit')) {
        setErrorType('quota');
      } else {
        setErrorType('general');
      }
    } finally {
      if (!isAsyncStarted) {
        if (activeHandleRef.current === handle) {
          activeHandleRef.current = null;
        }
        handle.dispose();
      }
    }
  }, [books]);

  const triggerHighlightFor = useCallback(async (bookId: string, href: string, charOffset: number, excerpt: string) => {
    const key = `${bookId}|${href}|${charOffset}`;
    if (requestedCardsRef.current.has(key)) return;
    requestedCardsRef.current.add(key);

    const handle = activeHandleRef.current;
    if (!handle) return;

    try {
      const sentences: Sentence[] = segmentSentences(excerpt, 'en');
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

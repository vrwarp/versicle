import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useGlobalSearch, type BookIndexingStatus, type GroupedBookMatches } from '@app/search/useGlobalSearch';
import type { DetailedSearchResult } from '~types/search';
import { useSearchHistoryStore } from '@store/useSearchHistoryStore';
import { BookCover } from '../library/BookCover';
import {
  Search,
  X,
  Star,
  History,
  WifiOff,
  ShieldAlert,
  KeyRound,
  Play,
  BookOpen,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

// ── MEMOIZED SUBCOMPONENTS FOR RENDERING ISOLATION ─────────────────────────

interface SearchHistorySectionProps {
  onPillClick: (q: string) => void;
}

const SearchHistorySection = React.memo<SearchHistorySectionProps>(({ onPillClick }) => {
  const recentQueries = useSearchHistoryStore((state) => state.recentQueries);
  const savedQueries = useSearchHistoryStore((state) => state.savedQueries);
  const toggleSaved = useSearchHistoryStore((state) => state.toggleSaved);
  const deleteQuery = useSearchHistoryStore((state) => state.deleteQuery);
  const clearHistory = useSearchHistoryStore((state) => state.clearHistory);

  if (recentQueries.length === 0 && savedQueries.length === 0) return null;

  return (
    <div className="flex flex-col gap-4 max-w-4xl mx-auto w-full bg-card/40 backdrop-blur-md p-5 rounded-2xl border border-border/80 shadow-sm">
      <div className="flex justify-between items-center border-b pb-2">
        <span className="font-semibold text-foreground/80 flex items-center gap-2">
          <History className="w-4 h-4 text-primary" /> Search History
        </span>
        {recentQueries.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearHistory}
            className="text-xs text-muted-foreground hover:text-destructive h-8"
          >
            Clear History
          </Button>
        )}
      </div>

      {/* Saved/Starred queries */}
      {savedQueries.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider mr-2">Saved:</span>
          {savedQueries.map((item) => (
            <div
              key={item.query}
              className="group flex items-center bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 text-sm px-3 py-1.5 rounded-full border border-yellow-500/20 shadow-sm transition-all duration-150 cursor-pointer"
            >
              <button
                onClick={() => onPillClick(item.query)}
                className="flex items-center gap-1.5 focus:outline-none"
              >
                <Star className="w-3.5 h-3.5 fill-current" />
                <span>{item.query}</span>
              </button>
              <button
                onClick={() => toggleSaved(item.query)}
                className="ml-1.5 opacity-0 group-hover:opacity-100 p-0.5 rounded-full hover:bg-yellow-500/20 transition-all"
                title="Unstar search"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Recent queries */}
      {recentQueries.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider mr-2">Recent:</span>
          {recentQueries.map((item) => (
            <div
              key={item.query}
              className="group flex items-center bg-muted/60 hover:bg-muted/80 text-foreground/80 text-sm px-3 py-1.5 rounded-full border border-border shadow-sm transition-all duration-150 cursor-pointer"
            >
              <button
                onClick={() => onPillClick(item.query)}
                className="focus:outline-none"
              >
                <span>{item.query}</span>
              </button>
              <button
                onClick={() => deleteQuery(item.query)}
                className="ml-1.5 opacity-0 group-hover:opacity-100 p-0.5 rounded-full hover:bg-muted-foreground/15 transition-all text-muted-foreground"
                title="Delete from history"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
SearchHistorySection.displayName = 'SearchHistorySection';

interface IndexingStatusGridProps {
  indexingStatuses: BookIndexingStatus[];
}

const IndexingStatusGrid = React.memo<IndexingStatusGridProps>(({ indexingStatuses }) => {
  if (indexingStatuses.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground bg-muted/20 rounded-xl border border-dashed">
        Your library is empty. Import books to start semantic search.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-6">
      {indexingStatuses.map((book) => (
        <div
          key={book.bookId}
          className={`group flex flex-col bg-card rounded-xl overflow-hidden border transition-all duration-200 hover:shadow-md ${
            book.status === 'unindexed' ? 'opacity-70 dark:opacity-60 grayscale' : ''
          }`}
        >
          <div className="aspect-[2/3] w-full bg-muted relative overflow-hidden flex flex-col">
            <BookCover
              book={{
                id: book.bookId,
                title: book.title,
                author: book.author,
                coverPalette: book.coverPalette,
                coverUrl: book.coverUrl,
                coverBlob: book.coverBlob,
              }}
              onDelete={() => {}}
              onOffload={() => {}}
              onRestore={() => {}}
              showActions={false}
            />

            {/* Status Badges Overlay */}
            {book.status === 'unindexed' && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center p-2">
                <span className="text-xs font-semibold bg-secondary/90 text-secondary-foreground px-2 py-1 rounded-full shadow-sm">
                  Unindexed
                </span>
              </div>
            )}
            {book.status === 'partial' && (
              <div className="absolute inset-0 bg-black/30 flex flex-col justify-end p-2 gap-1.5">
                <div className="w-full bg-muted/80 rounded-full h-1.5 overflow-hidden shadow-inner">
                  <div
                    className="bg-primary h-full transition-all duration-300"
                    style={{ width: `${book.progressPercent ?? 0}%` }}
                  />
                </div>
                <span className="text-[10px] font-bold text-white text-center drop-shadow-md">
                  Indexing {book.progressLabel}
                </span>
              </div>
            )}
          </div>

          <div className="p-3 flex flex-col flex-1">
            <h4 className="font-semibold text-sm line-clamp-1 text-foreground" title={book.title}>
              {book.title}
            </h4>
            <p className="text-xs text-muted-foreground line-clamp-1" title={book.author}>
              {book.author}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
});
IndexingStatusGrid.displayName = 'IndexingStatusGrid';

interface SearchResultsListProps {
  query: string;
  results: GroupedBookMatches[];
  onResultClick: (bookId: string, href: string, charOffset: number, matchLength: number) => void;
  triggerHighlightFor: (bookId: string, href: string, charOffset: number, excerpt: string) => void;
}

const calculateSigmoidMatch = (similarity: number): number => {
  const k = 15;
  const x0 = 0.50;
  return Math.round(100 / (1 + Math.exp(-k * (similarity - x0))));
};

interface SearchMatchCardProps {
  bookId: string;
  match: DetailedSearchResult;
  onResultClick: (bookId: string, href: string, charOffset: number, matchLength: number) => void;
  triggerHighlightFor: (bookId: string, href: string, charOffset: number, excerpt: string) => void;
}

const SearchMatchCard = React.memo<SearchMatchCardProps>(({
  bookId,
  match,
  onResultClick,
  triggerHighlightFor,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Intersection observer to load highlights when card is near viewport (100px threshold)
    const hasCalculated = match.sentenceHighlights && match.sentenceHighlights.some((hl: { score: number }) => hl.score > 0);
    if (hasCalculated) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        triggerHighlightFor(bookId, match.href, match.charOffset, match.excerpt);
        observer.disconnect();
      }
    }, { rootMargin: '100px' });

    if (cardRef.current) {
      observer.observe(cardRef.current);
    }

    return () => observer.disconnect();
  }, [bookId, match.href, match.charOffset, match.excerpt, triggerHighlightFor, match.sentenceHighlights]);

  const renderExcerptWithHighlights = (excerptStr: string, highlights: { start: number; end: number; score: number }[]) => {
    const elements: React.ReactNode[] = [];
    let lastIndex = 0;
    const sorted = [...highlights].sort((a, b) => a.start - b.start);
    sorted.forEach((hl, sIdx) => {
      if (hl.start > lastIndex) {
        elements.push(excerptStr.substring(lastIndex, hl.start));
      }
      const sentenceText = excerptStr.substring(hl.start, hl.end);
      elements.push(
        <span
          key={`hl-${sIdx}`}
          className="px-0.5 rounded not-italic transition-all duration-300"
          style={{
            backgroundColor: `color-mix(in srgb, var(--primary) ${Math.round(hl.score * 25)}%, transparent)`,
          }}
        >
          {sentenceText}
        </span>
      );
      lastIndex = hl.end;
    });
    if (lastIndex < excerptStr.length) {
      elements.push(excerptStr.substring(lastIndex));
    }
    return elements;
  };

  return (
    <div
      ref={cardRef}
      onClick={() => onResultClick(bookId, match.href, match.charOffset, match.matchLength)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onResultClick(bookId, match.href, match.charOffset, match.matchLength);
        }
      }}
      role="button"
      tabIndex={0}
      className="p-5 hover:bg-muted/30 cursor-pointer transition-colors duration-150 group/item flex flex-col gap-2 relative focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl animate-in fade-in duration-300"
    >
      <div className="flex justify-between items-center gap-4 text-xs font-semibold">
        <span className="text-primary truncate max-w-xs">{match.sectionTitle || 'Chapter'}</span>
        <span className="bg-primary/10 text-primary px-2.5 py-0.5 rounded-full shrink-0 flex items-center gap-1 font-bold">
          {match.similarity ? `${calculateSigmoidMatch(match.similarity)}%` : '—'} Match
        </span>
      </div>
      <p className="text-foreground/90 text-sm leading-relaxed italic border-l-2 border-primary/20 pl-3">
        {match.sentenceHighlights && match.sentenceHighlights.length > 0 ? (
          renderExcerptWithHighlights(match.excerpt, match.sentenceHighlights)
        ) : (
          match.excerpt
        )}
      </p>
      <div className="absolute right-4 bottom-4 opacity-0 group-hover/item:opacity-100 text-primary transition-opacity flex items-center gap-1 text-xs font-bold">
        Read Passage <Play className="w-3.5 h-3.5 fill-current" />
      </div>
    </div>
  );
});
SearchMatchCard.displayName = 'SearchMatchCard';

const SearchResultsList = React.memo<SearchResultsListProps>(({ query, results, onResultClick, triggerHighlightFor }) => {
  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-300">
      <div className="flex justify-between items-center border-b pb-2">
        <h3 className="font-semibold text-lg text-foreground/80">
          Search results for "{query}"
        </h3>
        <span className="text-sm text-muted-foreground font-medium">
          Found {results.reduce((acc, curr) => acc + curr.matches.length, 0)} match(es) across {results.length} book(s)
        </span>
      </div>

      {results.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground bg-muted/10 rounded-2xl border border-dashed max-w-xl mx-auto w-full">
          No matching passages found. Try another query.
        </div>
      ) : (
        <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full">
          {results.map((group, groupIdx) => (
            <div
              key={`${group.bookId}-${groupIdx}`}
              className="bg-card rounded-2xl border border-border/80 overflow-hidden shadow-sm flex flex-col md:flex-row"
            >
              {/* Left Side: Book Cover Sidebar */}
              <div className="w-full md:w-44 bg-muted/10 p-4 flex flex-row md:flex-col items-center gap-4 border-b md:border-b-0 md:border-r border-border shrink-0">
                <div className="w-16 md:w-28 aspect-[2/3] rounded-lg shadow-md overflow-hidden relative shrink-0">
                  <BookCover
                    book={{
                      id: group.bookId,
                      title: group.bookTitle,
                      author: group.author,
                      coverPalette: group.coverPalette,
                      coverUrl: group.coverUrl,
                      coverBlob: group.coverBlob,
                    }}
                    onDelete={() => {}}
                    onOffload={() => {}}
                    onRestore={() => {}}
                    showActions={false}
                  />
                </div>
                <div className="flex flex-col md:text-center select-none overflow-hidden">
                  <h4 className="font-bold text-sm md:text-base text-foreground line-clamp-2 leading-snug">
                    {group.bookTitle}
                  </h4>
                  <p className="text-xs text-muted-foreground line-clamp-1 mt-1">
                    {group.author}
                  </p>
                </div>
              </div>

              {/* Right Side: Matches list */}
              <div className="flex-1 flex flex-col divide-y divide-border">
                {group.matches.map((match, idx) => (
                  <SearchMatchCard
                    key={`${match.href}-${match.charOffset}-${idx}`}
                    bookId={group.bookId}
                    match={match}
                    onResultClick={onResultClick}
                    triggerHighlightFor={triggerHighlightFor}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
SearchResultsList.displayName = 'SearchResultsList';

// ── MAIN VIEW COMPONENT ────────────────────────────────────────────────────

export const GlobalSemanticSearchView: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get('q') || '';
  const {
    query,
    results,
    status,
    errorType,
    indexingStatuses,
    savedQueries,
    toggleSaved,
    executeSearch,
    triggerHighlightFor,
  } = useGlobalSearch();

  const [prevUrlQuery, setPrevUrlQuery] = useState(urlQuery);
  const [inputVal, setInputVal] = useState(urlQuery || query);

  if (urlQuery !== prevUrlQuery) {
    setPrevUrlQuery(urlQuery);
    setInputVal(urlQuery);
  }

  // Sync urlQuery parameter to execute search
  useEffect(() => {
    executeSearch(urlQuery);
  }, [urlQuery, executeSearch]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputVal.trim();
    setSearchParams(trimmed ? { q: trimmed } : {});
  };

  const handlePillClick = useCallback((q: string) => {
    setSearchParams({ q: q.trim() });
  }, [setSearchParams]);

  const handleResultClick = useCallback((bookId: string, href: string, charOffset: number, matchLength: number) => {
    navigate(`/read/${bookId}?location=${encodeURIComponent(href)}&offset=${charOffset}&length=${matchLength}`);
  }, [navigate]);

  const isStarred = savedQueries.some((q) => q.query.toLowerCase() === inputVal.trim().toLowerCase());

  return (
    <div className="flex-1 flex flex-col gap-6" data-testid="global-semantic-search-view">
      <div className="w-full max-w-2xl mx-auto text-center">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Search across all books in your library semantically. Enter concepts, questions, or themes, and we'll find matching passages regardless of the exact words used.
        </p>
      </div>

      {/* Search Input Bar */}
      <form onSubmit={handleSubmit} className="flex gap-2 items-center w-full max-w-2xl mx-auto relative">
        <div className="relative flex-1">
          <Input
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            placeholder="Search across all books semantically..."
            className="pr-20 pl-10 py-6 h-12 text-lg rounded-xl shadow-sm border-border focus-visible:ring-primary focus-visible:ring-offset-0 focus-visible:ring-2 focus-visible:border-primary"
            data-testid="semantic-search-input"
            aria-label="Semantic search query"
          />
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
            {status !== 'idle' && inputVal && (
              <button
                type="button"
                onClick={() => {
                  setSearchParams({});
                }}
                className="p-1 hover:bg-muted rounded-full transition-colors"
                aria-label="Clear search input"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
            {status !== 'idle' && inputVal.trim() && (
              <button
                type="button"
                onClick={() => toggleSaved(inputVal)}
                className="p-1.5 hover:bg-muted rounded-full transition-colors"
                aria-label={isStarred ? "Unsave query" : "Save query"}
              >
                <Star
                  className={`w-4 h-4 transition-colors ${
                    isStarred ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground hover:text-yellow-400'
                  }`}
                />
              </button>
            )}
          </div>
        </div>
        <Button type="submit" size="default" className="h-12 px-6 rounded-xl font-medium shadow-md transition-all hover:scale-[1.02]">
          Search
        </Button>
      </form>

      {/* Main Content Pane */}
      {status === 'idle' && (
        <div className="flex flex-col gap-8 animate-in fade-in duration-300">
          <SearchHistorySection onPillClick={handlePillClick} />

          {/* Library Index Status Grid */}
          <div className="flex flex-col gap-4">
            <h3 className="font-semibold text-lg text-foreground/80 flex items-center gap-2 border-b pb-2">
              <BookOpen className="w-5 h-5 text-primary" /> Library Indexing Status
            </h3>
            <IndexingStatusGrid indexingStatuses={indexingStatuses} />
          </div>
        </div>
      )}

      {status === 'searching' && (
        <div className="flex flex-col justify-center items-center py-20 flex-1 gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent shadow-sm" />
          <p className="text-muted-foreground font-medium animate-pulse">Running semantic search across library...</p>
        </div>
      )}

      {status === 'error' && (
        <div className="flex flex-col justify-center items-center py-16 flex-1 text-center max-w-md mx-auto gap-4">
          {errorType === 'offline' && (
            <div className="flex flex-col items-center gap-3">
              <div className="p-3 bg-destructive/10 rounded-full text-destructive shadow-sm">
                <WifiOff className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-foreground">You are Offline</h3>
              <p className="text-muted-foreground text-sm">
                Generating query embeddings requires an active internet connection to contact the Gemini API. Please reconnect and try again.
              </p>
            </div>
          )}

          {errorType === 'quota' && (
            <div className="flex flex-col items-center gap-3">
              <div className="p-3 bg-amber-500/10 rounded-full text-amber-600 dark:text-amber-500 shadow-sm">
                <ShieldAlert className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-foreground">API Rate Limit Exceeded</h3>
              <p className="text-muted-foreground text-sm">
                You have hit the Gemini API rate limit or model quota. Please wait a minute before making another search request.
              </p>
            </div>
          )}

          {errorType === 'unconfigured' && (
            <div className="flex flex-col items-center gap-3">
              <div className="p-3 bg-primary/10 rounded-full text-primary shadow-sm">
                <KeyRound className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-foreground">API Key Required</h3>
              <p className="text-muted-foreground text-sm">
                Semantic search relies on the Google Gemini API. Please configure your API key in settings to enable this view.
              </p>
            </div>
          )}

          {errorType === 'general' && (
            <div className="flex flex-col items-center gap-3">
              <div className="p-3 bg-destructive/10 rounded-full text-destructive shadow-sm">
                <ShieldAlert className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-foreground">Search Failed</h3>
              <p className="text-muted-foreground text-sm">
                An unexpected error occurred during search. Please verify your Gemini connection configuration and try again.
              </p>
            </div>
          )}
        </div>
      )}

      {status === 'success' && (
        <SearchResultsList
          query={query}
          results={results}
          onResultClick={handleResultClick}
          triggerHighlightFor={triggerHighlightFor}
        />
      )}
    </div>
  );
};

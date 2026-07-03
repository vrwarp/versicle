import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGlobalSearch } from '@app/search/useGlobalSearch';
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

export const GlobalSemanticSearchView: React.FC = () => {
  const navigate = useNavigate();
  const {
    query,
    setQuery,
    results,
    status,
    errorType,
    indexingStatuses,
    recentQueries,
    savedQueries,
    toggleSaved,
    deleteQuery,
    clearHistory,
    executeSearch,
  } = useGlobalSearch();

  const [inputVal, setInputVal] = useState(query);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeSearch(inputVal);
  };

  const handlePillClick = (q: string) => {
    setInputVal(q);
    executeSearch(q);
  };

  const handleResultClick = (bookId: string, href: string, charOffset: number, matchLength: number) => {
    navigate(`/read/${bookId}?location=${encodeURIComponent(href)}&offset=${charOffset}&length=${matchLength}`);
  };

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
            {inputVal && (
              <button
                type="button"
                onClick={() => {
                  setInputVal('');
                  setQuery('');
                }}
                className="p-1 hover:bg-muted rounded-full transition-colors"
                aria-label="Clear search input"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
            {inputVal.trim() && (
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
          {/* History / Saved Queries Section */}
          {(recentQueries.length > 0 || savedQueries.length > 0) && (
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
                        onClick={() => handlePillClick(item.query)}
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
                        onClick={() => handlePillClick(item.query)}
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
          )}

          {/* Library Index Status Grid */}
          <div className="flex flex-col gap-4">
            <h3 className="font-semibold text-lg text-foreground/80 flex items-center gap-2 border-b pb-2">
              <BookOpen className="w-5 h-5 text-primary" /> Library Indexing Status
            </h3>
            
            {indexingStatuses.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground bg-muted/20 rounded-xl border border-dashed">
                Your library is empty. Import books to start semantic search.
              </div>
            ) : (
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
            )}
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
        <div className="max-w-md mx-auto w-full bg-card border rounded-2xl p-8 text-center shadow-lg animate-in zoom-in-95 duration-200">
          {errorType === 'offline' && (
            <div className="flex flex-col items-center gap-4">
              <div className="p-4 bg-red-500/10 rounded-full text-red-500">
                <WifiOff className="w-12 h-12" />
              </div>
              <h3 className="text-xl font-bold text-foreground">You are offline</h3>
              <p className="text-muted-foreground text-sm">
                Generating embeddings requires a network connection to the Gemini API. Please check your internet connection and try again.
              </p>
            </div>
          )}

          {errorType === 'quota' && (
            <div className="flex flex-col items-center gap-4">
              <div className="p-4 bg-orange-500/10 rounded-full text-orange-500">
                <ShieldAlert className="w-12 h-12" />
              </div>
              <h3 className="text-xl font-bold text-foreground">API Quota Exhausted</h3>
              <p className="text-muted-foreground text-sm">
                You have run out of Gemini Embedding API quota. Check your budget limit settings or wait until it resets.
              </p>
              <Button onClick={() => navigate('/settings/google')} className="mt-2 font-medium">
                Adjust Quota Settings
              </Button>
            </div>
          )}

          {errorType === 'unconfigured' && (
            <div className="flex flex-col items-center gap-4">
              <div className="p-4 bg-yellow-500/10 rounded-full text-yellow-500">
                <KeyRound className="w-12 h-12" />
              </div>
              <h3 className="text-xl font-bold text-foreground">Gemini API Key Missing</h3>
              <p className="text-muted-foreground text-sm">
                Semantic search relies on the Google Gemini API. Please configure your API key in settings to enable this view.
              </p>
              <Button onClick={() => navigate('/settings/google')} className="mt-2 font-medium">
                Enter API Key
              </Button>
            </div>
          )}

          {errorType === 'general' && (
            <div className="flex flex-col items-center gap-4">
              <div className="p-4 bg-red-500/10 rounded-full text-red-500">
                <ShieldAlert className="w-12 h-12" />
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
              {results.map((group) => (
                <div
                  key={group.bookId}
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
                      <div
                        key={idx}
                        onClick={() => handleResultClick(group.bookId, match.href, match.charOffset, match.matchLength)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleResultClick(group.bookId, match.href, match.charOffset, match.matchLength);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        className="p-5 hover:bg-muted/30 cursor-pointer transition-colors duration-150 group/item flex flex-col gap-2 relative focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl"
                      >
                        <div className="flex justify-between items-center gap-4 text-xs font-semibold">
                          <span className="text-primary truncate max-w-xs">{match.sectionTitle || 'Chapter'}</span>
                          <span className="bg-primary/10 text-primary px-2.5 py-0.5 rounded-full shrink-0 flex items-center gap-1 font-bold">
                            {match.similarity ? `${Math.round(match.similarity * 100)}%` : '—'} Match
                          </span>
                        </div>
                        <p className="text-foreground/90 text-sm leading-relaxed italic border-l-2 border-primary/20 pl-3">
                          {match.excerpt}
                        </p>
                        <div className="absolute right-4 bottom-4 opacity-0 group-hover/item:opacity-100 text-primary transition-opacity flex items-center gap-1 text-xs font-bold">
                          Read Passage <Play className="w-3.5 h-3.5 fill-current" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

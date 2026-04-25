import React, { useState, useEffect, useCallback } from 'react';
import type { Book } from 'epubjs';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';
import { Search, Loader2, X } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { searchClient, type SearchResult } from '../../../lib/search';
import { useToastStore } from '../../../store/useToastStore';
import { createLogger } from '../../../lib/logger';

const logger = createLogger('SearchPanel');

export interface SearchPanelProps {
    bookId: string | undefined;
    book: Book | null;
    onNavigate: (href: string, query: string) => void;
}

export const SearchPanel: React.FC<SearchPanelProps> = ({
    bookId,
    book,
    onNavigate
}) => {
    // Search State
    const [searchQuery, setSearchQuery] = useState('');
    const [activeSearchQuery, setActiveSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);

    // Indexing State
    const [isIndexing, setIsIndexing] = useState(false);
    const [indexingProgress, setIndexingProgress] = useState(0);

    const { showToast } = useToastStore();

    useEffect(() => {
        if (!bookId || !book) return;
        if (searchClient.isIndexed(bookId)) return;

        let mounted = true;

        const performIndexing = async () => {
            if (!mounted) return;
            setIsIndexing(true);
            try {
                await searchClient.indexBook(book, bookId, (progress) => {
                    if (mounted) {
                        setIndexingProgress(Math.round(progress * 100));
                    }
                });
            } catch (e) {
                logger.error("Indexing failed", e);
            } finally {
                if (mounted) {
                    setIsIndexing(false);
                }
            }
        };

        performIndexing();

        return () => {
            mounted = false;
        };
    }, [bookId, book]);

    const requestCounter = React.useRef(0);

    const handleSearch = useCallback(async () => {
        const capturedQuery = searchQuery.trim();
        if (!capturedQuery || !bookId) return;

        // Always increment to invalidate any currently pending request
        const currentReq = ++requestCounter.current;

        setIsSearching(true);
        // Clear previous results while searching to prevent stale data from showing
        // before the new search completes.
        setSearchResults([]);

        try {
            const results = await searchClient.search(capturedQuery, bookId);
            // Re-verify after async operation
            if (currentReq === requestCounter.current) {
                setActiveSearchQuery(capturedQuery);
                setSearchResults(results);
                setIsSearching(false);
            }
        } catch (e) {
            // Re-verify after async operation
            if (currentReq === requestCounter.current) {
                logger.error("Search failed", e);
                showToast("Search failed", "error");
                setIsSearching(false);
            }
        }
    }, [searchQuery, bookId, showToast]);

    return (
        <div data-testid="reader-search-sidebar" className="w-64 shrink-0 bg-surface border-r border-border overflow-y-auto z-50 absolute inset-y-0 left-0 md:static flex flex-col">
            <div className="p-4 border-b border-border">
                <div className="flex items-center justify-between mb-2">
                    <h2 className="text-lg font-bold text-foreground">Search</h2>
                </div>
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <Input
                            data-testid="search-input"
                            aria-label="Search query"
                            type="search"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    handleSearch();
                                }
                            }}
                            placeholder="Search in book..."
                            className={cn("bg-background", searchQuery && "pr-9")}
                        />
                        {searchQuery && (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground hover:text-foreground"
                                onClick={() => setSearchQuery('')}
                                aria-label="Clear search"
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                    <Button
                        size="icon"
                        variant="ghost"
                        onClick={handleSearch}
                        disabled={isSearching || !searchQuery}
                        aria-label="Search"
                        className="shrink-0"
                    >
                        {isSearching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" />}
                    </Button>
                </div>
                {isIndexing && (
                    <div className="mt-3 space-y-1">
                        <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Indexing book...</span>
                            <span>{indexingProgress}%</span>
                        </div>
                        <div
                            className="h-1.5 bg-secondary rounded-full overflow-hidden w-full"
                            role="progressbar"
                            aria-valuenow={indexingProgress}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label="Indexing progress"
                        >
                            <div
                                className="h-full bg-primary transition-all duration-300 ease-in-out"
                                style={{ width: `${indexingProgress}%` }}
                            />
                        </div>
                    </div>
                )}
            </div>
            <div className="flex-1 overflow-y-auto p-4" aria-live="polite">
                {isSearching ? (
                    <div className="text-center text-muted-foreground" role="status" aria-live="polite">Searching...</div>
                ) : (
                    <ul className="space-y-4">
                        {searchResults.map((result, idx) => (
                            <li key={idx} className="border-b border-border pb-2 last:border-0">
                                <Button
                                    variant="ghost"
                                    data-testid={`search-result-${idx}`}
                                    className="text-left w-full h-auto p-2 block items-start justify-start font-normal"
                                    onClick={() => onNavigate(result.href, activeSearchQuery)}
                                >
                                    <p className="text-xs text-muted-foreground mb-1">Result {idx + 1}</p>
                                    <p className="text-sm text-foreground line-clamp-3 whitespace-normal break-words">
                                        {result.excerpt}
                                    </p>
                                </Button>
                            </li>
                        ))}
                        {searchResults.length === 0 && activeSearchQuery && !isSearching && (
                            <div className="text-center text-muted-foreground text-sm" role="status" aria-live="polite">No results found</div>
                        )}
                    </ul>
                )}
            </div>
        </div>
    );
};

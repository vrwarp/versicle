/**
 * SearchPanel — the reader's in-book search sidebar, on the Phase 7 §F
 * SearchSession (the post-merge reader adoption; the `searchClient` module
 * singleton died with it).
 *
 * Indexing feeds from the PERSISTED corpus (cache_search_text): no epubjs
 * Book, no spine walking, no DOM parsing here. Books imported before the
 * corpus store existed come back 'no-text' — the panel then runs ONE
 * reprocess through the ImportOrchestrator queue (mutex-guarded; the §F
 * "lazily on first search" population) and retries. Results are
 * per-occurrence (`DetailedSearchResult`): clicking one hands the full
 * result to `onNavigate`, which lands on the EXACT match with a temporary
 * highlight (app/reader/searchNavigation).
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';
import { Search, Loader2, X } from 'lucide-react';
import { cn } from '@lib/utils';
import type { SearchSession } from '@domains/search';
import type { DetailedSearchResult, EmbeddingStatus } from '~types/search';
import { useImportController } from '@app/library/useImportController';
import { useToastStore } from '@store/useToastStore';
import { createLogger } from '@lib/logger';

const logger = createLogger('SearchPanel');

export interface SearchPanelProps {
    bookId: string | undefined;
    /** The reader-session search surface (owned by the reader controller). */
    session: SearchSession;
    /** Land the reader on the exact occurrence. */
    onNavigate: (result: DetailedSearchResult) => void;
}

export const SearchPanel: React.FC<SearchPanelProps> = ({
    bookId,
    session,
    onNavigate
}) => {
    // Search State
    const [searchQuery, setSearchQuery] = useState('');
    const [activeSearchQuery, setActiveSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<DetailedSearchResult[]>([]);
    const [truncated, setTruncated] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const [embedStatus, setEmbedStatus] = useState<EmbeddingStatus | null>(null);

    const embedStatusRef = useRef<EmbeddingStatus | null>(null);
    embedStatusRef.current = embedStatus;

    // Indexing State
    const [isIndexing, setIsIndexing] = useState(false);

    const { showToast } = useToastStore();
    const importController = useImportController();

    useEffect(() => {
        if (!bookId || session.isIndexed(bookId)) return;

        let mounted = true;
        setIsIndexing(true);

        const prepare = async () => {
            try {
                let outcome = await session.index(bookId);
                if (outcome === 'no-text') {
                    // Pre-corpus book (imported before the cache_search_text
                    // store existed): one reprocess through the orchestrator
                    // queue repopulates the persisted text, then indexing
                    // retries — the §F "lazily on first search" path.
                    await importController.reprocessBook(bookId);
                    outcome = await session.index(bookId);
                }
                if (outcome === 'no-text' && mounted) {
                    showToast('Search is unavailable for this book', 'error');
                }
            } catch (e) {
                logger.error('Indexing failed', e);
            } finally {
                if (mounted) {
                    setIsIndexing(false);
                }
            }
        };

        void prepare();

        return () => {
            mounted = false;
        };
    }, [bookId, session, importController, showToast]);

    useEffect(() => {
        if (!bookId || !session) return;

        let mounted = true;
        let timer: NodeJS.Timeout | undefined;

        const fetchStatus = async () => {
            try {
                const status = await session.getEmbeddingStatus(bookId);
                if (mounted) {
                    setEmbedStatus(status);
                    if (status && status.embeddedSections === status.totalSections) {
                        if (timer) {
                            clearInterval(timer);
                            timer = undefined;
                        }
                    }
                }
            } catch (e) {
                logger.error('Failed to fetch embedding status', e);
            }
        };

        void fetchStatus().then(() => {
            const currentStatus = embedStatusRef.current;
            if (
                mounted &&
                (!currentStatus || currentStatus.embeddedSections < currentStatus.totalSections)
            ) {
                timer = setInterval(() => {
                    void fetchStatus();
                }, 3000);
            }
        });

        return () => {
            mounted = false;
            if (timer) clearInterval(timer);
        };
    }, [bookId, session]);

    const requestCounter = useRef(0);

    const handleSearch = useCallback(async () => {
        const capturedQuery = searchQuery.trim();
        if (!capturedQuery || !bookId) return;

        // Always increment to invalidate any currently pending request
        const currentReq = ++requestCounter.current;

        setIsSearching(true);
        // Clear previous results while searching to prevent stale data from showing
        // before the new search completes.
        setSearchResults([]);
        setTruncated(false);

        try {
            const batch = await session.search(bookId, capturedQuery);
            // Re-verify after async operation
            if (currentReq === requestCounter.current) {
                setActiveSearchQuery(capturedQuery);
                setSearchResults(batch.results);
                setTruncated(batch.truncated);
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
    }, [searchQuery, bookId, session, showToast]);

    return (
        <div data-testid="reader-search-sidebar" className="w-64 shrink-0 bg-surface border-r border-border overflow-y-auto overflow-x-hidden z-50 absolute inset-y-0 left-0 flex flex-col">
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
                                title="Clear search"
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
                        </div>
                        {/* Indeterminate: corpus-fed indexing has no per-spine
                            progress stream (the old % bar tracked DOM parsing
                            the session no longer does). */}
                        <div
                            className="h-1.5 bg-secondary rounded-full overflow-hidden w-full"
                            role="progressbar"
                            aria-label="Indexing progress"
                        >
                            <div className="h-full bg-primary w-full animate-pulse" />
                        </div>
                    </div>
                )}
            </div>
            <div className="flex-1 overflow-y-auto p-4" aria-live="polite">
                {isSearching ? (
                    <div className="text-center text-muted-foreground" role="status" aria-live="polite">Searching...</div>
                ) : searchResults.length > 0 ? (
                    <ul className="space-y-4">
                        {searchResults.map((result, idx) => {
                            return (
                                <li key={`${result.href}-${result.charOffset}-${idx}`} className="border-b border-border pb-2 last:border-0">
                                    <Button
                                        variant="ghost"
                                        data-testid={`search-result-${idx}`}
                                        className="text-left w-full h-auto p-2 block items-start justify-start font-normal overflow-hidden"
                                        onClick={() => onNavigate(result)}
                                    >
                                        <p className="text-xs text-muted-foreground mb-1 truncate" title={result.sectionTitle ? `${result.sectionTitle} · Result ${idx + 1}` : `Result ${idx + 1}`}>
                                            {result.sectionTitle ? `${result.sectionTitle} · ` : ''}Result {idx + 1}
                                        </p>
                                        <p className="text-sm text-foreground line-clamp-3 whitespace-normal break-words">
                                            {result.matchStartInExcerpt !== undefined && result.matchLengthInExcerpt !== undefined ? (
                                                <>
                                                    {result.excerpt.substring(0, result.matchStartInExcerpt)}
                                                    <strong className="font-semibold text-foreground bg-primary/5 px-0.5 rounded">
                                                        {result.excerpt.substring(result.matchStartInExcerpt, result.matchStartInExcerpt + result.matchLengthInExcerpt)}
                                                    </strong>
                                                    {result.excerpt.substring(result.matchStartInExcerpt + result.matchLengthInExcerpt)}
                                                </>
                                            ) : (
                                                result.excerpt
                                            )}
                                        </p>
                                    </Button>
                                </li>
                            );
                        })}
                        {truncated && (
                            <li className="text-center text-muted-foreground text-xs" role="status">
                                Showing the first {searchResults.length} matches
                            </li>
                        )}
                    </ul>
                ) : activeSearchQuery ? (
                    <div className="text-center text-muted-foreground text-sm" role="status" aria-live="polite">No results found</div>
                ) : (
                    // Show embedding progress before any search starts (Scenario A or B)
                    embedStatus && (
                        <div className="p-3 rounded-lg border border-border bg-card/50 text-xs space-y-2">
                            {embedStatus.embeddedSections === embedStatus.totalSections ? (
                                <>
                                    <div className="font-semibold text-foreground flex items-center gap-1.5">
                                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                        Semantic Search Ready
                                    </div>
                                    <p className="text-muted-foreground">
                                        100% of book text indexed by meaning.
                                    </p>
                                </>
                            ) : (
                                <>
                                    <div className="font-semibold text-foreground flex items-center gap-1.5">
                                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                                        Indexing for Semantic Search...
                                    </div>
                                    <div className="space-y-1">
                                        <div className="flex justify-between text-[10px] text-muted-foreground">
                                            <span>{Math.round((embedStatus.embeddedSections / embedStatus.totalSections) * 100)}% ({embedStatus.embeddedSections}/{embedStatus.totalSections} sections)</span>
                                        </div>
                                        <div className="h-1.5 bg-secondary rounded-full overflow-hidden w-full">
                                            <div
                                                className="h-full bg-primary transition-all duration-500"
                                                style={{ width: `${(embedStatus.embeddedSections / embedStatus.totalSections) * 100}%` }}
                                            />
                                        </div>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground italic">
                                        Indexing fanning out from your page.
                                    </p>
                                </>
                            )}
                        </div>
                    )
                )}
            </div>
        </div>
    );
};

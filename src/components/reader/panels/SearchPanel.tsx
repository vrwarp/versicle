import React from 'react';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';
import { Search, Loader2 } from 'lucide-react';

export interface SearchResult {
    href: string;
    excerpt: string;
}

export interface SearchPanelProps {
    searchQuery: string;
    onSearchQueryChange: (query: string) => void;
    onSearch: () => void;
    isSearching: boolean;
    searchResults: SearchResult[];
    activeSearchQuery: string;
    isIndexing: boolean;
    indexingProgress: number;
    onResultClick: (result: SearchResult) => void;
}

export const SearchPanel: React.FC<SearchPanelProps> = ({
    searchQuery,
    onSearchQueryChange,
    onSearch,
    isSearching,
    searchResults,
    activeSearchQuery,
    isIndexing,
    indexingProgress,
    onResultClick
}) => {
    return (
        <div data-testid="reader-search-sidebar" className="w-64 shrink-0 bg-surface border-r border-border overflow-y-auto z-50 absolute inset-y-0 left-0 md:static flex flex-col">
            <div className="p-4 border-b border-border">
                <div className="flex items-center justify-between mb-2">
                    <h2 className="text-lg font-bold text-foreground">Search</h2>
                </div>
                <div className="flex gap-2">
                    <Input
                        data-testid="search-input"
                        aria-label="Search query"
                        type="search"
                        value={searchQuery}
                        onChange={(e) => onSearchQueryChange(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                onSearch();
                            }
                        }}
                        placeholder="Search in book..."
                        className="bg-background"
                    />
                    <Button
                        size="icon"
                        variant="ghost"
                        onClick={onSearch}
                        disabled={isSearching || !searchQuery}
                        aria-label="Search"
                        className="shrink-0"
                    >
                        {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
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
                                <button
                                    data-testid={`search-result-${idx}`}
                                    className="text-left w-full"
                                    onClick={() => onResultClick(result)}
                                >
                                    <p className="text-xs text-muted-foreground mb-1">Result {idx + 1}</p>
                                    <p className="text-sm text-foreground line-clamp-3">
                                        {result.excerpt}
                                    </p>
                                </button>
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

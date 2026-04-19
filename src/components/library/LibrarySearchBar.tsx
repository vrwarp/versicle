import React, { useState, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';
import { useDebounce } from '../../hooks/useDebounce';

interface LibrarySearchBarProps {
  onSearchChange: (debouncedQuery: string) => void;
  initialValue?: string;
  className?: string;
  placeholder?: string;
  debounceMs?: number;
}

export const LibrarySearchBar: React.FC<LibrarySearchBarProps> = ({
  onSearchChange,
  initialValue = '',
  className,
  placeholder = 'Search library...',
  debounceMs = 300,
}) => {
  const [searchQuery, setSearchQuery] = useState(initialValue);
  const debouncedSearchQuery = useDebounce(searchQuery, debounceMs);

  // Expose the debounced query to the parent so the parent ONLY re-renders
  // when the debounce delay has elapsed, rather than on every keystroke.
  useEffect(() => {
    onSearchChange(debouncedSearchQuery);
  }, [debouncedSearchQuery, onSearchChange]);

  // Handle external resets (e.g. clicking "Clear search" from the Empty state in the parent)
  useEffect(() => {
    // If parent forces a value change that differs from our debounced state, accept it.
    if (initialValue !== debouncedSearchQuery) {
        setSearchQuery(initialValue);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValue]);

  return (
    <div className={cn("relative", className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
        type="search"
        placeholder={placeholder}
        aria-label="Search library"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className={cn("pl-9", searchQuery && "pr-9")}
        data-testid="library-search-input"
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
  );
};

import { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { cn } from '@lib/utils';
import { useDebounce } from '@hooks/useDebounce';

interface LibrarySearchBarProps {
  onQueryChange: (debouncedQuery: string) => void;
  filteredCount: number;
  isFilteredEmpty: boolean;
  /** Placeholder + accessible name. Defaults to the library wording. */
  placeholder?: string;
  label?: string;
  /** Plural noun used in the screen-reader result count ("12 books found"). */
  itemNoun?: string;
  testId?: string;
}

export interface LibrarySearchBarRef {
  clearSearch: () => void;
}

export const LibrarySearchBar = forwardRef<LibrarySearchBarRef, LibrarySearchBarProps>(({
  onQueryChange,
  filteredCount,
  isFilteredEmpty,
  placeholder = 'Search library...',
  label = 'Search library',
  itemNoun = 'books',
  testId = 'library-search-input'
}, ref) => {
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  useEffect(() => {
    onQueryChange(debouncedSearchQuery);
  }, [debouncedSearchQuery, onQueryChange]);

  useImperativeHandle(ref, () => ({
    clearSearch: () => setSearchQuery('')
  }));

  return (
    <div className="relative w-full">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
        type="search"
        placeholder={placeholder}
        aria-label={label}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className={cn("pl-9", searchQuery && "pr-9")}
        data-testid={testId}
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
      {/* Live region for screen readers */}
      <div role="status" aria-live="polite" className="sr-only">
        {debouncedSearchQuery ? (
          isFilteredEmpty
            ? `No ${itemNoun} found`
            : `${filteredCount} ${itemNoun} found`
        ) : ''}
      </div>
    </div>
  );
});
LibrarySearchBar.displayName = 'LibrarySearchBar';

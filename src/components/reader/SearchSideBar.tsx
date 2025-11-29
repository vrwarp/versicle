import React, { useState } from 'react';
import { X } from 'lucide-react';
import { searchClient, type SearchResult } from '../../lib/search';

interface SearchSideBarProps {
  onClose: () => void;
  onNavigate: (href: string) => void;
  bookId: string;
}

export const SearchSideBar: React.FC<SearchSideBarProps> = ({ onClose, onNavigate, bookId }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = () => {
      if (!searchQuery.trim()) return;
      setIsSearching(true);
      setHasSearched(true);
      searchClient.search(searchQuery, bookId).then(results => {
          setSearchResults(results);
          setIsSearching(false);
      });
  };

  const escapeRegExp = (string: string) => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  const highlightMatch = (text: string, query: string) => {
      if (!query) return text;
      const escapedQuery = escapeRegExp(query);
      const parts = text.split(new RegExp(`(${escapedQuery})`, 'gi'));
      return parts.map((part, i) =>
          part.toLowerCase() === query.toLowerCase() ?
              <span key={i} className="bg-yellow-200 dark:bg-yellow-800 text-black dark:text-white font-bold px-0.5 rounded">{part}</span> :
              part
      );
  };

  return (
      <div data-testid="reader-search-sidebar" className="w-64 shrink-0 bg-surface border-r border-border overflow-y-auto z-20 absolute inset-y-0 left-0 md:static flex flex-col h-full bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700">
          <div className="p-4 border-b border-border dark:border-gray-700">
              <h2 className="text-lg font-bold mb-2 text-foreground dark:text-white">Search</h2>
              <div className="flex gap-2">
                  <input
                    data-testid="search-input"
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSearch();
                    }}
                    placeholder="Search in book..."
                    className="flex-1 text-sm p-2 border rounded bg-background text-foreground border-border dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                  />
                  <button
                    data-testid="search-close-button"
                    onClick={onClose}
                    className="p-2 hover:bg-border rounded dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
                  >
                    <X className="w-4 h-4 text-muted" />
                  </button>
              </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
              {isSearching ? (
                  <div className="text-center text-muted text-gray-500">Searching...</div>
              ) : (
                  <ul className="space-y-4">
                      {searchResults.map((result, idx) => (
                          <li key={idx} className="border-b border-border dark:border-gray-800 pb-2 last:border-0">
                              <button
                                data-testid={`search-result-${idx}`}
                                className="text-left w-full hover:bg-gray-50 dark:hover:bg-gray-800 p-2 rounded transition-colors"
                                onClick={() => onNavigate(result.href)}
                              >
                                  <p className="text-xs text-muted mb-1 text-gray-500">Result {idx + 1}</p>
                                  <p className="text-sm text-foreground line-clamp-3 dark:text-gray-300">
                                      {highlightMatch(result.excerpt, searchQuery)}
                                  </p>
                              </button>
                          </li>
                      ))}
                      {searchResults.length === 0 && hasSearched && !isSearching && (
                          <div className="text-center text-muted text-sm text-gray-500">No results found</div>
                      )}
                  </ul>
              )}
          </div>
      </div>
  );
};

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useToastStore } from '../../store/useToastStore';
import { BookCard } from './BookCard';
import { BookListItem } from './BookListItem';
import { EmptyLibrary } from './EmptyLibrary';
import { Upload, Settings, LayoutGrid, List as ListIcon, FilePlus, Search } from 'lucide-react';
import { useUIStore } from '../../store/useUIStore';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

type SortOption = 'recent' | 'last_read' | 'author' | 'title';

/**
 * The main library view component.
 * Displays the user's collection of books in a responsive grid or list and allows importing new books.
 * Handles fetching books from the store.
 *
 * @returns A React component rendering the library interface.
 */
export const LibraryView: React.FC = () => {
  const { books, fetchBooks, isLoading, error, addBook, isImporting, viewMode, setViewMode } = useLibraryStore();
  const { setGlobalSettingsOpen } = useUIStore();
  const showToast = useToastStore(state => state.showToast);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('recent');

  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      addBook(e.target.files[0]).then(() => {
        showToast("Book imported successfully", "success");
      }).catch((err) => {
        showToast(`Import failed: ${err.message}`, "error");
      });
    }
    // Reset input so same file can be selected again if needed
    if (e.target.value) {
      e.target.value = '';
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragActive) setDragActive(true);
  }, [dragActive]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragActive(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
       const file = e.dataTransfer.files[0];
       if (!file.name.toLowerCase().endsWith('.epub')) {
           showToast("Only .epub files are supported", "error");
           return;
       }

       addBook(file).then(() => {
        showToast("Book imported successfully", "success");
      }).catch((err) => {
        showToast(`Import failed: ${err.message}`, "error");
      });
    }
  }, [addBook, showToast]);

  const triggerFileUpload = () => {
    fileInputRef.current?.click();
  };

  const filteredAndSortedBooks = books
    .filter(book => {
      const query = searchQuery.toLowerCase();
      return (
        (book.title || '').toLowerCase().includes(query) ||
        (book.author || '').toLowerCase().includes(query)
      );
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'recent':
          // Sort by addedAt descending (newest first)
          return (b.addedAt || 0) - (a.addedAt || 0);
        case 'last_read':
          // Sort by lastRead descending (most recently read first)
          return (b.lastRead || 0) - (a.lastRead || 0);
        case 'author':
          // Sort by author ascending (A-Z)
          return (a.author || '').localeCompare(b.author || '');
        case 'title':
          // Sort by title ascending (A-Z)
          return (a.title || '').localeCompare(b.title || '');
        default:
          return 0;
      }
    });

  return (
    <div
      data-testid="library-view"
      className="container mx-auto px-4 py-8 max-w-7xl min-h-screen flex flex-col bg-background text-foreground relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        accept=".epub"
        className="hidden"
        data-testid="hidden-file-input"
      />

      {/* Drag Overlay */}
      {dragActive && (
        <div className="absolute inset-4 z-50 bg-background/90 backdrop-blur-sm flex items-center justify-center border-4 border-primary border-dashed rounded-xl transition-all duration-200 pointer-events-none">
            <div className="flex flex-col items-center gap-4 text-primary animate-in zoom-in-95 duration-200">
                <FilePlus className="w-20 h-20" />
                <p className="text-3xl font-bold">Drop EPUB to import</p>
            </div>
        </div>
      )}

      <header className="mb-6 flex flex-col gap-4">
        {/* Top Row: Title and Actions */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-foreground">My Library</h1>
          </div>

          <div className="flex gap-2">
            <Button
                variant="secondary"
                size="icon"
                onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                className="shadow-sm"
                aria-label={viewMode === 'grid' ? "Switch to list view" : "Switch to grid view"}
                data-testid="view-toggle-button"
            >
                {viewMode === 'grid' ? <ListIcon className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}
            </Button>
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setGlobalSettingsOpen(true)}
              className="shadow-sm"
              aria-label="Settings"
              data-testid="header-settings-button"
            >
              <Settings className="w-4 h-4" />
            </Button>
            <Button
              onClick={triggerFileUpload}
              disabled={isImporting}
              className="gap-2 shadow-sm"
              aria-label="Import book"
              data-testid="header-add-button"
            >
              {isImporting ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
              ) : (
                <Upload className="w-4 h-4" />
              )}
              <span className="font-medium hidden sm:inline">Import Book</span>
              <span className="font-medium sm:hidden">Import</span>
            </Button>
          </div>
        </div>

        {/* Second Row: Search Bar */}
        <div className="w-full">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="library-search-input"
            />
          </div>
        </div>

        {/* Third Row: Sort By */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="whitespace-nowrap">Sort by:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="bg-transparent font-medium text-foreground border-none focus:ring-0 cursor-pointer p-0 pr-8"
            data-testid="sort-select"
          >
            <option value="recent">Recently Added</option>
            <option value="last_read">Last Read</option>
            <option value="author">Author</option>
            <option value="title">Title</option>
          </select>
        </div>
      </header>

      {error && (
        <section className="mb-6 flex-none">
          <div className="p-4 bg-destructive/10 text-destructive rounded-lg">
              {error}
          </div>
        </section>
      )}

      {isLoading ? (
        <div className="flex justify-center items-center py-12 flex-1">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      ) : (
        <section className="flex-1 w-full">
          {books.length === 0 ? (
             <EmptyLibrary onImport={triggerFileUpload} />
          ) : filteredAndSortedBooks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <p className="text-lg">No books found matching "{searchQuery}"</p>
              <Button
                variant="link"
                onClick={() => setSearchQuery('')}
                className="mt-2"
              >
                Clear search
              </Button>
            </div>
          ) : (
            <>
              {viewMode === 'grid' ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-6 w-full">
                  {filteredAndSortedBooks.map((book) => (
                    <div key={book.id} className="flex justify-center">
                      <BookCard book={book} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-2 w-full">
                  {filteredAndSortedBooks.map((book) => (
                    <BookListItem key={book.id} book={book} />
                  ))}
                </div>
              )}
              {/* Spacer for bottom navigation or just breathing room */}
              <div className="h-24" />
            </>
          )}
        </section>
      )}
    </div>
  );
};

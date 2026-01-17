import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useLibraryStore, type SortOption } from '../../store/useLibraryStore';
import { usePreferencesStore } from '../../store/usePreferencesStore';
import { useAllBooks } from '../../store/selectors';
import { useReadingStateStore } from '../../store/useReadingStateStore';
import { useToastStore } from '../../store/useToastStore';
import { BookCard } from './BookCard';
import { BookListItem } from './BookListItem';
import { EmptyLibrary } from './EmptyLibrary';
import { Upload, Settings, LayoutGrid, List as ListIcon, FilePlus, Search } from 'lucide-react';
import { useUIStore } from '../../store/useUIStore';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select';
import { useShallow } from 'zustand/react/shallow';
import { DeleteBookDialog } from './DeleteBookDialog';
import { OffloadBookDialog } from './OffloadBookDialog';
import type { BookMetadata } from '../../types/db';
import { ReprocessingInterstitial } from './ReprocessingInterstitial';
import { CURRENT_BOOK_VERSION } from '../../lib/constants';
import { useNavigate, useLocation } from 'react-router-dom';
import { DuplicateBookError } from '../../types/errors';

/**
 * The main library view component.
 * Displays the user's collection of books in a responsive grid or list and allows importing new books.
 * Handles fetching books from the store.
 *
 * @returns A React component rendering the library interface.
 */
export const LibraryView: React.FC = () => {
  // OPTIMIZATION: Use useShallow to prevent re-renders when importProgress/uploadProgress changes
  const books = useAllBooks();
  const {
    isLoading,
    error,
    addBook,
    restoreBook,
    isImporting,
    sortOrder,
    setSortOrder,
    hydrateStaticMetadata
  } = useLibraryStore(useShallow(state => ({
    isLoading: state.isLoading,
    error: state.error,
    addBook: state.addBook,
    restoreBook: state.restoreBook,
    isImporting: state.isImporting,
    sortOrder: state.sortOrder,
    setSortOrder: state.setSortOrder,
    hydrateStaticMetadata: state.hydrateStaticMetadata
  })));

  const { libraryLayout, setLibraryLayout } = usePreferencesStore(useShallow(state => ({
    libraryLayout: state.libraryLayout,
    setLibraryLayout: state.setLibraryLayout
  })));

  // Alias for backward compatibility in component
  const viewMode = libraryLayout || 'grid';
  const setViewMode = setLibraryLayout;

  const { setGlobalSettingsOpen } = useUIStore();
  const showToast = useToastStore(state => state.showToast);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const restoreFileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  // Modal State Coordination
  const [activeModal, setActiveModal] = useState<{
    type: 'delete' | 'offload';
    book: BookMetadata;
  } | null>(null);

  const [bookToRestore, setBookToRestore] = useState<BookMetadata | null>(null);
  const [reprocessingBookId, setReprocessingBookId] = useState<string | null>(null);

  // Check for reprocessing request from navigation state
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = location.state as any;
    if (state && state.reprocessBookId) {
      // Clear state to prevent reopening on reload/navigation
      window.history.replaceState({}, document.title);
      // Defer state update to avoid triggering cascading renders
      setTimeout(() => setReprocessingBookId(state.reprocessBookId), 0);
    }
  }, [location.state]);

  // Phase 2: Hydrate static metadata after Yjs sync completes
  // Wait for books to be populated by Yjs before hydrating static metadata
  const bookCount = books.length; // useAllBooks returns array
  const { staticMetadata, offloadedBookIds } = useLibraryStore(useShallow(state => ({
    staticMetadata: state.staticMetadata,
    offloadedBookIds: state.offloadedBookIds
  })));
  const hydratedCount = Object.keys(staticMetadata).length;
  const offloadedCount = offloadedBookIds.size;

  // Track previous book count to detect when new books sync
  const prevBookCountRef = useRef(0);

  useEffect(() => {
    // Only hydrate when:
    // 1. Books exist AND book count increased (new books added)
    // 2. OR books exist but nothing has been hydrated yet (initial load on fresh device)
    const bookCountIncreased = bookCount > prevBookCountRef.current;
    const needsInitialHydration = bookCount > 0 && hydratedCount === 0 && offloadedCount === 0;

    if (bookCountIncreased || needsInitialHydration) {
      console.log(`[LibraryView] Hydration triggered: ${bookCount} books, ${hydratedCount} hydrated, ${offloadedCount} offloaded`);
      hydrateStaticMetadata();
    }

    prevBookCountRef.current = bookCount;
  }, [bookCount, hydratedCount, offloadedCount, hydrateStaticMetadata]);

  // Phase 2: fetchBooks removed - data auto-syncs via Yjs middleware

  const handleBookOpen = useCallback((book: BookMetadata) => {
    const effectiveVersion = book.version ?? 0;
    if (effectiveVersion < CURRENT_BOOK_VERSION) {
      setReprocessingBookId(book.id);
    } else {
      navigate(`/read/${book.id}`);
    }
  }, [navigate]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      addBook(file).then(() => {
        showToast("Book imported successfully", "success");
      }).catch((err) => {
        if (err instanceof DuplicateBookError) {
          if (window.confirm(`"${file.name}" already exists. Do you want to replace it?`)) {
            addBook(file, { overwrite: true }).then(() => {
              showToast("Book replaced successfully", "success");
            }).catch(e2 => {
              showToast(`Replace failed: ${e2.message}`, "error");
            });
          }
        } else {
          showToast(`Import failed: ${err.message}`, "error");
        }
      });
    }
    // Reset input so same file can be selected again if needed
    if (e.target.value) {
      e.target.value = '';
    }
  };

  const handleRestoreFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0] && bookToRestore) {
      restoreBook(bookToRestore.id, e.target.files[0]).then(() => {
        showToast(`Restored "${bookToRestore.title}"`, 'success');
      }).catch((err) => {
        console.error("Restore failed", err);
        showToast("Failed to restore book", "error");
      }).finally(() => {
        setBookToRestore(null);
      });
    }
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
        showToast("Book imported successfully", "success", 5000);
      }).catch((err) => {
        if (err instanceof DuplicateBookError) {
          if (window.confirm(`"${file.name}" already exists. Do you want to replace it?`)) {
            addBook(file, { overwrite: true }).then(() => {
              showToast("Book replaced successfully", "success");
            }).catch(e2 => {
              showToast(`Replace failed: ${e2.message}`, "error");
            });
          }
        } else {
          showToast(`Import failed: ${err.message}`, "error");
        }
      });
    }
  }, [addBook, showToast]);

  const triggerFileUpload = () => {
    fileInputRef.current?.click();
  };

  // Action Handlers
  const handleDelete = useCallback((book: BookMetadata) => {
    console.error(`[LibraryView] handleDelete called for ${book.id}`);
    setActiveModal({ type: 'delete', book });
  }, []);

  const handleOffload = useCallback((book: BookMetadata) => {
    console.error(`[LibraryView] handleOffload called for ${book.id}`);
    setActiveModal({ type: 'offload', book });
  }, []);

  const handleRestore = useCallback((book: BookMetadata) => {
    setBookToRestore(book);
    // Use setTimeout to ensure state is updated before click if needed, though usually not strictly necessary for simple refs
    // But direct click is fine.
    restoreFileInputRef.current?.click();
  }, []);

  // OPTIMIZATION: Create a search index to avoid expensive re-calculation on every render
  // This memoized value updates only when the books array changes, not on every search keystroke.
  // This avoids calling toLowerCase() N times per frame during typing.
  const searchableBooks = useMemo(() => {
    return books.map(book => ({
      book,
      // Pre-compute normalized strings
      searchString: `${(book.title || '').toLowerCase()} ${(book.author || '').toLowerCase()}`
    }));
  }, [books]);

  // OPTIMIZATION: Memoize filtered and sorted books
  const filteredAndSortedBooks = useMemo(() => {
    const query = searchQuery.toLowerCase();

    // 1. Filter using the pre-computed index (fast string check)
    const filtered = searchableBooks
      .filter(item => item.searchString.includes(query))
      .map(item => item.book);

    // 2. Sort the filtered results
    return filtered.sort((a, b) => {
      switch (sortOrder) {
        case 'recent':
          // Sort by addedAt descending (newest first)
          return (b.addedAt || 0) - (a.addedAt || 0);
        case 'last_read': {
          // Sort by lastRead from reading state descending (most recently read first)
          const getProgress = useReadingStateStore.getState().getProgress;
          const bProgress = getProgress(b.bookId);
          const aProgress = getProgress(a.bookId);
          return (bProgress?.lastRead || 0) - (aProgress?.lastRead || 0);
        }
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
  }, [searchableBooks, searchQuery, sortOrder]);

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

      <input
        type="file"
        ref={restoreFileInputRef}
        onChange={handleRestoreFileSelect}
        accept=".epub"
        className="hidden"
        data-testid="restore-file-input"
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

      {/* Shared Modals */}
      <DeleteBookDialog
        isOpen={activeModal?.type === 'delete'}
        book={activeModal?.book || null}
        onClose={() => setActiveModal(null)}
      />
      <OffloadBookDialog
        isOpen={activeModal?.type === 'offload'}
        book={activeModal?.book || null}
        onClose={() => setActiveModal(null)}
      />
      <ReprocessingInterstitial
        isOpen={!!reprocessingBookId}
        bookId={reprocessingBookId}
        onComplete={() => {
          const id = reprocessingBookId;
          setReprocessingBookId(null);
          if (id) navigate(`/read/${id}`);
        }}
        onClose={() => setReprocessingBookId(null)}
      />

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

        {/* Combined Row: Search and Sort */}
        <div className="flex flex-col gap-4 md:flex-row-reverse md:items-center md:justify-between">
          {/* Search Bar */}
          <div className="w-full md:w-72">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search library..."
                aria-label="Search library"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="library-search-input"
              />
            </div>
          </div>

          {/* Sort By */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="whitespace-nowrap" id="sort-by-label">Sort by:</span>
            <Select
              value={sortOrder}
              onValueChange={(val) => setSortOrder(val as SortOption)}
            >
              <SelectTrigger
                className="w-[180px] text-foreground"
                data-testid="sort-select"
                aria-labelledby="sort-by-label"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Recently Added</SelectItem>
                <SelectItem value="last_read">Last Read</SelectItem>
                <SelectItem value="author">Author</SelectItem>
                <SelectItem value="title">Title</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
                <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-6 w-full">
                  {filteredAndSortedBooks.map((book) => (
                    <div key={book.id} className="flex justify-center">
                      <BookCard
                        book={book}
                        onOpen={handleBookOpen}
                        onDelete={handleDelete}
                        onOffload={handleOffload}
                        onRestore={handleRestore}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-2 w-full">
                  {filteredAndSortedBooks.map((book) => (
                    <BookListItem
                      key={book.id}
                      book={book}
                      onOpen={handleBookOpen}
                      onDelete={handleDelete}
                      onOffload={handleOffload}
                      onRestore={handleRestore}
                    />
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

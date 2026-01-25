import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useLibraryStore, type SortOption } from '../../store/useLibraryStore';
import { usePreferencesStore } from '../../store/usePreferencesStore';
import { useAllBooks } from '../../store/selectors';
import { createLogger } from '../../lib/logger';
import { useToastStore } from '../../store/useToastStore';
import { BookCard } from './BookCard';
import { BookListItem } from './BookListItem';
import { EmptyLibrary } from './EmptyLibrary';
import { SyncPulseIndicator } from '../sync/SyncPulseIndicator';
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
import { ReplaceBookDialog } from './ReplaceBookDialog';

/**
 * The main library view component.
 * Displays the user's collection of books in a responsive grid or list and allows importing new books.
 * Handles fetching books from the store.
 *
 * @returns A React component rendering the library interface.
 */
const logger = createLogger('LibraryView');

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


  const { libraryLayout, setLibraryLayout, libraryFilterMode, setLibraryFilterMode } = usePreferencesStore(useShallow(state => ({
    libraryLayout: state.libraryLayout,
    setLibraryLayout: state.setLibraryLayout,
    libraryFilterMode: state.libraryFilterMode,
    setLibraryFilterMode: state.setLibraryFilterMode
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

  const [duplicateQueue, setDuplicateQueue] = useState<File[]>([]);
  const currentDuplicate = duplicateQueue[0];
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
      hydrateStaticMetadata();
    }

    prevBookCountRef.current = bookCount;
  }, [bookCount, hydratedCount, offloadedCount, hydrateStaticMetadata]);

  // Phase 2: fetchBooks removed - data auto-syncs via Yjs middleware

  const handleRestore = useCallback((book: BookMetadata) => {
    setBookToRestore(book);
    restoreFileInputRef.current?.click();
  }, []);

  const handleBookOpen = useCallback((book: BookMetadata) => {
    // Check if file is missing (Ghost or Offloaded)
    const isGhost = !staticMetadata[book.id] && !offloadedBookIds.has(book.id);
    const isOffloaded = book.isOffloaded || offloadedBookIds.has(book.id);

    if (isGhost || isOffloaded) {
      handleRestore(book);
      return;
    }

    const effectiveVersion = book.version ?? 0;
    if (effectiveVersion < CURRENT_BOOK_VERSION) {
      setReprocessingBookId(book.id);
    } else {
      navigate(`/read/${book.id}`);
    }
  }, [navigate, staticMetadata, offloadedBookIds, handleRestore]);

  const handleResumeReading = useCallback((book: BookMetadata, _deviceId: string, _cfi: string) => {
    // Check if file is missing (Ghost or Offloaded)
    const isGhost = !staticMetadata[book.id] && !offloadedBookIds.has(book.id);
    const isOffloaded = book.isOffloaded || offloadedBookIds.has(book.id);

    if (isGhost || isOffloaded) {
      handleBookOpen(book);
      return;
    }

    // Do NOT auto-update location. Let the Reader View's Smart Resume Toast handle the prompt.
    // updateLocation(book.id, cfi, 0); 
    handleBookOpen(book);
  }, [handleBookOpen, staticMetadata, offloadedBookIds]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      addBook(file).then(() => {
        showToast("Book imported successfully", "success");
      }).catch((err) => {
        if (err instanceof DuplicateBookError) {
          setDuplicateQueue(prev => [...prev, file]);
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

  const handleConfirmReplace = async () => {
    if (!currentDuplicate) return;
    try {
      await addBook(currentDuplicate, { overwrite: true });
      showToast("Book replaced successfully", "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      showToast(`Replace failed: ${msg}`, "error");
      throw e;
    }
  };

  const handleRestoreFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0] && bookToRestore) {
      restoreBook(bookToRestore.id, e.target.files[0]).then(() => {
        showToast(`Restored "${bookToRestore.title}"`, 'success');
      }).catch((err) => {
        logger.error("Restore failed", err);
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
          setDuplicateQueue(prev => [...prev, file]);
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
    setActiveModal({ type: 'delete', book });
  }, []);

  const handleOffload = useCallback((book: BookMetadata) => {
    setActiveModal({ type: 'offload', book });
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
    let filtered = searchableBooks
      .filter(item => item.searchString.includes(query))
      .map(item => item.book);

    // 2. Apply "On Device" filter
    if (libraryFilterMode === 'downloaded') {
      filtered = filtered.filter(book => {
        // A book is downloaded if it's in staticMetadata OR it's been offloaded (technically offloaded means NOT on device, 
        // but for this filter we usually mean "File Present". 
        // Ghost Book = !staticMetadata && !offloaded. 
        // So "On Device" = staticMetadata[book.id] exists.
        // Wait, "Offloaded" explicitly means file removed. So it is NOT on device.
        // So we only keep books where staticMetadata[book.id] is truthy.
        return !!staticMetadata[book.id];
      });
    }

    // 3. Sort the filtered results
    return filtered.sort((a, b) => {
      switch (sortOrder) {
        case 'recent':
          // Sort by addedAt descending (newest first)
          return (b.addedAt || 0) - (a.addedAt || 0);
        case 'last_read': {
          // Sort by lastRead from reading state descending (most recently read first)
          // OPTIMIZATION: Use pre-computed lastRead from useAllBooks
          return (b.lastRead || 0) - (a.lastRead || 0);
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
  }, [searchableBooks, searchQuery, sortOrder, libraryFilterMode, staticMetadata]);

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

      <ReplaceBookDialog
        isOpen={!!currentDuplicate}
        onClose={() => setDuplicateQueue(prev => prev.slice(1))}
        onConfirm={handleConfirmReplace}
        fileName={currentDuplicate?.name || ''}
      />

      <header className="mb-6 flex flex-col gap-4">
        {/* Top Row: Title and Actions */}
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-foreground">My Library</h1>
            <SyncPulseIndicator />
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

          <div className="flex flex-row items-center justify-between gap-2 w-full md:w-auto">
            {/* Filter Toggle */}
            <div className="flex items-center bg-muted/50 p-1 rounded-lg border shrink-0">
              <Button
                variant={(!libraryFilterMode || libraryFilterMode === 'all') ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setLibraryFilterMode('all')}
                className="h-7 px-2 sm:px-3 text-xs"
                data-testid="filter-all-books"
              >
                All Books
              </Button>
              <Button
                variant={libraryFilterMode === 'downloaded' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setLibraryFilterMode('downloaded')}
                className="h-7 px-2 sm:px-3 text-xs"
                data-testid="filter-downloaded-books"
              >
                On Device
              </Button>
            </div>

            {/* Sort By */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground shrink-0">
              <span className="whitespace-nowrap hidden sm:inline" id="sort-by-label">Sort by:</span>
              <Select
                value={sortOrder}
                onValueChange={(val) => setSortOrder(val as SortOption)}
              >
                <SelectTrigger
                  className="w-[130px] sm:w-[180px] text-foreground text-xs sm:text-sm h-8 sm:h-10"
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
                  {filteredAndSortedBooks.map((book) => {


                    const isGhostBook = !staticMetadata[book.id] && !offloadedBookIds.has(book.id);

                    return (
                      <div key={book.id} className="flex justify-center">
                        <BookCard
                          book={book}
                          isGhostBook={isGhostBook}
                          onOpen={handleBookOpen}
                          onDelete={handleDelete}
                          onOffload={handleOffload}
                          onRestore={handleRestore}
                          onResume={handleResumeReading}
                        />
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="flex flex-col gap-2 w-full">
                  {filteredAndSortedBooks.map((book) => {
                    const isGhostBook = !staticMetadata[book.id] && !offloadedBookIds.has(book.id);
                    return (
                      <BookListItem
                        key={book.id}
                        book={book}
                        isGhostBook={isGhostBook}
                        onOpen={handleBookOpen}
                        onDelete={handleDelete}
                        onOffload={handleOffload}
                        onRestore={handleRestore}
                      />
                    )
                  })}
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

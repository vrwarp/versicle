import React, { useEffect, useState, useRef, useCallback, useMemo, Suspense } from 'react';
import { useLibraryStore } from '@store/useLibraryStore';
import { usePreferencesStore } from '@store/usePreferencesStore';
import { useAllBooks } from '@store/libraryViewStore';
import { createLogger } from '@lib/logger';
import { useToastStore } from '@store/useToastStore';
import { BookCard } from './BookCard';
import { BookListItem } from './BookListItem';
import { EmptyLibrary } from './EmptyLibrary';
import { SyncPulseIndicator } from '../sync/SyncPulseIndicator';
import { Upload, Settings, LayoutGrid, List as ListIcon, FilePlus, Loader2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { ImportSourceDialog } from './ImportSourceDialog';
import { ContentMissingDialog } from './ContentMissingDialog';
import { DriveImportDialog } from '../drive/DriveImportDialog';
import { getGoogleAuthClient } from '@domains/google';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select';
import { useShallow } from 'zustand/react/shallow';
import { DeleteBookDialog } from './DeleteBookDialog';
import { OffloadBookDialog } from './OffloadBookDialog';
import type { BookMetadata } from '~types/book';
import { ReprocessingInterstitial } from './ReprocessingInterstitial';
import { CURRENT_BOOK_VERSION } from '@lib/constants';
import { useNavigate, useLocation } from 'react-router-dom';
import { DuplicateBookError } from '~types/errors';
import { ReplaceBookDialog } from './ReplaceBookDialog';
import { useNavigationGuard } from '@hooks/useNavigationGuard';
import { BackButtonPriority } from '@store/useBackNavigationStore';
import { useImportController } from '@app/library/useImportController';
import { presentError } from '@app/errors/presentError';
import { LibrarySearchBar, type LibrarySearchBarRef } from './LibrarySearchBar';
import { compareTitles } from '@kernel/locale/format';

/**
 * The main library view component.
 * Displays the user's collection of books in a responsive grid or list and allows importing new books.
 * Handles fetching books from the store.
 *
 * Phase 8 §A/§J: the view context is ROUTE state, not a synced preference —
 * `/` renders the library, `/notes` renders this same shell in notes
 * context (the header Select navigates). The notes view itself is lazy so
 * it stays out of the boot-surface chunk.
 *
 * @returns A React component rendering the library interface.
 */
const logger = createLogger('LibraryView');

const GlobalNotesViewLazy = React.lazy(() =>
  import('../notes/GlobalNotesView').then((m) => ({ default: m.GlobalNotesView })),
);

interface LibraryViewProps {
  /** Which context this route renders: the library grid or global notes. */
  context?: 'library' | 'notes';
}

export const LibraryView: React.FC<LibraryViewProps> = ({ context = 'library' }) => {
  // OPTIMIZATION: Use useShallow to prevent re-renders when importProgress/uploadProgress changes
  const books = useAllBooks();
  const {
    isLoading,
    error,
    isImporting
  } = useLibraryStore(useShallow(state => ({
    isLoading: state.isLoading,
    error: state.error,
    isImporting: state.isImporting
  })));
  const controller = useImportController();


  const { libraryLayout, setLibraryLayout, libraryFilterMode, setLibraryFilterMode, librarySortOrder, setLibrarySortOrder } = usePreferencesStore(useShallow(state => ({
    libraryLayout: state.libraryLayout,
    setLibraryLayout: state.setLibraryLayout,
    libraryFilterMode: state.libraryFilterMode,
    setLibraryFilterMode: state.setLibraryFilterMode,
    librarySortOrder: state.librarySortOrder,
    setLibrarySortOrder: state.setLibrarySortOrder
  })));

  // Alias for backward compatibility in component
  const viewMode = libraryLayout || 'grid';
  const setViewMode = setLibraryLayout;
  const showToast = useToastStore(state => state.showToast);
  const searchBarRef = useRef<LibrarySearchBarRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
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

  useNavigationGuard(() => {
    setActiveModal(null);
  }, BackButtonPriority.MODAL, !!activeModal);

  useNavigationGuard(() => {
    setDuplicateQueue(prev => prev.slice(1));
  }, BackButtonPriority.MODAL, duplicateQueue.length > 0);

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

  const { staticMetadata, offloadedBookIds } = useLibraryStore(useShallow(state => ({
    staticMetadata: state.staticMetadata,
    offloadedBookIds: state.offloadedBookIds
  })));

  // Phase 7 (D16 paid): static-metadata hydration has ONE owner — the
  // LibraryService inventory-delta subscription started by the boot task
  // (src/app/boot/whenHydrated.ts). The prevBookCountRef heuristic that
  // duplicated it here is gone.

  // Phase 5: Drive Import
  const [isDriveImportOpen, setIsDriveImportOpen] = useState(false);
  const [isImportSourceOpen, setIsImportSourceOpen] = useState(false);
  const [isContentMissingOpen, setIsContentMissingOpen] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  const handleBrowseDrive = async () => {
    try {
      // User gesture: silent token when cached, interactive connect otherwise.
      await getGoogleAuthClient().getTokenInteractive('drive');
      setIsDriveImportOpen(true);
    } catch (error) {
      console.error("Failed to access Drive", error);
      showToast("Please connect Google Drive in Settings first.", 'error');
    }
  };

  const handleRestore = useCallback((book: BookMetadata) => {
    setBookToRestore(book);
    setIsContentMissingOpen(true);
  }, []);

  const handlePerformRestore = async (file: File) => {
    if (!bookToRestore) return;

    setIsRestoring(true);
    try {
      await controller.restoreBook(bookToRestore.id, file);
      showToast(`Restored "${bookToRestore.title}"`, 'success');
      setIsContentMissingOpen(false);
      setBookToRestore(null);
    } catch (err) {
      logger.error("Restore failed", err);
      showToast("Failed to restore book", "error");
    } finally {
      setIsRestoring(false);
    }
  };

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

  const handleResumeReading = useCallback((book: BookMetadata) => {
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
      controller.importFile(file).then(() => {
        showToast("Book imported successfully", "success");
      }).catch((err) => {
        if (err instanceof DuplicateBookError) {
          setDuplicateQueue(prev => [...prev, file]);
        } else {
          showToast(`Import failed: ${presentError(err)}`, "error");
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
      await controller.replaceFile(currentDuplicate);
      showToast("Book replaced successfully", "success");
    } catch (e) {
      showToast(`Replace failed: ${presentError(e)}`, "error");
      throw e;
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

      controller.importFile(file).then(() => {
        showToast("Book imported successfully", "success", 5000);
      }).catch((err) => {
        if (err instanceof DuplicateBookError) {
          setDuplicateQueue(prev => [...prev, file]);
        } else {
          showToast(`Import failed: ${presentError(err)}`, "error");
        }
      });
    }
  }, [controller, showToast]);

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



  // OPTIMIZATION: Memoize filtered and sorted books
  const filteredAndSortedBooks = useMemo(() => {
    // BOLT OPTIMIZATION: Use debounced search query to prevent filtering/sorting on every keystroke
    const query = debouncedSearchQuery.toLowerCase();
    const isDownloadedFilter = libraryFilterMode === 'downloaded';

    // 1 & 2. Mapless single-pass filter to prevent intermediate array allocations and GC thrashing
    const filtered: typeof books = [];
    for (let i = 0; i < books.length; i++) {
      const book = books[i];

      let isMatch = true;
      if (query) {
        const titleStr = book.title || '';
        const authorStr = book.author || '';
        // BOLT OPTIMIZATION: Lazily evaluate toLowerCase only if an active query exists
        // This avoids O(N) allocations when books change rapidly due to lastRead updates.
        isMatch = titleStr.toLowerCase().includes(query) || authorStr.toLowerCase().includes(query);
      }

      if (isMatch) {
        // A book is downloaded if it's in staticMetadata OR it's been offloaded (technically offloaded means NOT on device,
        // but for this filter we usually mean "File Present".
        // Ghost Book = !staticMetadata && !offloaded.
        // So "On Device" = staticMetadata[book.id] exists.
        if (isDownloadedFilter && !staticMetadata[book.id]) {
          continue;
        }
        filtered.push(book);
      }
    }

    // 3. Sort the filtered results
    return filtered.sort((a, b) => {
      switch (librarySortOrder) {
        case 'recent':
          // Sort by addedAt descending (newest first)
          return (b.addedAt || 0) - (a.addedAt || 0);
        case 'last_read': {
          // Sort by lastRead from reading state descending (most recently read first)
          // OPTIMIZATION: Use pre-computed lastRead from useAllBooks
          return (b.lastRead || 0) - (a.lastRead || 0);
        }
        case 'author':
          // Sort by author ascending (A-Z) — cached numeric collator (I18N-10)
          return compareTitles(a.author || '', b.author || '');
        case 'title':
          // Sort by title ascending (A-Z) — cached numeric collator (I18N-10)
          return compareTitles(a.title || '', b.title || '');
        default:
          return 0;
      }
    });
  }, [books, debouncedSearchQuery, librarySortOrder, libraryFilterMode, staticMetadata]);

  // OPTIMIZATION: Memoize rendered VDOM items to prevent O(N) allocation on every keystroke in the search bar.
  // When `searchQuery` updates (keystroke), LibraryView re-renders immediately, but `debouncedSearchQuery`
  // (and thus `filteredAndSortedBooks`) stays the same until the debounce delay elapses.
  const renderedGridItems = useMemo(() => {
    return filteredAndSortedBooks.map((book) => {
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
      );
    });
  }, [filteredAndSortedBooks, staticMetadata, offloadedBookIds, handleBookOpen, handleDelete, handleOffload, handleRestore, handleResumeReading]);

  const renderedListItems = useMemo(() => {
    return filteredAndSortedBooks.map((book) => {
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
      );
    });
  }, [filteredAndSortedBooks, staticMetadata, offloadedBookIds, handleBookOpen, handleDelete, handleOffload, handleRestore]);


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
        aria-label="Upload EPUB file"
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

      <ImportSourceDialog
        open={isImportSourceOpen}
        onOpenChange={setIsImportSourceOpen}
        onImportFromDevice={triggerFileUpload}
        onImportFromDrive={handleBrowseDrive}
      />

      {bookToRestore && (
        <ContentMissingDialog
          open={isContentMissingOpen}
          onOpenChange={(open) => {
            setIsContentMissingOpen(open);
            if (!open) setBookToRestore(null);
          }}
          book={bookToRestore}
          onRestore={handlePerformRestore}
          isRestoring={isRestoring}
        />
      )}

      <DriveImportDialog
        isOpen={isDriveImportOpen}
        onClose={() => setIsDriveImportOpen(false)}
      />

      <header className="mb-6 flex flex-col gap-4">
        {/* Top Row: Title and Actions */}
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Select value={context} onValueChange={(val) => navigate(val === 'notes' ? '/notes' : '/')}>
              <SelectTrigger className="w-auto text-2xl sm:text-3xl font-bold border-0 shadow-none p-0 h-auto focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none flex-shrink-0" aria-label="Select view context">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="library">My Library</SelectItem>
                <SelectItem value="notes">Notes</SelectItem>
              </SelectContent>
            </Select>
            <SyncPulseIndicator />
          </div>

          <div className="flex gap-2">
            {context === 'library' && (
              <>
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
                  onClick={() => setIsImportSourceOpen(true)}
                  disabled={isImporting}
                  className="gap-2 shadow-sm max-sm:px-3"
                  data-testid="header-add-button"
                  size={isImporting ? "icon" : "default"}
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      <span className="sr-only" aria-live="polite">Importing...</span>
                    </>
                  ) : (
                    <Upload className="w-4 h-4" aria-hidden="true" />
                  )}
                  <span aria-hidden={isImporting} className="font-medium hidden sm:inline">
                    {isImporting ? "Importing..." : "Import Book"}
                  </span>
                </Button>
              </>
            )}
            <Button
              variant="secondary"
              size="icon"
              onClick={() => navigate('/settings')}
              className="shadow-sm"
              aria-label="Settings"
              data-testid="header-settings-button"
            >
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Combined Row: Search and Sort */}
        {context === 'library' && (
          <div className="flex flex-col gap-4 md:flex-row-reverse md:items-center md:justify-between">
            {/* Search Bar */}
            <div className="w-full md:w-72">
              <LibrarySearchBar
                ref={searchBarRef}
                onQueryChange={setDebouncedSearchQuery}
                filteredCount={filteredAndSortedBooks.length}
                isFilteredEmpty={filteredAndSortedBooks.length === 0}
              />
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
                  value={librarySortOrder}
                  onValueChange={(val) => setLibrarySortOrder(val as 'recent' | 'last_read' | 'author' | 'title')}
                >
                  <SelectTrigger
                    className="w-[130px] sm:w-[180px] text-foreground text-xs sm:text-sm h-8 sm:h-10"
                    data-testid="sort-select"
                    aria-label="Sort library by"
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
        )}
      </header>

      {error && (
        <section className="mb-6 flex-none">
          <div className="p-4 bg-destructive/10 text-destructive rounded-lg">
            {error}
          </div>
        </section>
      )}

      {isLoading ? (
        <div
          className="flex justify-center items-center py-12 flex-1"
          role="status"
          aria-label="Loading library"
        >
          <Loader2 className="h-12 w-12 animate-spin text-primary" aria-hidden="true" />
          <span className="sr-only" aria-live="polite">Loading library...</span>
        </div>
      ) : context === 'notes' ? (
        <Suspense
          fallback={
            <div className="flex justify-center items-center py-12 flex-1" role="status" aria-label="Loading notes">
              <Loader2 className="h-12 w-12 animate-spin text-primary" aria-hidden="true" />
            </div>
          }
        >
          <GlobalNotesViewLazy onContentMissing={(bookId) => {
            const book = books.find(b => b.id === bookId);
            if (book) handleRestore(book);
          }} />
        </Suspense>
      ) : (
        <section className="flex-1 w-full">
          {books.length === 0 ? (
            <EmptyLibrary onImport={triggerFileUpload} />
          ) : filteredAndSortedBooks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <p className="text-lg">No books found matching "{debouncedSearchQuery}"</p>
              <Button
                variant="link"
                onClick={() => searchBarRef.current?.clearSearch()}
                className="mt-2"
              >
                Clear search
              </Button>
            </div>
          ) : (
            <>
              {viewMode === 'grid' ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-6 w-full">
                  {renderedGridItems}
                </div>
              ) : (
                <div className="flex flex-col gap-2 w-full">
                  {renderedListItems}
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

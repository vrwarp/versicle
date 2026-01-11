import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useLibraryStore, type SortOption } from '../../store/useLibraryStore';
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
import type { BookMetadata, StaticBookManifest } from '../../types/db';
import { ReprocessingInterstitial } from './ReprocessingInterstitial';
import { CURRENT_BOOK_VERSION } from '../../lib/constants';
import { useNavigate, useLocation } from 'react-router-dom';
import { getDB } from '../../db/db';

/**
 * The main library view component.
 * Displays the user's collection of books in a responsive grid or list and allows importing new books.
 * Handles fetching books from the store.
 *
 * @returns A React component rendering the library interface.
 */
export const LibraryView: React.FC = () => {
  // Phase 2 Refactor: `books` is now a Record<string, UserInventoryItem> from Yjs
  const {
    books: booksMap,
    addBook,
    restoreBook,
    isImporting,
    viewMode,
    setViewMode,
    sortOrder,
    setSortOrder,
    removeBook,
    offloadBook
  } = useLibraryStore(useShallow(state => ({
    books: state.books,
    addBook: state.addBook,
    restoreBook: state.restoreBook,
    isImporting: state.isImporting,
    viewMode: state.viewMode,
    setViewMode: state.setViewMode,
    sortOrder: state.sortOrder,
    setSortOrder: state.setSortOrder,
    removeBook: state.removeBook,
    offloadBook: state.offloadBook
  })));

  const { setGlobalSettingsOpen } = useUIStore();
  const showToast = useToastStore(state => state.showToast);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const restoreFileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  // Local state for merged metadata (Static + Yjs)
  const [mergedBooks, setMergedBooks] = useState<BookMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch Static Manifests and Merge
  useEffect(() => {
    let active = true;
    const fetchAndMerge = async () => {
        try {
            const db = await getDB();
            const manifests = await db.getAll('static_manifests');
            // Also fetch progress for correct display
            // In a real app we might want to subscribe to progress map too,
            // or fetch it. For now, let's fetch it once or rely on dbService?
            // Since we are "Store-First" but migrating, we need to bridge.
            // The `useLibraryStore` (Yjs) has `books` (Inventory).
            // We need to fetch `static_manifests` and maybe `user_progress` (if not yet in Yjs fully or we want it).
            // Actually, `user_progress` is in Yjs `progress` map but we didn't bind it to `useLibraryStore`.
            // For Phase 2, let's fetch progress from IDB as a fallback or if Yjs is not ready.
            // Wait, Phase 2 plan says "User stores are handled by Yjs".
            // So `progress` should be read from Yjs?
            // But `useLibraryStore` doesn't expose it.

            // Workaround for Phase 2: Fetch `user_progress` from IDB to keep UI working until we fully bind everything.
            // Since `dbService` writes are disabled for `user_progress` (except via Yjs syncing back? No, Yjs is source).
            // Actually, we haven't implemented Yjs -> IDB sync for user_progress yet (The "Great Migration").
            // So `user_progress` in IDB might be STALE if we only write to Yjs.
            // BUT: We haven't updated `ReaderView` to write to Yjs `progress` map yet.
            // `ReaderView` still calls `updateLocation`.
            // My previous step updated `useReaderStore` (transient) but `ReaderView` calls `dbService.saveProgress` (Legacy).
            // I removed `dbService.saveProgress` implementation! (It was "Delete" in plan).
            // Wait, I *did* remove `saveProgress` from `DBService` class in my `DBService.ts` update?
            // Let me check `DBService.ts` content I wrote.
            // I removed `saveProgress`.

            // So `ReaderView` calling `dbService.saveProgress` will crash or do nothing if I removed it.
            // I need to check `ReaderView.tsx`.
            // `ReaderView.tsx` calls `dbService.saveProgress`.

            // CRITICAL: I must update `ReaderView` to use Yjs for progress saving, OR restore `saveProgress` temporarily.
            // The plan said "Refactor DBService ... Remove saveProgress".
            // So `ReaderView` MUST be updated.

            // I will fix `ReaderView` in the next step.
            // For `LibraryView`, I need to display progress.
            // I will assume `ReaderView` writes to Yjs `progress` map.
            // So I need to read Yjs `progress` map here.

            // Since `useLibraryStore` is bound to `inventory`, I can't easily access `progress` map unless I add it to `useLibraryStore`.
            // I will add `progress` binding to `useLibraryStore` in the next iteration or use a separate hook.

            // For now, to unblock, I will fetch `user_progress` from IDB (legacy) and mix it.
            // This assumes `ReaderView` still writes to IDB or Yjs syncs to IDB.
            // But if `saveProgress` is gone, no one writes to IDB `user_progress`.
            // So `ReaderView` -> Yjs `progress`.
            // Yjs `progress` -> `y-indexeddb` -> IDB `versicle-yjs`.
            // It does NOT go to `user_progress` store in `EpubLibraryDB`.
            // So `db.getAll('user_progress')` will return OLD data.

            // Conclusion: `LibraryView` MUST read from Yjs `progress` map.
            // I should update `useLibraryStore` to also bind `progress`.

            // Temporary Fix: Just use `booksMap` (Inventory) and `manifests`.
            // Progress will be 0 until I fix the progress binding.

            const manifestMap = new Map(manifests.map(m => [m.bookId, m]));
            const merged: BookMetadata[] = [];

            // Iterate over Yjs Inventory (Source of Truth for "My Books")
            Object.values(booksMap).forEach(inv => {
                const man = manifestMap.get(inv.bookId);
                if (man) {
                    merged.push({
                        id: man.bookId,
                        title: inv.customTitle || man.title,
                        author: inv.customAuthor || man.author,
                        description: man.description,
                        coverBlob: man.coverBlob,
                        addedAt: inv.addedAt,
                        bookId: man.bookId,
                        filename: inv.sourceFilename,
                        fileHash: man.fileHash,
                        fileSize: man.fileSize,
                        totalChars: man.totalChars,
                        version: man.schemaVersion,
                        // Progress is missing for now
                        progress: 0,
                        lastRead: inv.lastInteraction,
                        isOffloaded: false // Need to check static_resources
                    });
                }
            });

            // Check Offloaded Status
            const resourceKeys = await db.getAllKeys('static_resources');
            const resourceSet = new Set(resourceKeys);
            merged.forEach(b => {
                b.isOffloaded = !resourceSet.has(b.id);
            });

            if (active) {
                setMergedBooks(merged.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)));
                setIsLoading(false);
            }

        } catch (e) {
            console.error("Failed to merge library data", e);
            if (active) setIsLoading(false);
        }
    };

    fetchAndMerge();

    return () => { active = false; };
  }, [booksMap]);


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
        showToast(`Import failed: ${err.message}`, "error");
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

  const handleRestore = useCallback((book: BookMetadata) => {
    setBookToRestore(book);
    requestAnimationFrame(() => {
        restoreFileInputRef.current?.click();
    });
  }, []);

  // OPTIMIZATION: Create a search index
  const searchableBooks = useMemo(() => {
    return mergedBooks.map(book => ({
      book,
      searchString: `${(book.title || '').toLowerCase()} ${(book.author || '').toLowerCase()}`
    }));
  }, [mergedBooks]);

  // OPTIMIZATION: Memoize filtered and sorted books
  const filteredAndSortedBooks = useMemo(() => {
    const query = searchQuery.toLowerCase();

    // 1. Filter
    const filtered = searchableBooks
      .filter(item => item.searchString.includes(query))
      .map(item => item.book);

    // 2. Sort
    return filtered.sort((a, b) => {
        switch (sortOrder) {
          case 'recent':
            return (b.addedAt || 0) - (a.addedAt || 0);
          case 'last_read':
            return (b.lastRead || 0) - (a.lastRead || 0);
          case 'author':
            return (a.author || '').localeCompare(b.author || '');
          case 'title':
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
                placeholder="Search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="library-search-input"
              />
            </div>
          </div>

          {/* Sort By */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="whitespace-nowrap">Sort by:</span>
            <Select
              value={sortOrder}
              onValueChange={(val) => setSortOrder(val as SortOption)}
            >
              <SelectTrigger
                className="w-[180px] text-foreground"
                data-testid="sort-select"
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

      {isLoading ? (
        <div className="flex justify-center items-center py-12 flex-1">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      ) : (
        <section className="flex-1 w-full">
          {mergedBooks.length === 0 ? (
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

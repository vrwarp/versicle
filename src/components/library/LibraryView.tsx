import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useLibraryStore, type SortOption } from '../../store/useLibraryStore';
import { useInventoryStore } from '../../store/useInventoryStore';
import { useProgressStore } from '../../store/useProgressStore';
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

/**
 * The main library view component.
 * Displays the user's collection of books by composing data from Inventory and Progress stores.
 */
export const LibraryView: React.FC = () => {
  // UI State & Actions
  const {
    fetchBooks, // Legacy/Stub
    error,
    addBook,
    restoreBook,
    isImporting,
    viewMode,
    setViewMode,
    sortOrder,
    setSortOrder
  } = useLibraryStore(useShallow(state => ({
    fetchBooks: state.fetchBooks,
    error: state.error,
    addBook: state.addBook,
    restoreBook: state.restoreBook,
    isImporting: state.isImporting,
    viewMode: state.viewMode,
    setViewMode: state.setViewMode,
    sortOrder: state.sortOrder,
    setSortOrder: state.setSortOrder
  })));

  // Data Stores
  const inventory = useInventoryStore(state => state.books);
  const progressMap = useProgressStore(state => state.progress);

  // Compose Books
  const books = useMemo<BookMetadata[]>(() => {
    return Object.values(inventory).map(item => {
      const prog = progressMap[item.bookId];
      return {
        id: item.bookId,
        title: item.customTitle || 'Untitled',
        author: item.customAuthor || 'Unknown User',
        description: '',
        addedAt: item.addedAt,
        bookId: item.bookId,
        filename: item.sourceFilename,

        // Map other fields if available in item.tags or similar?
        // For now, minimal mapping for UI
        coverBlob: undefined, // Cover blobs are in static_manifests/resources, likely need a hook or component to fetch
        // Actually BookCard fetches cover. Mapping here just needs ID/Title.

        // Progress
        lastRead: prog?.lastRead,
        progress: prog?.percentage || 0,
        currentCfi: prog?.currentCfi,

        // Schema Fields
        fileHash: undefined, // In static_manifests
        fileSize: 0,
        totalChars: 0,
        version: CURRENT_BOOK_VERSION, // Assume current or checking needed?
        // NOTE: Version checking relying on metadata might be tricky if we don't assume sync.
        // ReaderView checks version from useEpubReader hook which loads from file.
        // So here we can pass 0 or undefined.

        isOffloaded: false // TODO: Check via dbService or separate store?
      };
    });
  }, [inventory, progressMap]);

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
      window.history.replaceState({}, document.title);
      setTimeout(() => setReprocessingBookId(state.reprocessBookId), 0);
    }
  }, [location.state]);

  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

  const handleBookOpen = useCallback((book: BookMetadata) => {
    // Version check relies on BookMetadata having version. 
    // Since we construct it from Inventory (which lacks version), we might skip check or assume OK.
    // ReaderView performs the definitive check.
    navigate(`/read/${book.id}`);
  }, [navigate]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      addBook(e.target.files[0]).then(() => {
        showToast("Book imported successfully", "success");
      }).catch((err) => {
        showToast(`Import failed: ${err.message}`, "error");
      });
    }
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

  // OPTIMIZATION: Create a search index to avoid expensive re-calculation on every render
  const searchableBooks = useMemo(() => {
    return books.map(book => ({
      book,
      searchString: `${(book.title || '').toLowerCase()} ${(book.author || '').toLowerCase()}`
    }));
  }, [books]);

  // OPTIMIZATION: Memoize filtered and sorted books
  const filteredAndSortedBooks = useMemo(() => {
    const query = searchQuery.toLowerCase();

    const filtered = searchableBooks
      .filter(item => item.searchString.includes(query))
      .map(item => item.book);

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

      {error && (
        <section className="mb-6 flex-none">
          <div className="p-4 bg-destructive/10 text-destructive rounded-lg">
            {error}
          </div>
        </section>
      )}

      {/* Basic Loading check? Yjs sync is separate */}
      {/* If books len is 0, we show empty library. 
          If syncing takes time, it might flash empty. 
          Ideally we check yjs status via provider or store.
          For now, just render books. */}

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
            <div className="h-24" />
          </>
        )}
      </section>
    </div>
  );
};

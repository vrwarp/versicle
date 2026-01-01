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
import type { BookMetadata } from '../../types/db';

/**
 * The main library view component.
 * Displays the user's collection of books in a responsive grid or list and allows importing new books.
 * Handles fetching books from the store.
 *
 * @returns A React component rendering the library interface.
 */
export const LibraryView: React.FC = () => {
  // OPTIMIZATION: Use useShallow to prevent re-renders when importProgress/uploadProgress changes
  const {
    books,
    fetchBooks,
    isLoading,
    error,
    addBook,
    restoreBook,
    isImporting,
    viewMode,
    setViewMode,
    sortOrder,
    setSortOrder
  } = useLibraryStore(useShallow(state => ({
    books: state.books,
    fetchBooks: state.fetchBooks,
    isLoading: state.isLoading,
    error: state.error,
    addBook: state.addBook,
    restoreBook: state.restoreBook,
    isImporting: state.isImporting,
    viewMode: state.viewMode,
    setViewMode: state.setViewMode,
    sortOrder: state.sortOrder,
    setSortOrder: state.setSortOrder
  })));

  const { setGlobalSettingsOpen } = useUIStore();
  const showToast = useToastStore(state => state.showToast);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null); // Specific input for restoration

  const [dragActive, setDragActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Coordinating State for Modals
  const [activeModal, setActiveModal] = useState<{
    type: 'delete' | 'offload' | 'restore';
    book: BookMetadata;
  } | null>(null);

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

  const handleRestoreFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // Only proceed if we have a target book from activeModal (state set by onRestore)
    // Note: Since clicking the input is synchronous after state set, we might need to rely on activeModal
    // actually, triggering the click happens in onRestore, so state should be set.
    // However, activeModal might be null if we don't treat 'restore' as a modal but just an action.
    // Let's rely on activeModal being set to 'restore'.

    if (activeModal?.type === 'restore' && e.target.files && e.target.files[0]) {
        try {
            await restoreBook(activeModal.book.id, e.target.files[0]);
            showToast(`Restored "${activeModal.book.title}"`, 'success');
            setActiveModal(null); // Clear state on success
        } catch (error) {
            console.error("Restore failed", error);
            showToast("Failed to restore book", "error");
            // Keep activeModal or clear? Maybe keep it so user can try again?
            // Usually clearing is better UX unless we show error in a dialog.
            setActiveModal(null);
        }
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
      // Set the active modal state so the change handler knows which book to restore
      setActiveModal({ type: 'restore', book });

      // Defer the click slightly to ensure state update has processed (though in React 18+ batching is standard)
      // Actually synchronous click is fine, but we need the state to be readable in the change handler.
      // Since handleRestoreFileSelect reads activeModal, and state updates are async...
      // We might need a ref to track the "pending restore book" to avoid closure staleness or async issues.
      // But let's try straight state first. If the file picker opens and pauses JS execution, state might not flush?
      // Actually, file picker doesn't pause JS execution in modern browsers the way alert does, but it blocks interaction.
      // A safer bet is using a Ref for the 'restoreTarget' in addition to (or instead of) state for the logic.
      // But let's stick to the "Coordinator Pattern" with state.
      // To ensure state is ready, we can use a useEffect or just rely on the fact that user interaction (picking file) takes time.
      setTimeout(() => restoreInputRef.current?.click(), 0);
  }, []);

  // OPTIMIZATION: Memoize filtered and sorted books to avoid expensive re-calculation on every render
  const filteredAndSortedBooks = useMemo(() => {
    return books
      .filter(book => {
        const query = searchQuery.toLowerCase();
        return (
          (book.title || '').toLowerCase().includes(query) ||
          (book.author || '').toLowerCase().includes(query)
        );
      })
      .sort((a, b) => {
        switch (sortOrder) {
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
  }, [books, searchQuery, sortOrder]);

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

      {/* Hidden input for restoration */}
      <input
        type="file"
        ref={restoreInputRef}
        onChange={handleRestoreFileSelect}
        accept=".epub"
        className="hidden"
        data-testid="hidden-restore-input"
      />

      {/* Shared Dialogs */}
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
                className="w-[180px] bg-transparent border-none focus:ring-0 p-0 h-auto font-medium text-foreground shadow-none justify-end gap-2"
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

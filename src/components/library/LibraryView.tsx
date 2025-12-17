import React, { useEffect, useState, useRef, useLayoutEffect, useCallback } from 'react';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useToastStore } from '../../store/useToastStore';
import { BookCard } from './BookCard';
import { BookListItem } from './BookListItem';
import { EmptyLibrary } from './EmptyLibrary';
import { Grid } from 'react-window';
import { Upload, Settings, LayoutGrid, List as ListIcon, FilePlus } from 'lucide-react';
import { useUIStore } from '../../store/useUIStore';
import { Button } from '../ui/Button';

// Grid Configuration
const CARD_WIDTH = 200; // Minimal width
const CARD_HEIGHT = 320;
const GAP = 24;
const LIST_ITEM_HEIGHT = 88;

/**
 * Renders a single cell within the virtualized grid of books.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GridCell = ({ columnIndex, rowIndex, style, books, columnCount }: any) => {
    const index = rowIndex * columnCount + columnIndex;
    if (index >= books.length) return <div style={style} />;
    const book = books[index];

    return (
        <div style={{
            ...style,
            width: Number(style.width) - GAP,
            height: Number(style.height) - GAP,
        }}>
           <BookCard book={book} />
        </div>
    );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ListCell = ({ rowIndex, style, books }: any) => {
    const index = rowIndex;
    if (index >= books.length) return <div style={style} />;
    const book = books[index];
    return <BookListItem book={book} style={style} />;
}


/**
 * The main library view component.
 * Displays the user's collection of books in a virtualized grid and allows importing new books.
 * Handles fetching books from the store and responsive layout calculations.
 *
 * @returns A React component rendering the library interface.
 */
export const LibraryView: React.FC = () => {
  const { books, fetchBooks, isLoading, error, addBook, isImporting, viewMode, setViewMode } = useLibraryStore();
  const { setGlobalSettingsOpen } = useUIStore();
  const showToast = useToastStore(state => state.showToast);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

  useLayoutEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      // Debounce logic could be added here if needed, but ResizeObserver is already reasonably efficient.
      // For immediate responsiveness, we'll update directly but wrapped in requestAnimationFrame to align with paint cycles.
      window.requestAnimationFrame(() => {
        if (!Array.isArray(entries) || !entries.length) return;
        const entry = entries[0];

        // Use contentRect for precise content box dimensions
        const { width } = entry.contentRect;

        // Calculate height based on window to keep the original full-screen behavior
        // (Though using contentRect height would be more robust if the parent container is constrained)
        const top = entry.target.getBoundingClientRect().top;
        const height = window.innerHeight - top - 20;

        setDimensions(prev => {
            if (prev.width === width && prev.height === height) return prev;
            return { width, height };
        });
      });
    });

    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
    };
  }, []);

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

  const columnCount = Math.floor((dimensions.width + GAP) / (CARD_WIDTH + GAP)) || 1;
  const rowCount = Math.ceil(books.length / columnCount);
  const gridColumnWidth = Math.floor(dimensions.width / columnCount);

  // Memoize itemData (cellProps) to prevent unnecessary re-renders of the grid cells.
  // This version of react-window uses cellProps which are spread into the component props.
  const itemData = React.useMemo(() => ({ books, columnCount }), [books, columnCount]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const GridAny = Grid as any;

  return (
    <div
      data-testid="library-view"
      className="container mx-auto px-4 py-8 max-w-7xl h-screen flex flex-col bg-background text-foreground relative"
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

      <header className="mb-8 flex-none flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">My Library</h1>
          <p className="text-muted-foreground">Manage and read your EPUB collection</p>
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
              <span className="font-medium">Import Book</span>
            </Button>
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
        <section className="flex-1 min-h-0" ref={containerRef}>
          {books.length === 0 ? (
             <EmptyLibrary onImport={triggerFileUpload} />
          ) : (
             <GridAny
                columnCount={viewMode === 'list' ? 1 : columnCount}
                columnWidth={viewMode === 'list' ? dimensions.width : gridColumnWidth}
                height={dimensions.height || 500}
                rowCount={viewMode === 'list' ? books.length : rowCount}
                rowHeight={viewMode === 'list' ? LIST_ITEM_HEIGHT : CARD_HEIGHT + GAP}
                width={dimensions.width}
                cellComponent={viewMode === 'list' ? ListCell : GridCell}
                cellProps={itemData}
             />
          )}
        </section>
      )}
    </div>
  );
};

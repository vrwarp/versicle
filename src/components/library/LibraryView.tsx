import React, { useEffect, useState, useRef, useLayoutEffect } from 'react';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useToastStore } from '../../store/useToastStore';
import { BookCard } from './BookCard';
import { BookListItem } from './BookListItem';
import { EmptyLibrary } from './EmptyLibrary';
import { Grid } from 'react-window';
import { Upload, Settings, LayoutGrid, List as ListIcon } from 'lucide-react';
import { useUIStore } from '../../store/useUIStore';

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

  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

  useLayoutEffect(() => {
    function updateSize() {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: window.innerHeight - containerRef.current.getBoundingClientRect().top - 20 // Approx remaining height
        });
      }
    }
    window.addEventListener('resize', updateSize);
    updateSize();
    return () => window.removeEventListener('resize', updateSize);
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

  const triggerFileUpload = () => {
    fileInputRef.current?.click();
  };

  const columnCount = Math.floor((dimensions.width + GAP) / (CARD_WIDTH + GAP)) || 1;
  const rowCount = Math.ceil(books.length / columnCount);
  // Re-calculating proper FixedSizeGrid usage with gaps:
  // Usually we make the cell size include the gap, and then render a smaller inner div.
  // Let's rely on flexible card width in BookCard if possible?
  // Or simply:
  const gridColumnWidth = Math.floor(dimensions.width / columnCount);

  // Memoize cellProps to prevent unnecessary re-renders of the grid
  const cellProps = React.useMemo(() => ({ books, columnCount }), [books, columnCount]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const GridAny = Grid as any;

  return (
    <div data-testid="library-view" className="container mx-auto px-4 py-8 max-w-7xl h-screen flex flex-col bg-background text-foreground">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        accept=".epub"
        className="hidden"
        data-testid="hidden-file-input"
      />

      <header className="mb-8 flex-none flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-primary mb-2">My Library</h1>
          <p className="text-muted-foreground">Manage and read your EPUB collection</p>
        </div>
        <div className="flex gap-2">
            <button
                onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                className="flex items-center justify-center p-2 rounded-md bg-secondary text-secondary-foreground hover:opacity-90 transition-colors shadow-sm"
                aria-label={viewMode === 'grid' ? "Switch to list view" : "Switch to grid view"}
                data-testid="view-toggle-button"
            >
                {viewMode === 'grid' ? <ListIcon className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setGlobalSettingsOpen(true)}
              className="flex items-center justify-center p-2 rounded-md bg-secondary text-secondary-foreground hover:opacity-90 transition-colors shadow-sm"
              aria-label="Settings"
              data-testid="header-settings-button"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={triggerFileUpload}
              disabled={isImporting}
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50"
              aria-label="Import book"
              data-testid="header-add-button"
            >
              {isImporting ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
              ) : (
                <Upload className="w-4 h-4" />
              )}
              <span className="font-medium">Import Book</span>
            </button>
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
                cellProps={cellProps}
             />
          )}
        </section>
      )}
    </div>
  );
};

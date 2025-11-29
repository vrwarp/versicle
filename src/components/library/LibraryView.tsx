import React, { useEffect, useState, useRef, useLayoutEffect } from 'react';
import { useLibraryStore } from '../../store/useLibraryStore';
import { BookCard } from './BookCard';
import { FileUploader } from './FileUploader';
import { Grid } from 'react-window';
import { BookOpen } from 'lucide-react';
import { Toast, type ToastType } from '../ui/Toast';

// Grid Configuration
const CARD_WIDTH = 200; // Minimal width
const CARD_HEIGHT = 320;
const GAP = 24;

/**
 * Renders a single cell within the virtualized grid of books.
 *
 * @param props - Properties passed by `react-window` grid.
 * @param props.columnIndex - The column index of the cell.
 * @param props.rowIndex - The row index of the cell.
 * @param props.style - The style object containing positioning for the cell.
 * @param props.books - The array of books to display.
 * @param props.columnCount - The total number of columns in the grid.
 * @returns A BookCard component wrapped in a positioned div, or null if the index is out of bounds.
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

/**
 * The main library view component.
 * Displays the user's collection of books in a virtualized grid and allows importing new books.
 * Handles fetching books from the store and responsive layout calculations.
 *
 * @returns A React component rendering the library interface.
 */
export const LibraryView: React.FC = () => {
  const { books, fetchBooks, isLoading, error } = useLibraryStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [toast, setToast] = useState<{ message: string; type: ToastType; visible: boolean }>({ message: '', type: 'info', visible: false });

  // Use previous count to detect new additions
  const prevBookCount = useRef(0);

  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

  useEffect(() => {
      if (books.length > prevBookCount.current && prevBookCount.current !== 0) {
          // New book added
          setToast({ message: 'Book imported successfully', type: 'success', visible: true });
      }
      prevBookCount.current = books.length;
  }, [books]);

  useEffect(() => {
      if (error) {
          setToast({ message: error, type: 'error', visible: true });
      }
  }, [error]);

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

  const columnCount = Math.floor((dimensions.width + GAP) / (CARD_WIDTH + GAP)) || 1;
  const rowCount = Math.ceil(books.length / columnCount);
  const gridColumnWidth = Math.floor(dimensions.width / columnCount);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const GridAny = Grid as any;

  // Loading Skeletons
  const renderSkeletons = () => {
      return (
          <div className="grid gap-6 animate-pulse" style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}>
              {Array.from({ length: columnCount * 2 }).map((_, i) => (
                  <div key={i} className="flex flex-col h-[320px]">
                      <div className="w-full aspect-[2/3] bg-muted rounded-md mb-2"></div>
                      <div className="h-4 bg-muted rounded w-3/4 mb-1"></div>
                      <div className="h-3 bg-muted rounded w-1/2"></div>
                  </div>
              ))}
          </div>
      );
  };

  return (
    <div data-testid="library-container" className="container mx-auto px-4 py-8 max-w-7xl h-screen flex flex-col bg-background text-foreground">
      <header className="mb-8 flex-none">
        <h1 className="text-3xl font-bold text-primary mb-2">My Library</h1>
        <p className="text-secondary">Manage and read your EPUB collection</p>
      </header>

      <section className="mb-12 flex-none">
        <FileUploader />
      </section>

      <section className="flex-1 min-h-0 relative" ref={containerRef}>
        {isLoading && books.length === 0 ? (
             renderSkeletons()
        ) : books.length === 0 ? (
           <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-muted p-8 border-2 border-dashed border-border rounded-lg bg-surface/50">
              <BookOpen className="w-16 h-16 mb-4 text-muted/50" />
              <h2 className="text-xl font-semibold mb-2 text-foreground">No books yet</h2>
              <p className="max-w-md">Import an EPUB file above to get started with your reading journey.</p>
           </div>
        ) : (
           <GridAny
              columnCount={columnCount}
              columnWidth={gridColumnWidth}
              height={dimensions.height || 500}
              rowCount={rowCount}
              rowHeight={CARD_HEIGHT + GAP}
              width={dimensions.width}
              cellComponent={GridCell}
              cellProps={{ books, columnCount }}
           />
        )}
      </section>

      <Toast
          message={toast.message}
          type={toast.type}
          isVisible={toast.visible}
          onClose={() => setToast(p => ({ ...p, visible: false }))}
      />
    </div>
  );
};

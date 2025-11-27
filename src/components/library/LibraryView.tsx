import React, { useEffect, useState, useRef, useLayoutEffect } from 'react';
import { useLibraryStore } from '../../store/useLibraryStore';
import { BookCard } from './BookCard';
import { FileUploader } from './FileUploader';
import { FixedSizeGrid as Grid } from 'react-window';

export const LibraryView: React.FC = () => {
  const { books, fetchBooks, isLoading, error } = useLibraryStore();
  const containerRef = useRef<HTMLDivElement>(null);
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

  // Grid Configuration
  const CARD_WIDTH = 200; // Minimal width
  const CARD_HEIGHT = 320;
  const GAP = 24;

  const columnCount = Math.floor((dimensions.width + GAP) / (CARD_WIDTH + GAP)) || 1;
  const rowCount = Math.ceil(books.length / columnCount);
  const columnWidth = (dimensions.width - (GAP * (columnCount - 1))) / columnCount;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Cell = ({ columnIndex, rowIndex, style }: any) => {
      const index = rowIndex * columnCount + columnIndex;
      const book = books[index];

      if (!book) return null;

      return (
          <div style={{
              ...style,
              left: Number(style.left) + (columnIndex * GAP), // Adjust for gap handled manually if needed, but FixedSizeGrid doesn't support gap natively easily without some math or extra wrappers.
              // Actually FixedSizeGrid assumes contiguous items.
              // Better to use a wrapper div inside.
              width: Number(style.width) - GAP,
              height: Number(style.height) - GAP
          }}>
              <BookCard book={book} />
          </div>
      );
  };

  // Re-calculating proper FixedSizeGrid usage with gaps:
  // Usually we make the cell size include the gap, and then render a smaller inner div.
  const cellWidth = columnWidth + GAP; // This might be wrong logic for exact widths.
  // Let's rely on flexible card width in BookCard if possible?
  // Or simply:
  const gridColumnWidth = Math.floor(dimensions.width / columnCount);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const GridCell = ({ columnIndex, rowIndex, style }: any) => {
      const index = rowIndex * columnCount + columnIndex;
      if (index >= books.length) return null;
      const book = books[index];

      return (
          <div style={{
              ...style,
              width: Number(style.width) - GAP,
              height: Number(style.height) - GAP,
              // We simulate gap by padding effectively (reducing width/height)
              // But 'style.left' positions rigidly.
              // Better: Cell size = Card + Gap.
              // Inner div size = Card.
          }}>
             <BookCard book={book} />
          </div>
      );
  }


  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl h-screen flex flex-col">
      <header className="mb-8 flex-none">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">My Library</h1>
        <p className="text-gray-600">Manage and read your EPUB collection</p>
      </header>

      <section className="mb-12 flex-none">
        <FileUploader />
        {error && (
            <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-lg">
                {error}
            </div>
        )}
      </section>

      {isLoading ? (
        <div className="flex justify-center items-center py-12 flex-1">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        </div>
      ) : (
        <section className="flex-1 min-h-0" ref={containerRef}>
          {books.length === 0 ? (
             <div className="text-center py-12 text-gray-500">
                No books yet. Import one to get started!
             </div>
          ) : (
             <Grid
                columnCount={columnCount}
                columnWidth={gridColumnWidth}
                height={dimensions.height || 500}
                rowCount={rowCount}
                rowHeight={CARD_HEIGHT + GAP}
                width={dimensions.width}
             >
                 {GridCell}
             </Grid>
          )}
        </section>
      )}
    </div>
  );
};

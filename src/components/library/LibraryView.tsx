import React, { useEffect, useState, useRef, useLayoutEffect } from 'react';
import { useLibraryStore } from '../../store/useLibraryStore';
import { BookCard } from './BookCard';
import * as ReactWindow from 'react-window';
import { DragDropOverlay } from './DragDropOverlay';
import { Plus, Library } from 'lucide-react';
import { Button } from '../ui/button';
import { processEpub } from '../../lib/ingestion';

// Handle CJS/ESM interop for react-window
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Grid = (ReactWindow as any).FixedSizeGrid || (ReactWindow as any).default?.FixedSizeGrid || (ReactWindow as any).default;

export const LibraryView: React.FC = () => {
  const { books, fetchBooks, isLoading, error } = useLibraryStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

  useLayoutEffect(() => {
    function updateSize() {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: window.innerHeight - containerRef.current.getBoundingClientRect().top - 20
        });
      }
    }
    window.addEventListener('resize', updateSize);
    updateSize();
    return () => window.removeEventListener('resize', updateSize);
  }, [books.length]);

  // Drag and Drop Handling
  useEffect(() => {
      const handleDragOver = (e: DragEvent) => {
          e.preventDefault();
          setIsDragging(true);
      };

      const handleDragLeave = (e: DragEvent) => {
          e.preventDefault();
          if (e.relatedTarget === null) {
              setIsDragging(false);
          }
      };

      const handleDrop = async (e: DragEvent) => {
          e.preventDefault();
          setIsDragging(false);

          if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
              const file = e.dataTransfer.files[0];
              if (file.type === "application/epub+zip" || file.name.endsWith(".epub")) {
                 try {
                     const bookId = await processEpub(file);
                     fetchBooks();
                     console.log("Imported book", bookId);
                 } catch (err) {
                     console.error("Failed to import book", err);
                 }
              }
          }
      };

      window.addEventListener('dragover', handleDragOver);
      window.addEventListener('dragleave', handleDragLeave);
      window.addEventListener('drop', handleDrop);

      return () => {
          window.removeEventListener('dragover', handleDragOver);
          window.removeEventListener('dragleave', handleDragLeave);
          window.removeEventListener('drop', handleDrop);
      };
  }, [fetchBooks]);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
          await processEpub(file);
          fetchBooks();
      } catch (err) {
          console.error("Failed to import book", err);
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
  };


  // Grid Configuration
  const CARD_WIDTH = 200;
  const CARD_HEIGHT = 340;
  const GAP = 24;

  const columnCount = Math.max(1, Math.floor((dimensions.width + GAP) / (CARD_WIDTH + GAP)));
  const rowCount = Math.ceil(books.length / columnCount);

  const totalGapWidth = GAP * (columnCount - 1);
  const availableWidth = dimensions.width - totalGapWidth;
  const itemWidth = Math.floor(availableWidth / columnCount);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const GridCell = ({ columnIndex, rowIndex, style }: any) => {
      const index = rowIndex * columnCount + columnIndex;
      if (index >= books.length) return null;
      const book = books[index];

      return (
          <div style={{
              ...style,
              left: Number(style.left),
              top: Number(style.top),
              width: Number(style.width) - GAP,
              height: Number(style.height) - GAP,
          }}>
             <BookCard book={book} />
          </div>
      );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-950">
      <DragDropOverlay isDragging={isDragging} />

      {/* Top App Bar */}
      <header className="flex-none h-16 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg text-white">
                <Library className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">Versicle</h1>
        </div>
        <div>
            <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".epub,application/epub+zip"
                onChange={handleFileSelect}
            />
            <Button onClick={() => fileInputRef.current?.click()}>
                <Plus className="w-4 h-4 mr-2" />
                Add Book
            </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden p-6 relative">
        {error && (
            <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg border border-red-200">
                {error}
            </div>
        )}

        {isLoading ? (
            <div className="flex justify-center items-center h-full">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
        ) : books.length === 0 ? (
             <div className="h-full flex flex-col items-center justify-center text-center">
                <div className="bg-gray-100 dark:bg-gray-800 p-6 rounded-full mb-4">
                    <Library className="w-12 h-12 text-gray-400" />
                </div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Your library is empty</h2>
                <p className="text-gray-500 max-w-sm mb-6">
                    Drag and drop an EPUB file here, or click the button above to add your first book.
                </p>
                <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                    Select File
                </Button>
             </div>
        ) : (
            <div className="h-full" ref={containerRef}>
                {Grid ? (
                    <Grid
                        columnCount={columnCount}
                        columnWidth={itemWidth + GAP}
                        height={dimensions.height}
                        rowCount={rowCount}
                        rowHeight={CARD_HEIGHT + GAP}
                        width={dimensions.width}
                    >
                        {GridCell}
                    </Grid>
                ) : (
                    <div className="p-4 text-red-500">Error: Virtualization component not found. Please refresh.</div>
                )}
            </div>
        )}
      </main>
    </div>
  );
};

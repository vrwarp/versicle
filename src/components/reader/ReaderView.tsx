import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ePub, { type Book, type Rendition } from 'epubjs';
import { useReaderStore } from '../../store/useReaderStore';
import { getDB } from '../../db/db';

export const ReaderView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const viewerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);

  const {
    isLoading,
    currentCfi,
    actions: {
      setCurrentBookId,
      setIsLoading,
      setCurrentCfi,
      setToc,
      reset,
    },
  } = useReaderStore();

  const [error, setError] = useState<string | null>(null);

  // Initialize Book and Rendition
  useEffect(() => {
    if (!id) return;

    const loadBook = async () => {
      setIsLoading(true);
      setError(null);
      setCurrentBookId(id);

      try {
        const db = await getDB();
        const fileData = await db.get('files', id);
        const bookData = await db.get('books', id);

        if (!fileData || !bookData) {
          throw new Error('Book not found in library');
        }

        // Initialize ePub
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const book = (ePub as any)(fileData);
        bookRef.current = book;

        await book.ready;

        // Load TOC
        const navigation = await book.loaded.navigation;
        setToc(navigation.toc);

        // Render
        if (viewerRef.current) {
          const rendition = book.renderTo(viewerRef.current, {
            width: '100%',
            height: '100%',
            flow: 'paginated',
            manager: 'default',
          });
          renditionRef.current = rendition;

          // Display initial location
          const startCfi = bookData.currentCfi || undefined;
          await rendition.display(startCfi);

          // Listen for relocation
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          rendition.on('relocated', (location: any) => {
            setCurrentCfi(location.start.cfi);
            // Save to DB (debounce effectively handled by minimal updates or manual save?)
            // For now, we save on unmount or periodical, but direct save is safer for crash resilience
            db.put('books', { ...bookData, currentCfi: location.start.cfi, lastRead: Date.now() });

            // Update Chapter Title if available
            // Note: getting chapter title from location usually requires matching href with TOC
          });
        }

        setIsLoading(false);
      } catch (err) {
        console.error('Error loading book:', err);
        setError('Failed to load book. It might be corrupted or missing.');
        setIsLoading(false);
      }
    };

    loadBook();

    return () => {
      if (bookRef.current) {
        bookRef.current.destroy();
        bookRef.current = null;
        renditionRef.current = null;
      }
      reset();
    };
  }, [id, setCurrentBookId, setIsLoading, setCurrentCfi, setToc, reset]);

  // Navigation Handlers
  const prevPage = useCallback(() => {
    renditionRef.current?.prev();
  }, []);

  const nextPage = useCallback(() => {
    renditionRef.current?.next();
  }, []);

  // Keyboard support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prevPage();
      if (e.key === 'ArrowRight') nextPage();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [prevPage, nextPage]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-50">
        <p className="text-red-600 mb-4">{error}</p>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Back to Library
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Top Bar */}
      <header className="h-14 border-b border-gray-200 flex items-center px-4 justify-between bg-white z-10 shadow-sm">
        <button
          onClick={() => navigate('/')}
          className="text-gray-600 hover:text-gray-900 flex items-center gap-2"
        >
          <span>←</span> Library
        </button>
        <div className="text-sm font-medium text-gray-700 truncate max-w-[50%]">
             {/* We could display book title here if we stored it in store or fetched it */}
        </div>
        <div className="w-20" /> {/* Spacer */}
      </header>

      {/* Reader Area */}
      <div className="flex-1 relative overflow-hidden bg-gray-50">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center z-20 bg-white/80">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        )}
        <div ref={viewerRef} className="h-full w-full" />

        {/* Navigation Zones (Invisible or Hover) */}
        <button
          className="absolute left-0 top-0 bottom-0 w-12 hover:bg-black/5 flex items-center justify-center group focus:outline-none"
          onClick={prevPage}
          aria-label="Previous Page"
        >
           <span className="opacity-0 group-hover:opacity-100 text-gray-400 text-4xl">‹</span>
        </button>
        <button
          className="absolute right-0 top-0 bottom-0 w-12 hover:bg-black/5 flex items-center justify-center group focus:outline-none"
          onClick={nextPage}
          aria-label="Next Page"
        >
          <span className="opacity-0 group-hover:opacity-100 text-gray-400 text-4xl">›</span>
        </button>
      </div>

      {/* Bottom Bar */}
      <footer className="h-10 border-t border-gray-200 flex items-center justify-center text-xs text-gray-500 bg-white">
         {/* Progress info can go here */}
         {currentCfi && <span>Location: {currentCfi}</span>}
      </footer>
    </div>
  );
};

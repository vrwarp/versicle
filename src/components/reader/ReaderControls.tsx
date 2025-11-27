import React, { useEffect } from 'react';
import { useReaderContext } from './ReaderContext';
import { useReaderStore } from '../../store/useReaderStore';
import { getDB } from '../../db/db';

export const ReaderControls: React.FC = () => {
  const { rendition } = useReaderContext();
  const { currentCfi, currentBookId } = useReaderStore();

  // Handle saving position to DB
  useEffect(() => {
    if (!currentBookId || !currentCfi) return;

    const savePosition = async () => {
      try {
        const db = await getDB();
        const tx = db.transaction('books', 'readwrite');
        const store = tx.objectStore('books');
        const book = await store.get(currentBookId);
        if (book) {
          book.currentCfi = currentCfi;
          book.lastRead = Date.now();
          await store.put(book);
        }
        await tx.done;
      } catch (err) {
        console.error('Failed to save reading position:', err);
      }
    };

    // Debounce this save if needed, but for now simple effect is okay as 'relocated' event is somewhat infrequent (on page turn).
    // If scrolling, it might fire often.
    // The prompt says "Debounce saving location.start.cfi".
    // I will use a timeout.

    const timeoutId = setTimeout(savePosition, 1000);
    return () => clearTimeout(timeoutId);

  }, [currentCfi, currentBookId]);


  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!rendition) return;

      if (e.key === 'ArrowLeft') {
        rendition.prev();
      } else if (e.key === 'ArrowRight') {
        rendition.next();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [rendition]);

  if (!rendition) return null;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => rendition.prev()}
        className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50"
        aria-label="Previous Page"
      >
        Prev
      </button>
      <button
        onClick={() => rendition.next()}
        className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50"
        aria-label="Next Page"
      >
        Next
      </button>
    </div>
  );
};

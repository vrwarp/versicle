import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import ePub from 'epubjs';
import { useReaderStore } from '../../store/useReaderStore';
import { getDB } from '../../db/db';
import { ReaderProvider, useReaderContext } from './ReaderContext';
import { ReaderControls } from './ReaderControls';
import { TOC } from './TOC';

const ReaderInner: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const viewerRef = useRef<HTMLDivElement>(null);
  const {
    setCurrentBookId,
    setIsLoading,
    setToc,
    setCurrentCfi
  } = useReaderStore();
  const { setBook, setRendition, rendition, book } = useReaderContext();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      setCurrentBookId(id);
    }
    return () => setCurrentBookId(null);
  }, [id, setCurrentBookId]);

  useEffect(() => {
    let mounted = true;
    if (!id || !viewerRef.current) return;

    const loadBook = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const db = await getDB();
        const file = await db.get('files', id);

        if (!file) {
          throw new Error('Book not found');
        }

        if (!mounted) return;

        const newBook = ePub(file);
        setBook(newBook);

        const newRendition = newBook.renderTo(viewerRef.current!, {
          width: '100%',
          height: '100%',
        });
        setRendition(newRendition);

        await newBook.ready;
        if (!mounted) return;

        const navigation = await newBook.loaded.navigation;
        setToc(navigation.toc);

        // Display initial content
        const savedBook = await db.get('books', id);
        if (savedBook && savedBook.currentCfi) {
             await newRendition.display(savedBook.currentCfi);
             setCurrentCfi(savedBook.currentCfi);
        } else {
             await newRendition.display();
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        newRendition.on('relocated', (location: any) => {
             setCurrentCfi(location.start.cfi);
        });

      } catch (err) {
        console.error("Error loading book:", err);
        setError("Failed to load book");
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    loadBook();

    return () => {
      mounted = false;
    };
  }, [id, setIsLoading, setToc, setBook, setRendition, setCurrentCfi]);

  // Separate effect for cleanup
  useEffect(() => {
      return () => {
          if (book) {
              book.destroy();
          }
      };
  }, [book]);

  // Resize handler
  useEffect(() => {
      const handleResize = () => {
          if (rendition) {
              rendition.resize();
          }
      };
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
  }, [rendition]);


  return (
    <div className="h-screen flex flex-col">
      <div className="p-2 border-b flex justify-between items-center bg-white shadow-sm z-10">
        <Link to="/" className="text-blue-500 hover:underline">Back to Library</Link>
        <span className="font-semibold">Reader</span>
        <div className="flex items-center gap-2">
            <ReaderControls />
            <TOC />
        </div>
      </div>
      <div className="flex-1 bg-gray-100 relative overflow-hidden">
        {error && <div className="absolute inset-0 flex items-center justify-center text-red-500">{error}</div>}
        <div ref={viewerRef} className="h-full w-full" />
      </div>
    </div>
  );
};

export const Reader: React.FC = () => {
    return (
        <ReaderProvider>
            <ReaderInner />
        </ReaderProvider>
    );
};

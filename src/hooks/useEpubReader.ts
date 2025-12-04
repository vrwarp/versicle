import { useState, useEffect, type MutableRefObject } from 'react';
import ePub, { type Book, type Rendition } from 'epubjs';

export interface UseEpubReaderOptions {
  viewerRef: MutableRefObject<HTMLDivElement | null>;
  source: string | ArrayBuffer | null;
  viewMode: 'paginated' | 'scrolled';
}

export interface UseEpubReaderResult {
  book: Book | null;
  rendition: Rendition | null;
  isReady: boolean;
  error: Error | null;
}

/**
 * Custom hook to manage epub.js lifecycle.
 * Handles book creation, rendering, and cleanup.
 */
export const useEpubReader = ({
  viewerRef,
  source,
  viewMode,
}: UseEpubReaderOptions): UseEpubReaderResult => {
  const [book, setBook] = useState<Book | null>(null);
  const [rendition, setRendition] = useState<Rendition | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!source || !viewerRef.current) return;

    let activeBook: Book | null = null;
    let activeRendition: Rendition | null = null;
    let mounted = true;

    const init = async () => {
      try {
        setIsReady(false);
        setError(null);
        setBook(null);
        setRendition(null);

        // Initialize Book
        activeBook = ePub(source);

        if (!mounted) {
             activeBook.destroy();
             return;
        }

        setBook(activeBook);

        // Initialize Rendition
        activeRendition = activeBook.renderTo(viewerRef.current!, {
          width: '100%',
          height: '100%',
          flow: viewMode === 'scrolled' ? 'scrolled-doc' : 'paginated',
          manager: 'default',
        });

        // Disable spreads to prevent layout issues
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (activeRendition as any).spread('none');

        setRendition(activeRendition);

        // Wait for book to be ready
        await activeBook.ready;

        if (mounted) {
          setIsReady(true);
        }
      } catch (err) {
        if (mounted) {
          console.error('Error initializing EPUB:', err);
          setError(err instanceof Error ? err : new Error('Unknown error loading book'));
        }
      }
    };

    init();

    return () => {
      mounted = false;
      if (activeBook) {
        activeBook.destroy();
      }
      setBook(null);
      setRendition(null);
      setIsReady(false);
    };
  // We explicitly exclude viewMode to prevent full reload on view mode change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, viewerRef]);

  // Handle View Mode changes dynamically
  useEffect(() => {
    if (rendition) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rendition as any).flow(viewMode === 'scrolled' ? 'scrolled-doc' : 'paginated');
    }
  }, [viewMode, rendition]);

  return { book, rendition, isReady, error };
};

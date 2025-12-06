import { useState, useEffect, useRef } from 'react';
import ePub, { type Book, type Rendition, type Location, type NavigationItem } from 'epubjs';
import { dbService } from '../db/DBService';
import type { BookMetadata } from '../types/db';

export interface EpubReaderOptions {
  viewMode: 'paginated' | 'scrolled';
  currentTheme: string;
  customTheme: { bg: string; fg: string };
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  shouldForceFont: boolean;
  onLocationChange?: (location: Location, percentage: number, chapterTitle: string) => void;
  onTocLoaded?: (toc: NavigationItem[]) => void;
  onSelection?: (cfiRange: string, range: Range, contents: any) => void;
  onBookLoaded?: (book: Book) => void;
  onClick?: () => void;
  onError?: (error: string) => void;
}

export interface EpubReaderResult {
  book: Book | null;
  rendition: Rendition | null;
  isReady: boolean;
  isLoading: boolean;
  metadata: BookMetadata | null;
  toc: NavigationItem[];
  error: string | null;
}

export function useEpubReader(
  bookId: string | undefined,
  viewerRef: React.RefObject<HTMLElement>,
  options: EpubReaderOptions
): EpubReaderResult {
  const [book, setBook] = useState<Book | null>(null);
  const [rendition, setRendition] = useState<Rendition | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [metadata, setMetadata] = useState<BookMetadata | null>(null);
  const [toc, setToc] = useState<NavigationItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const prevSize = useRef({ width: 0, height: 0 });
  const resizeRaf = useRef<number | null>(null);
  const applyStylesRef = useRef<() => void>(() => {});

  // Use a ref for options to access latest values in event listeners without re-binding
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // Load Book
  useEffect(() => {
    if (!bookId || !viewerRef.current) return;

    const loadBook = async () => {
      setIsLoading(true);
      setError(null);
      setIsReady(false);

      try {
        const { file: fileData, metadata: meta } = await dbService.getBook(bookId);

        if (!fileData) {
          throw new Error('Book file not found');
        }

        setMetadata(meta || null);

        // Cleanup previous instance
        if (bookRef.current) {
          bookRef.current.destroy();
        }

        const newBook = ePub(fileData as ArrayBuffer);
        bookRef.current = newBook;
        setBook(newBook);

        if (optionsRef.current.onBookLoaded) {
          optionsRef.current.onBookLoaded(newBook);
        }

        const newRendition = newBook.renderTo(viewerRef.current!, {
          width: '100%',
          height: '100%',
          flow: optionsRef.current.viewMode === 'scrolled' ? 'scrolled-doc' : 'paginated',
          manager: 'default',
        });
        renditionRef.current = newRendition;
        setRendition(newRendition);

        // Disable spreads
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (newRendition as any).spread('none');

        // Load navigation
        const nav = await newBook.loaded.navigation;
        setToc(nav.toc);
        if (optionsRef.current.onTocLoaded) {
            optionsRef.current.onTocLoaded(nav.toc);
        }

        // Register themes
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const themes = newRendition.themes as any;
        themes.register('light', `
          body { background: #ffffff !important; color: #000000 !important; }
          p, div, span, h1, h2, h3, h4, h5, h6 { color: inherit !important; background: transparent !important; }
          a { color: #0000ee !important; }
        `);
        themes.register('dark', `
          body { background: #1a1a1a !important; color: #f5f5f5 !important; }
          p, div, span, h1, h2, h3, h4, h5, h6 { color: inherit !important; background: transparent !important; }
          a { color: #6ab0f3 !important; }
        `);
        themes.register('sepia', `
          body { background: #f4ecd8 !important; color: #5b4636 !important; }
          p, div, span, h1, h2, h3, h4, h5, h6 { color: inherit !important; background: transparent !important; }
          a { color: #0000ee !important; }
        `);

        // Display at saved location or start
        const startLocation = meta?.currentCfi || undefined;
        await newRendition.display(startLocation);

        setIsReady(true);

        // Location Generation
        const updateProgress = () => {
             // Force a location check to sync progress
             // eslint-disable-next-line @typescript-eslint/no-explicit-any
             const currentLocation = (newRendition as any).location;
             if (currentLocation && currentLocation.start) {
                 const cfi = currentLocation.start.cfi;
                 let percentage = 0;
                 try {
                     percentage = newBook.locations.percentageFromCfi(cfi);
                 } catch {
                     // ignore
                 }

                 // eslint-disable-next-line @typescript-eslint/no-explicit-any
                 const item = newBook.spine.get(currentLocation.start.href) as any;
                 const title = item ? (item.label || 'Chapter') : 'Unknown';

                 if (optionsRef.current.onLocationChange) {
                     optionsRef.current.onLocationChange(currentLocation, percentage, title);
                 }
             }
        };

        const savedLocations = await dbService.getLocations(bookId);
        if (savedLocations) {
            newBook.locations.load(savedLocations.locations);
            updateProgress();
        } else {
            // Generate in background
            newBook.locations.generate(1000).then(async () => {
                 const locationStr = newBook.locations.save();
                 await dbService.saveLocations(bookId, locationStr);
                 updateProgress();
            });
        }
        await newBook.ready;

        // Event Listeners
        newRendition.on('relocated', (location: Location) => {
             const cfi = location.start.cfi;
             let percentage = 0;
             try {
                 percentage = newBook.locations.percentageFromCfi(cfi);
             } catch {
                 // ignore
             }

             // eslint-disable-next-line @typescript-eslint/no-explicit-any
             const item = newBook.spine.get(location.start.href) as any;
             const title = item ? (item.label || 'Chapter') : 'Unknown';

             if (optionsRef.current.onLocationChange) {
                 optionsRef.current.onLocationChange(location, percentage, title);
             }
        });

        newRendition.on('selected', (cfiRange: string, contents: any) => {
             // eslint-disable-next-line @typescript-eslint/no-explicit-any
             const range = (newRendition as any).getRange(cfiRange);
             if (optionsRef.current.onSelection && range) {
                 optionsRef.current.onSelection(cfiRange, range, contents);
             }
        });

        newRendition.on('click', () => {
            if (optionsRef.current.onClick) optionsRef.current.onClick();
        });

        // Manual selection listener fallback
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (newRendition.hooks.content as any).register((contents: any) => {
            const doc = contents.document;
            doc.addEventListener('mouseup', () => {
                const selection = contents.window.getSelection();
                if (!selection || selection.isCollapsed) return;

                setTimeout(() => {
                    const range = selection.getRangeAt(0);
                    if (!range) return;
                    const cfi = contents.cfiFromRange(range);
                    if (cfi && optionsRef.current.onSelection) {
                        optionsRef.current.onSelection(cfi, range, contents);
                    }
                }, 10);
            });

            // Re-apply forced styles on content load
            const styleId = 'force-theme-style';
            if (!doc.getElementById(styleId)) {
                const style = doc.createElement('style');
                style.id = styleId;
                doc.head.appendChild(style);
                applyStylesRef.current();
            }
        });

      } catch (err) {
        console.error('Error loading book:', err);
        const errorMessage = err instanceof Error ? err.message : 'Unknown error loading book';
        setError(errorMessage);
        if (optionsRef.current.onError) optionsRef.current.onError(errorMessage);
      } finally {
        setIsLoading(false);
      }
    };

    loadBook();

    return () => {
      if (bookRef.current) {
        bookRef.current.destroy();
        bookRef.current = null;
      }
      renditionRef.current = null;
      if (resizeRaf.current) {
          cancelAnimationFrame(resizeRaf.current);
      }
    };
  }, [bookId]); // Dependencies: only bookId

  // Handle Resize with RequestAnimationFrame
  useEffect(() => {
    if (!viewerRef.current) return;

    const observer = new ResizeObserver((entries) => {
        if (!renditionRef.current || !entries.length) return;

        const { width, height } = entries[0].contentRect;

        // Use > 10px threshold as per hardening plan to prevent thrashing on mobile
        if (Math.abs(prevSize.current.width - width) > 10 || Math.abs(prevSize.current.height - height) > 10) {
            prevSize.current = { width, height };

            if (resizeRaf.current) cancelAnimationFrame(resizeRaf.current);

            resizeRaf.current = requestAnimationFrame(() => {
                 // eslint-disable-next-line @typescript-eslint/no-explicit-any
                 (renditionRef.current as any)?.resize(width, height);
            });
        }
    });

    observer.observe(viewerRef.current);

    return () => {
        observer.disconnect();
        if (resizeRaf.current) cancelAnimationFrame(resizeRaf.current);
    };
  }, [viewerRef.current]);

  // Update Settings/Themes
  useEffect(() => {
      if (!renditionRef.current || !isReady) return;

      const r = renditionRef.current;

      // Update Themes
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const themes = r.themes as any;

      themes.register('custom', `
        body { background: ${options.customTheme.bg} !important; color: ${options.customTheme.fg} !important; }
        p, div, span, h1, h2, h3, h4, h5, h6 { color: inherit !important; background: transparent !important; }
        a { color: ${options.customTheme.fg} !important; }
      `);

      // TTS Highlight Theme
      themes.default({
          '.tts-highlight': {
              'fill': 'yellow',
              'background-color': 'rgba(255, 255, 0, 0.3)',
              'fill-opacity': '0.3',
              'mix-blend-mode': 'multiply'
          },
          '.highlight-yellow': { 'fill': 'yellow', 'background-color': 'rgba(255, 255, 0, 0.3)', 'fill-opacity': '0.3', 'mix-blend-mode': 'multiply' },
          '.highlight-green': { 'fill': 'green', 'background-color': 'rgba(0, 255, 0, 0.3)', 'fill-opacity': '0.3', 'mix-blend-mode': 'multiply' },
          '.highlight-blue': { 'fill': 'blue', 'background-color': 'rgba(0, 0, 255, 0.3)', 'fill-opacity': '0.3', 'mix-blend-mode': 'multiply' },
          '.highlight-red': { 'fill': 'red', 'background-color': 'rgba(255, 0, 0, 0.3)', 'fill-opacity': '0.3', 'mix-blend-mode': 'multiply' }
      });

      themes.select(options.currentTheme);
      themes.fontSize(`${options.fontSize}%`);
      themes.font(options.fontFamily);
      themes.default({
        p: { 'line-height': `${options.lineHeight} !important` },
        body: { 'line-height': `${options.lineHeight} !important` }
      });

      // Flow
      // Capture current location before changing flow to prevent reset
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const currentLoc = (r as any).location?.start?.cfi;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (r as any).flow(options.viewMode === 'scrolled' ? 'scrolled-doc' : 'paginated');

      // Restore location if available
      if (currentLoc) {
          r.display(currentLoc);
      }

      // Forced Styles
      const applyStyles = () => {
          if (!options.shouldForceFont) return;

          let bg, fg, linkColor;
          switch (options.currentTheme) {
            case 'dark':
              bg = '#1a1a1a'; fg = '#f5f5f5'; linkColor = '#6ab0f3';
              break;
            case 'sepia':
              bg = '#f4ecd8'; fg = '#5b4636'; linkColor = '#0000ee';
              break;
            case 'custom':
              bg = options.customTheme.bg; fg = options.customTheme.fg; linkColor = options.customTheme.fg;
              break;
            default: // light
              bg = '#ffffff'; fg = '#000000'; linkColor = '#0000ee';
          }

          const css = `
            html body *, html body p, html body div, html body span, html body h1, html body h2, html body h3, html body h4, html body h5, html body h6 {
              font-family: ${options.fontFamily} !important;
              line-height: ${options.lineHeight} !important;
              color: ${fg} !important;
              background-color: transparent !important;
              text-align: left !important;
            }
            html, body {
              background: ${bg} !important;
            }
            a, a * {
              color: ${linkColor} !important;
              text-decoration: none !important;
            }
            a:hover, a:hover * {
              text-decoration: underline !important;
            }
          `;

          // Apply to all active contents
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (r as any).getContents().forEach((content: any) => {
            const doc = content.document;
            let style = doc.getElementById('force-theme-style');
            if (!style) {
              style = doc.createElement('style');
              style.id = 'force-theme-style';
              doc.head.appendChild(style);
            }
            style.textContent = css;
          });
      };

      applyStylesRef.current = applyStyles;
      applyStyles();

  }, [
      isReady,
      options.currentTheme,
      options.customTheme,
      options.fontSize,
      options.fontFamily,
      options.lineHeight,
      options.viewMode,
      options.shouldForceFont
  ]);

  return { book, rendition, isReady, isLoading, metadata, toc, error };
}

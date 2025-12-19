import { useState, useEffect, useRef } from 'react';
import ePub, { type Book, type Rendition, type Location, type NavigationItem } from 'epubjs';
import { dbService } from '../db/DBService';
import type { BookMetadata } from '../types/db';
import { parseCfiRange } from '../lib/cfi-utils';

/**
 * Configuration options for the EpubReader hook.
 */
export interface EpubReaderOptions {
  /** 'paginated' or 'scrolled' view mode. */
  viewMode: 'paginated' | 'scrolled';
  /** Current theme identifier. */
  currentTheme: string;
  /** Custom theme colors. */
  customTheme: { bg: string; fg: string };
  /** Font family to use. */
  fontFamily: string;
  /** Font size percentage. */
  fontSize: number;
  /** Line height. */
  lineHeight: number;
  /** Whether to force font settings and override book styles. */
  shouldForceFont: boolean;
  /** Callback when location changes. */
  onLocationChange?: (location: Location, percentage: number, chapterTitle: string, sectionId: string) => void;
  /** Callback when TOC is loaded. */
  onTocLoaded?: (toc: NavigationItem[]) => void;
  /** Callback when text is selected. */
  onSelection?: (cfiRange: string, range: Range, contents: unknown) => void;
  /** Callback when book instance is ready. */
  onBookLoaded?: (book: Book) => void;
  /** Callback when the reader view is clicked. */
  onClick?: (event: MouseEvent) => void;
  /** Callback when an error occurs. */
  onError?: (error: string) => void;
}

/**
 * Result returned by the EpubReader hook.
 */
export interface EpubReaderResult {
  /** The epub.js Book instance. */
  book: Book | null;
  /** The epub.js Rendition instance. */
  rendition: Rendition | null;
  /** Whether the book is fully ready for interaction. */
  isReady: boolean;
  /** Whether the book is currently loading. */
  isLoading: boolean;
  /** Metadata of the loaded book. */
  metadata: BookMetadata | null;
  /** Table of Contents. */
  toc: NavigationItem[];
  /** Error message if loading failed. */
  error: string | null;
}

/**
 * Custom hook to manage the lifecycle of an epub.js reader instance.
 * Handles loading, rendering, resizing, theming, and interaction events.
 *
 * @param bookId - The ID of the book to load.
 * @param viewerRef - Ref to the container element.
 * @param options - Configuration options.
 * @returns The reader state and instances.
 */
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
          // Do NOT set allowScriptedContent: true here as it breaks hooks.content
          // We patch sandbox attribute manually via MutationObserver instead.
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
        themes.register('light', {
          'body': { 'background': '#ffffff !important', 'color': '#000000 !important' },
          'p, div, span, h1, h2, h3, h4, h5, h6': { 'color': 'inherit !important', 'background': 'transparent !important' },
          'a': { 'color': '#0000ee !important' }
        });
        themes.register('dark', {
          'body': { 'background': '#1a1a1a !important', 'color': '#f5f5f5 !important' },
          'p, div, span, h1, h2, h3, h4, h5, h6': { 'color': 'inherit !important', 'background': 'transparent !important' },
          'a': { 'color': '#6ab0f3 !important' }
        });
        themes.register('sepia', {
          'body': { 'background': '#f4ecd8 !important', 'color': '#5b4636 !important' },
          'p, div, span, h1, h2, h3, h4, h5, h6': { 'color': 'inherit !important', 'background': 'transparent !important' },
          'a': { 'color': '#0000ee !important' }
        });

        // Display at saved location or start
        let startLocation = meta?.currentCfi || undefined;

        // Try to infer better start location from reading history (end of last session)
        try {
            const history = await dbService.getReadingHistory(bookId);
            if (history && history.length > 0) {
                const lastRange = history[history.length - 1];
                const parsed = parseCfiRange(lastRange);
                if (parsed && parsed.fullEnd) {
                    startLocation = parsed.fullEnd;
                }
            }
        } catch (e) {
            console.error("Failed to load history for start location", e);
        }

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
                 const sectionId = item ? item.href : '';

                 if (optionsRef.current.onLocationChange) {
                     optionsRef.current.onLocationChange(currentLocation, percentage, title, sectionId);
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
             const sectionId = item ? item.href : '';

             if (optionsRef.current.onLocationChange) {
                 optionsRef.current.onLocationChange(location, percentage, title, sectionId);
             }
        });

        newRendition.on('selected', (cfiRange: string, contents: unknown) => {
             // eslint-disable-next-line @typescript-eslint/no-explicit-any
             const range = (newRendition as any).getRange(cfiRange);
             if (optionsRef.current.onSelection && range) {
                 optionsRef.current.onSelection(cfiRange, range, contents);
             }
        });

        newRendition.on('click', (event: MouseEvent) => {
            if (optionsRef.current.onClick) optionsRef.current.onClick(event);
        });

        // Manual selection listener fallback
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const attachListeners = (contents: any) => {
            const doc = contents.document;
            if (!doc) return;

            // Prevent duplicate listeners
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((contents as any)._listenersAttached) return;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (contents as any)._listenersAttached = true;

            // Prevent default context menu (especially for Android)
            doc.addEventListener('contextmenu', (e: Event) => {
                e.preventDefault();
                e.stopPropagation();
            });

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

            // Inject empty div for scrolling space
            const spacerId = 'reader-bottom-spacer';
            if (!doc.getElementById(spacerId)) {
                const spacer = doc.createElement('div');
                spacer.id = spacerId;
                spacer.style.height = '150px';
                spacer.style.width = '100%';
                spacer.style.clear = 'both'; // Ensure it sits below floated content
                doc.body.appendChild(spacer);
            }
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (newRendition.hooks.content as any).register(attachListeners);

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

      themes.register('custom', {
        'body': { 'background': `${options.customTheme.bg} !important`, 'color': `${options.customTheme.fg} !important` },
        'p, div, span, h1, h2, h3, h4, h5, h6': { 'color': 'inherit !important', 'background': 'transparent !important' },
        'a': { 'color': `${options.customTheme.fg} !important` }
      });

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
          const isDarkOrSepia = options.currentTheme === 'dark' || options.currentTheme === 'sepia' || options.currentTheme === 'custom';
          if (!options.shouldForceFont && !isDarkOrSepia) return;

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

          const fontCss = options.shouldForceFont ? `
              font-family: ${options.fontFamily} !important;
              line-height: ${options.lineHeight} !important;
              text-align: left !important;
          ` : '';

          const css = `
            html body *, html body p, html body div, html body span, html body h1, html body h2, html body h3, html body h4, html body h5, html body h6 {
              ${fontCss}
              color: ${fg} !important;
              background-color: transparent !important;
              -webkit-touch-callout: none !important;
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

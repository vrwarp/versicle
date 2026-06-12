/**
 * useEpubReader — the reader LIFECYCLE hook (Phase 6 §5,
 * prep/phase6-reader-engine.md PR-4 "useEpubReader dissolves").
 *
 * After the split this file owns exactly one concern: the cancellable
 * load/teardown pipeline (fetch blob → epub.js book → rendition → engine
 * port → display → events) plus the React state mirroring it. The former
 * inline subsystems live in their named modules:
 *
 *  - presentation        → @domains/reader/engine/epubTheming
 *  - selection pipeline  → @domains/reader/engine/selectionBridge
 *  - locations cache     → @domains/reader/engine/locations (D7 guards)
 *  - Chinese content     → @domains/chinese (Phase 6 §7, PR-10): the
 *                          dependency is INVERTED — this hook has zero
 *                          chinese imports; the app controller registers
 *                          `registerChineseReading(engine, …)` against the
 *                          engine's contentRendered/contentDestroyed seam.
 *
 * Characterization suites (Sanitization/Security/Selection/Theming) pin
 * through this surface; the pinyin suite moved with the feature to
 * src/domains/chinese/engine/.
 */
import { useState, useEffect, useRef } from 'react';
import type { Book, Rendition } from 'epubjs';
import { bookContent } from '@data/repos/bookContent';
import type { BookMetadata, NavigationItem } from '~types/db';
import { EpubJsEngine, createEpubJsBook } from '@domains/reader/engine/EpubJsEngine';
import type { ReaderEngine, EngineLocation } from '@domains/reader/engine/ReaderEngine';
import { setActiveReaderEngine } from '@domains/reader/engine/activeEngineRegistry';
import {
  registerSanitizeHook,
  observeAndPatchSandbox,
  type EpubJsBookLike,
} from '@domains/reader/engine/epubSecurity';
import {
  applyReaderTheme,
  injectContentExtras,
  registerBaseThemes,
  type ReaderThemeSpec,
} from '@domains/reader/engine/epubTheming';
import { attachSelectionBridge } from '@domains/reader/engine/selectionBridge';
import { initializeLocations } from '@domains/reader/engine/locations';
import { internals } from '@domains/reader/engine/epubjsInternals';
import { runCancellable, CancellationError } from '@lib/cancellable-task-runner';
import { createLogger } from '@lib/logger';
import { usePreferencesStore } from '@store/usePreferencesStore';
import { findTocItem } from '@lib/reader/titleResolver';

const logger = createLogger('useEpubReader');

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
  /** Callback when location changes (ReaderEngine port location shape). */
  onLocationChange?: (location: EngineLocation, percentage: number, chapterTitle: string, sectionId: string) => void;
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
  /** Optional: Initial CFI location to start reading at. Overrides metadata.currentCfi. */
  initialLocation?: string;
  /** Optional: Book metadata. If not provided, some features like initial location inference may be limited. */
  metadata?: BookMetadata | null;
}

/**
 * Result returned by the EpubReader hook.
 */
export interface EpubReaderResult {
  /**
   * The ReaderEngine port (contract C7) — the ONLY surface components and
   * panels consume. Non-null once the book is rendered.
   */
  engine: ReaderEngine | null;
  /**
   * The raw epub.js Book — TYPE-ONLY epubjs surface retained for the two
   * named P7-deadlined exceptions (lib/search indexing via SearchPanel).
   * No component may touch Book/Rendition APIs beyond passing this through.
   */
  book: Book | null;
  /** Whether the book is fully ready for interaction. */
  isReady: boolean;
  /** Whether the book's location registry (CFI <-> Percentage) is fully generated */
  areLocationsReady: boolean;
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
  const [engine, setEngine] = useState<ReaderEngine | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [areLocationsReady, setAreLocationsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [metadata, setMetadata] = useState<BookMetadata | null>(null);
  const [toc, setToc] = useState<NavigationItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const engineRef = useRef<EpubJsEngine | null>(null);
  const prevSize = useRef({ width: 0, height: 0 });
  const resizeRaf = useRef<number | null>(null);
  const applyStylesRef = useRef<() => void>(() => { });
  const { forceTraditionalChinese, showPinyin, pinyinSize } = usePreferencesStore();
  /** Disconnects the shared sandbox-patching observer (epubSecurity). */
  const sandboxObserverRef = useRef<(() => void) | null>(null);

  // Use a ref for options to access latest values in event listeners without re-binding
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // Sync metadata from options if it changes reactively
  useEffect(() => {
    if (options.metadata) {
      setMetadata(options.metadata);
    }
  }, [options.metadata]);


  // Load Book
  useEffect(() => {
    if (!bookId || !viewerRef.current) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loadBookGenerator = function* (currentBookId: string): Generator<Promise<any> | any, void, any> {
      setIsLoading(true);
      setError(null);
      setIsReady(false);
      setAreLocationsReady(false);

      try {
        // Phase 2: Get file blob from static resources only. Metadata comes from props (Store).
        const fileData = yield bookContent.getBookFile(currentBookId);

        if (!fileData) {
          throw new Error('Book file not found');
        }

        // Use metadata passed in options if available
        const meta = optionsRef.current.metadata || null;
        setMetadata(meta);

        // Cleanup previous instance
        if (bookRef.current) {
          bookRef.current.destroy();
        }

        const newBook = createEpubJsBook(fileData as ArrayBuffer);

        // SECURITY: sanitize-at-serialize via the shared epubSecurity module
        // (one implementation for the live reader AND offscreen ingestion).
        // The live reader is the one path allowed to honor the E2E
        // sanitization kill-switch — and only in DEV/VITE_E2E builds.
        registerSanitizeHook(newBook as unknown as EpubJsBookLike, { allowTestBypass: true });

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

        // Cleanup old observer if any
        if (sandboxObserverRef.current) {
          sandboxObserverRef.current();
        }

        // Manually ensure allow-scripts is present to fix event handling in
        // strict environments (like WebKit) — shared epubSecurity observer
        // (patches existing iframes immediately and any epubjs re-creates).
        if (viewerRef.current) {
          sandboxObserverRef.current = observeAndPatchSandbox(viewerRef.current);
        }

        // The ReaderEngine port over the live book/rendition pair (Phase 6
        // §2 "under-the-shell adapter"): constructed before display so its
        // content hook (contentRendered + titled iframe) sees the first
        // section. The deferred locationsReady resolves below when the
        // registry is loaded or generated.
        let resolveLocationsReady!: () => void;
        const locationsReadyPromise = new Promise<void>((resolve) => {
          resolveLocationsReady = resolve;
        });
        const newEngine = new EpubJsEngine({
          book: newBook,
          rendition: newRendition,
          container: viewerRef.current!,
          locationsReady: locationsReadyPromise,
        });
        engineRef.current = newEngine;
        setEngine(newEngine);
        setActiveReaderEngine(newEngine);

        // Disable spreads
        newRendition.spread('none');

        // Load navigation
        const nav = yield newBook.loaded.navigation;
        const tocItems = nav.toc;
        setToc(tocItems);
        if (optionsRef.current.onTocLoaded) {
          optionsRef.current.onTocLoaded(tocItems);
        }

        // Register built-in themes (epubTheming module)
        registerBaseThemes(newRendition);

        // Display at saved location or start
        const startLocation = optionsRef.current.initialLocation || meta?.currentCfi || undefined;

        // Legacy reading history fallback removed as Phase 2 relies on Stores (passed via options)

        yield newRendition.display(startLocation);

        setIsReady(true);

        // Location reporting through the engine port: identical title
        // resolution to the legacy relocated handler (spine label →
        // 'Chapter'/'Unknown' → findTocItem improvement), the percentage
        // comes pre-computed on the EngineLocation (D4: ONE
        // resolveLocationInfo path).
        const reportLocation = (location: EngineLocation) => {
          const section = newEngine.resolveSection(location.sectionHref);
          let title = section ? (section.label || 'Chapter') : 'Unknown';
          const sectionId = section ? section.href : '';

          // Improve title resolution
          if (section) {
            const useSynthetic = optionsRef.current.metadata?.useSyntheticToc;
            const tocSource = (useSynthetic && optionsRef.current.metadata?.syntheticToc)
              ? optionsRef.current.metadata.syntheticToc
              : tocItems;
            const betterItem = findTocItem(tocSource, section.href);
            if (betterItem) {
              title = betterItem.label;
            }
          }

          if (optionsRef.current.onLocationChange) {
            optionsRef.current.onLocationChange(location, location.percentage, title, sectionId);
          }
        };

        // Location registry (engine/locations module): load the cached
        // registry or generate in the background, then sync progress once.
        yield initializeLocations({
          book: newBook,
          bookId: currentBookId,
          isCurrent: () => bookRef.current === newBook,
          onReady: () => {
            resolveLocationsReady();
            setAreLocationsReady(true);
            // Force a location check to sync progress
            const currentLocation = newEngine.currentLocation();
            if (currentLocation) {
              reportLocation(currentLocation);
            }
          },
        });

        yield newBook.ready;

        // Event Listeners. Selection is deliberately NOT consumed from the
        // engine's 'selected' event: the selectionBridge mouseup pipeline
        // below is the SINGLE selection source (D3 — epub.js 'selected' and
        // the mouseup pipeline both reported one gesture in the legacy
        // hook; the WebKit-reliable pipeline won, pinned by
        // useEpubReader_Selection.test.tsx).
        newEngine.subscribe((event) => {
          if (event.type === 'relocated') {
            reportLocation(event.location);
          } else if (event.type === 'click') {
            if (optionsRef.current.onClick) optionsRef.current.onClick(event.event);
          }
        });

        // Per-content-load pipeline (extras → selection, legacy order; the
        // Chinese pass rides the ENGINE's contentRendered seam now and is
        // registered by the app controller — Phase 6 §7, PR-10).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const injectExtras = (contents: any) => {
          injectContentExtras(contents, {
            viewMode: optionsRef.current.viewMode,
            reapplyForcedStyles: () => applyStylesRef.current(),
          });
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const attachListeners = (contents: any) => {
          attachSelectionBridge(contents, (cfi, range, c) => {
            if (optionsRef.current.onSelection) {
              optionsRef.current.onSelection(cfi, range, c);
            }
          });
        };

        newRendition.hooks.content.register(injectExtras);
        newRendition.hooks.content.register(attachListeners);

        // Manually trigger extras for initially loaded content
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((newRendition as any).getContents() as any[]).forEach((contents: any) => {
          injectExtras(contents);
        });

      } catch (err) {
        if (err instanceof CancellationError) {
          return;
        }
        logger.error('Error loading book:', err);
        const errorMessage = err instanceof Error ? err.message : 'Unknown error loading book';
        setError(errorMessage);
        if (optionsRef.current.onError) optionsRef.current.onError(errorMessage);
      } finally {
        setIsLoading(false);
      }
    };

    const { cancel } = runCancellable(
      loadBookGenerator(bookId),
      () => {
        if (engineRef.current) {
          engineRef.current.destroy();
          engineRef.current = null;
          setActiveReaderEngine(null);
        }
        if (bookRef.current) {
          bookRef.current.destroy();
          bookRef.current = null;
        }
        renditionRef.current = null;
        if (sandboxObserverRef.current) {
          sandboxObserverRef.current();
          sandboxObserverRef.current = null;
        }
      }
    );

    return () => {
      cancel();
      if (resizeRaf.current) {
        cancelAnimationFrame(resizeRaf.current);
      }
    };
  }, [bookId, viewerRef]);

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
          const r = renditionRef.current;
          // Resize only once the view manager exists (post-start guard).
          if (r && internals(r).manager) {
            r.resize(width, height);
          }
        });
      }
    });

    observer.observe(viewerRef.current);

    return () => {
      observer.disconnect();
      if (resizeRaf.current) cancelAnimationFrame(resizeRaf.current);
    };
  }, [viewerRef]);

  // Presentation (epubTheming module): apply the whole spec on any input
  // change. D5: flow()/display() runs only when the view mode actually
  // changed — a colors/typography tweak no longer reflows (the legacy
  // always-reflow fired a spurious relocation event per settings change,
  // which fed the session recorder).
  const prevViewModeRef = useRef<'paginated' | 'scrolled' | null>(null);
  useEffect(() => {
    prevViewModeRef.current = null; // new book: rendition rendered with the current mode
  }, [bookId]);
  useEffect(() => {
    if (!renditionRef.current || !isReady) return;

    const r = renditionRef.current;
    const spec: ReaderThemeSpec = {
      viewMode: options.viewMode,
      currentTheme: options.currentTheme,
      customTheme: options.customTheme,
      fontFamily: options.fontFamily,
      fontSize: options.fontSize,
      lineHeight: options.lineHeight,
      shouldForceFont: options.shouldForceFont,
      showPinyin,
      baseFontSize: metadata?.baseFontSize,
      baseLineHeight: metadata?.baseLineHeight,
    };

    // First run after a (re)load is never a mode change: renderTo received
    // the current mode, so a flow() call would be a same-mode no-op plus a
    // redundant display(currentLoc) round-trip.
    const flowModeChanged =
      prevViewModeRef.current !== null && prevViewModeRef.current !== options.viewMode;
    prevViewModeRef.current = options.viewMode;

    applyStylesRef.current = applyReaderTheme(r, spec, { flowModeChanged });
  }, [
    isReady,
    options.currentTheme,
    options.customTheme,
    options.fontSize,
    options.fontFamily,
    options.lineHeight,
    options.viewMode,
    options.shouldForceFont,
    metadata?.baseFontSize,
    metadata?.baseLineHeight,
    forceTraditionalChinese,
    showPinyin,
    pinyinSize
  ]);

  return { engine, book, isReady, areLocationsReady, isLoading, metadata, toc, error };
}

import { useState, useEffect, useRef } from 'react';
import ePub, { type Book, type Rendition, type Location, type NavigationItem } from 'epubjs';
import { dbService } from '../db/DBService';
import type { BookMetadata } from '../types/db';
import { sanitizeContent } from '../lib/sanitizer';
import { runCancellable, CancellationError } from '../lib/cancellable-task-runner';
import { createLogger } from '../lib/logger';
import { usePreferencesStore } from '../store/usePreferencesStore';
import { useBookStore } from '../store/useBookStore';
import {
  toTraditional,
  getPinyin,
  ensureOpenCC,
  ensurePinyin
} from '../lib/chinese/ChineseTextProcessor';

const logger = createLogger('useEpubReader');

/**
 * Patches an iframe's sandbox attribute to ensure allow-scripts and allow-same-origin are present.
 * This is required for event handling in strict environments like WebKit.
 */
const patchIframeSandbox = (iframe: HTMLIFrameElement) => {
  const sandbox = iframe.getAttribute('sandbox') || '';
  const tokens = new Set(sandbox.split(/\s+/).filter(Boolean));

  tokens.add('allow-scripts');
  tokens.add('allow-same-origin');

  const newValue = Array.from(tokens).join(' ');
  // Only set if different to avoid infinite MutationObserver loops
  if (newValue !== sandbox) {
    iframe.setAttribute('sandbox', newValue);
  }
};

const STATIC_READER_STYLES = `
`;

/**
 * Normalizes absolute CSS lengths to rem units based on a 16pt (1rem) standard.
 * Conversion table assumes:
 * 16pt = 1rem
 * 1px = 0.046875rem
 * 1in = 4.5rem
 * 1cm = 1.771875rem
 * 1mm = 0.1771875rem
 * 1pc = 0.75rem
 * 1Q = 0.044296875rem
 */
const normalizeAbsoluteToRem = (cssValue: string): string | null => {
  if (!cssValue) return null;

  const namedMap: Record<string, string> = {
    'xx-small': '0.5625rem',
    'x-small': '0.625rem',
    'small': '0.8125rem',
    'medium': '1rem',
    'large': '1.125rem',
    'x-large': '1.5rem',
    'xx-large': '2rem'
  };

  const lowerValue = cssValue.toLowerCase().trim();
  if (namedMap[lowerValue]) return namedMap[lowerValue];

  const unitMap: Record<string, number> = {
    'pt': 1 / 16,
    'px': 0.046875,
    'in': 4.5,
    'cm': 1.771875,
    'mm': 0.1771875,
    'pc': 0.75,
    'q': 0.044296875
  };

  const match = lowerValue.match(/^([\d.]+)(pt|px|in|cm|mm|pc|q)$/);
  if (match) {
    const val = parseFloat(match[1]);
    const unit = match[2];
    if (!isNaN(val) && unitMap[unit]) {
      const remVal = val * unitMap[unit];
      // Round to 5 decimal places to avoid floating point anomalies like 1.5000000000000002rem
      return `${Math.round(remVal * 100000) / 100000}rem`;
    }
  }

  return null;
};

/**
 * Programmatically injects CSS into a document in a CSP-compliant way.
 * Prefers Adopted Stylesheets if supported, falling back to rule insertion.
 */
const safeInjectStyles = (doc: Document, css: string, styleId: string) => {
  try {
    // 1. Try Adopted Stylesheets (Modern & CSP-friendly)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((doc as any).adoptedStyleSheets && typeof (window as any).CSSStyleSheet !== 'undefined') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sheets = [...((doc as any).adoptedStyleSheets || [])];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const existingIndex = sheets.findIndex((s: any) => s._versicle_id === styleId);

        if (existingIndex !== -1) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (sheets[existingIndex] as any).replaceSync(css);
          return;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const newSheet = new (window as any).CSSStyleSheet();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (newSheet as any)._versicle_id = styleId;
        newSheet.replaceSync(css);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (doc as any).adoptedStyleSheets = [...sheets, newSheet];
        return;
      } catch {
        // Fallback to legacy injection
      }
    }

    // 2. Programmatic Rule Insertion (Bypasses most inline-style CSP filters)
    let style = doc.getElementById(styleId) as HTMLStyleElement;
    if (!style) {
      style = doc.createElement('style');
      style.id = styleId;
      doc.head.appendChild(style);
    }

    const sheet = style.sheet;
    if (sheet) {
      // Clear rules
      while (sheet.cssRules.length > 0) {
        sheet.deleteRule(0);
      }
      // Split into individual blocks
      const rules = css.split(/}\s*/).filter(r => r.trim()).map(r => r + '}');
      for (const rule of rules) {
        try {
          sheet.insertRule(rule, sheet.cssRules.length);
        } catch {
          // Skip rules that fail parsing in this browser
        }
      }
      return;
    }

    // 3. Desperate Fallback (Likely to fail CSP but works in legacy non-CSP envs)
    style.textContent = css;
  } catch {
    // Execution failure
  }
};

/**
 * Recursive helper to resolve a section title from the Table of Contents (ToC).
 *
 * It attempts to find a matching ToC item for the given HREF using the following precedence:
 * 1. Exact match of the full HREF.
 * 2. Match of the file path (ignoring fragments/anchors).
 *
 * This fallback is necessary because spine items often only contain the file path (e.g., "chapter1.html"),
 * while ToC items may point to specific anchors (e.g., "chapter1.html#section1").
 * Matching by file path allows us to associate a generic file with its parent ToC entry (e.g., the Chapter title).
 */
const findTitleInToc = (toc: NavigationItem[], href: string): string | null => {
  for (const item of toc) {
    if (item.href === href) return item.label;

    // Check if item.href matches the file path of the spine item
    const itemPath = item.href.split('#')[0];
    const spinePath = href.split('#')[0];
    if (itemPath === spinePath) return item.label;

    if (item.subitems && item.subitems.length > 0) {
      const found = findTitleInToc(item.subitems, href);
      if (found) return found;
    }
  }
  return null;
};

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
  /** Callback when pinyin positions are calculated. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onPinyinPositionsUpdate?: (positions: any[]) => void;
  /** Optional: Initial CFI location to start reading at. Overrides metadata.currentCfi. */
  initialLocation?: string;
  /** Optional: Book metadata. If not provided, some features like initial location inference may be limited. */
  metadata?: BookMetadata | null;
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
  const [rendition, setRendition] = useState<Rendition | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [areLocationsReady, setAreLocationsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [metadata, setMetadata] = useState<BookMetadata | null>(null);
  const [toc, setToc] = useState<NavigationItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const prevSize = useRef({ width: 0, height: 0 });
  const resizeRaf = useRef<number | null>(null);
  const applyStylesRef = useRef<() => void>(() => { });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const processChineseContentRef = useRef<(contents: any) => Promise<void>>(async () => { });
  const { forceTraditionalChinese, showPinyin, pinyinSize } = usePreferencesStore();
  const sandboxObserverRef = useRef<MutationObserver | null>(null);

  // Use a ref for options to access latest values in event listeners without re-binding
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

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
        const fileData = yield dbService.getBookFile(currentBookId);

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

        const newBook = ePub(fileData as ArrayBuffer);

        // SECURITY: Register a serialization hook to sanitize HTML content before it's rendered.
        // This prevents XSS attacks from malicious scripts in EPUB files.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((newBook.spine as any).hooks?.serialize) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (newBook.spine as any).hooks.serialize.register((html: string) => {
            // Optimization: Allow disabling sanitization in E2E tests for performance
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((window as any).__VERSICLE_SANITIZATION_DISABLED__) {
              return html;
            }
            return sanitizeContent(html);
          });
        }

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
          sandboxObserverRef.current.disconnect();
        }

        // Manually ensure allow-scripts is present to fix event handling in strict environments (like WebKit)
        // We patch sandbox attribute manually via MutationObserver to catch dynamically created iframes
        // and react to any attribute resets by epubjs.
        const observer = new MutationObserver((mutations) => {
          mutations.forEach(mutation => {
            if (mutation.type === 'childList') {
              mutation.addedNodes.forEach(node => {
                const element = node as HTMLElement;
                if (element.tagName === 'IFRAME') {
                  patchIframeSandbox(element as HTMLIFrameElement);
                } else if (element.querySelectorAll) {
                  const iframes = element.querySelectorAll('iframe');
                  iframes.forEach(patchIframeSandbox);
                }
              });
            } else if (mutation.type === 'attributes' && mutation.target.nodeName === 'IFRAME') {
              patchIframeSandbox(mutation.target as HTMLIFrameElement);
            }
          });
        });

        if (viewerRef.current) {
          observer.observe(viewerRef.current, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['sandbox']
          });
          sandboxObserverRef.current = observer;
        }

        // Also patch immediately all existing iframes
        viewerRef.current?.querySelectorAll('iframe').forEach(patchIframeSandbox);
        setRendition(newRendition);

        // Disable spreads
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (newRendition as any).spread('none');

        // Load navigation
        const nav = yield newBook.loaded.navigation;
        const tocItems = nav.toc;
        setToc(tocItems);
        if (optionsRef.current.onTocLoaded) {
          optionsRef.current.onTocLoaded(tocItems);
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
        const startLocation = optionsRef.current.initialLocation || meta?.currentCfi || undefined;

        // Legacy reading history fallback removed as Phase 2 relies on Stores (passed via options)

        yield newRendition.display(startLocation);

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
            let title = item ? (item.label || 'Chapter') : 'Unknown';
            const sectionId = item ? item.href : '';

            // Improve title resolution
            if (item) {
              const betterTitle = findTitleInToc(tocItems, item.href);
              if (betterTitle) {
                title = betterTitle;
              }
            }

            if (optionsRef.current.onLocationChange) {
              optionsRef.current.onLocationChange(currentLocation, percentage, title, sectionId);
            }
          }
        };

        const savedLocations = yield dbService.getLocations(currentBookId);
        if (savedLocations) {
          newBook.locations.load(savedLocations.locations);
          setAreLocationsReady(true);
          updateProgress();
        } else {
          // Generate in background
          newBook.locations.generate(1000).then(async () => {
            const locationStr = newBook.locations.save();
            await dbService.saveLocations(currentBookId, locationStr);
            setAreLocationsReady(true);
            updateProgress();
          });
        }
        yield newBook.ready;

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
          let title = item ? (item.label || 'Chapter') : 'Unknown';
          const sectionId = item ? item.href : '';

          // Improve title resolution
          if (item) {
            const betterTitle = findTitleInToc(tocItems, item.href);
            if (betterTitle) {
              title = betterTitle;
            }
          }

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

        // Inject styles and spacer
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const injectExtras = (contents: any) => {
          const doc = contents.document;
          if (!doc) return;

          // Normalize CSS OM to map absolute units to relative REM based on 16pt=1rem baseline
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const processRule = (rule: any) => {
              if (rule && rule.style) {
                if (rule.style.fontSize) {
                  const newFontSize = normalizeAbsoluteToRem(rule.style.fontSize);
                  if (newFontSize) rule.style.fontSize = newFontSize;
                }
                if (rule.style.lineHeight) {
                  const newLineHeight = normalizeAbsoluteToRem(rule.style.lineHeight);
                  if (newLineHeight) rule.style.lineHeight = newLineHeight;
                }
              }
              if (rule && rule.cssRules) {
                for (let i = 0; i < rule.cssRules.length; i++) {
                  processRule(rule.cssRules[i]);
                }
              }
            };

            for (let i = 0; i < doc.styleSheets.length; i++) {
              const sheet = doc.styleSheets[i];
              // Skip dynamic injected themes
              if (sheet.ownerNode?.id === 'force-theme-style' || sheet.ownerNode?.id === 'reader-static-styles') continue;

              try {
                for (let j = 0; j < sheet.cssRules.length; j++) {
                  processRule(sheet.cssRules[j]);
                }
              } catch {
                // Ignore CORS errors on cross-origin stylesheets if they happen
              }
            }
          } catch {
            // General catch
          }

          // Normalize inline styles
          try {
            const styledElements = doc.querySelectorAll('[style]');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            styledElements.forEach((el: any) => {
              if (el.style.fontSize) {
                const newFontSize = normalizeAbsoluteToRem(el.style.fontSize);
                if (newFontSize) el.style.fontSize = newFontSize;
              }
              if (el.style.lineHeight) {
                const newLineHeight = normalizeAbsoluteToRem(el.style.lineHeight);
                if (newLineHeight) el.style.lineHeight = newLineHeight;
              }
            });
          } catch {
            // Ignore query conflicts
          }

          // Re-apply forced styles on content load
          applyStylesRef.current();

          // Inject static styles (e.g. note markers)
          safeInjectStyles(doc, STATIC_READER_STYLES, 'reader-static-styles');

          // Inject empty div for scrolling space
          const spacerId = 'reader-bottom-spacer';
          if (optionsRef.current.viewMode === 'scrolled' && !doc.getElementById(spacerId)) {
            const spacer = doc.createElement('div');
            spacer.id = spacerId;
            spacer.style.height = '150px';
            spacer.style.width = '100%';
            spacer.style.clear = 'both'; // Ensure it sits below floated content
            doc.body.appendChild(spacer);
          }
        };

        // Process Chinese text without corrupting DOM structure
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const processChineseContent = async (contents: any) => {
          const doc = contents.document;
          if (!doc) return;

          const prefs = usePreferencesStore.getState();
          const bookLang = bookId ? useBookStore.getState().books[bookId]?.language || 'en' : 'en';

          if (bookLang !== 'zh') {
            if (optionsRef.current.onPinyinPositionsUpdate) optionsRef.current.onPinyinPositionsUpdate([]);
            return;
          }

          // Pre-load processors to allow synchronous calls in the loop
          if (prefs.forceTraditionalChinese) await ensureOpenCC();
          if (prefs.showPinyin) await ensurePinyin();

          const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
          const textNodes: Text[] = [];
          let node: Text | null;
          while ((node = walker.nextNode() as Text)) {
            if (node.textContent && /[\u4e00-\u9fff]/.test(node.textContent)) {
              textNodes.push(node);
            }
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const pinyinPositions: any[] = [];
          const iframe = contents.window.frameElement as HTMLIFrameElement;
          if (!iframe) return;

          // In scrolled-doc mode, several iframes might be stacked. 
          // We need to account for each iframe's position within the manager's container.
          const iframeOffsetTop = iframe.offsetTop;
          const iframeOffsetLeft = iframe.offsetLeft;

          for (const textNode of textNodes) {
            const parent = textNode.parentElement;
            // Skip ruby/rt elements as they might already have annotations or be part of one
            if (!parent || parent.tagName === 'RT' || parent.tagName === 'RUBY') continue;

            // 1. Cache original text for clean reversion/toggling
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (!(textNode as any)._originalText) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (textNode as any)._originalText = textNode.nodeValue;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const originalText = (textNode as any)._originalText;

            // 2. Handle Traditional Chinese (In-place string mutation)
            if (prefs.forceTraditionalChinese) {
              const translated = toTraditional(originalText);
              if (textNode.nodeValue !== translated) {
                textNode.nodeValue = translated;
              }
            } else {
              if (textNode.nodeValue !== originalText) {
                textNode.nodeValue = originalText;
              }
            }

            // 3. Handle Pinyin (Ephemeral Geometry Collection)
            if (prefs.showPinyin) {
              const currentText = textNode.nodeValue || '';
              const pinyinArray = getPinyin(currentText);

              for (let i = 0; i < currentText.length; i++) {
                const char = currentText[i];
                if (/[\u4e00-\u9fff]/.test(char) && pinyinArray[i]) {
                  try {
                    const range = doc.createRange();
                    range.setStart(textNode, i);
                    range.setEnd(textNode, i + 1);

                    const rect = range.getBoundingClientRect();
                    // Optimization: Skip if rect has no dimensions
                    if (rect.width > 0 && rect.height > 0) {
                      pinyinPositions.push({
                        char,
                        pinyin: pinyinArray[i],
                        // Use document-relative top and left by adding iframe offsets
                        top: rect.top + iframeOffsetTop,
                        left: rect.left + iframeOffsetLeft + (rect.width / 2), // Center of character
                        width: rect.width,
                        height: rect.height
                      });
                    }
                  } catch {
                    // Range errors can happen during rapid updates
                  }
                }
              }
            }
          }

          if (optionsRef.current.onPinyinPositionsUpdate) {
            optionsRef.current.onPinyinPositionsUpdate(pinyinPositions);
          }
        };

        processChineseContentRef.current = processChineseContent;

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
              // Re-check selection existence after delay to handle race conditions
              // where a click event might have cleared it.
              if (selection.rangeCount === 0 || selection.isCollapsed) return;

              let range;
              try {
                range = selection.getRangeAt(0);
              } catch {
                // Handle IndexSizeError if selection was cleared
                return;
              }

              if (!range) return;
              const cfi = contents.cfiFromRange(range);
              if (cfi && optionsRef.current.onSelection) {
                optionsRef.current.onSelection(cfi, range, contents);
              }
            }, 10);
          });
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (newRendition.hooks.content as any).register(injectExtras);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (newRendition.hooks.content as any).register(processChineseContent);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (newRendition.hooks.content as any).register(attachListeners);

        // Manually trigger extras for initially loaded content
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (newRendition as any).getContents().forEach((contents: any) => {
          injectExtras(contents);
          processChineseContent(contents);
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
        if (bookRef.current) {
          bookRef.current.destroy();
          bookRef.current = null;
        }
        renditionRef.current = null;
        if (sandboxObserverRef.current) {
          sandboxObserverRef.current.disconnect();
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const r = renditionRef.current as any;
          if (r && r.manager) {
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

  // Update Settings/Themes

  useEffect(() => {
    if (!renditionRef.current || !isReady) return;

    // Trigger overlay re-injection on all currently loaded views
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (renditionRef.current as any).getContents().forEach((contents: any) => {
      processChineseContentRef.current(contents);
    });
  }, [isReady, forceTraditionalChinese, showPinyin, pinyinSize]);

  useEffect(() => {
    if (!renditionRef.current || !isReady) return;

    const r = renditionRef.current;

    // Update Themes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const themes = r.themes as any;

    themes.register('custom', {
      'body': { 'background': `${options.customTheme?.bg || '#ffffff'} !important`, 'color': `${options.customTheme?.fg || '#000000'} !important` },
      'p, div, span, h1, h2, h3, h4, h5, h6': { 'color': 'inherit !important', 'background': 'transparent !important' },
      'a': { 'color': `${options.customTheme?.fg || '#0000e'} !important` }
    });

    const isDark = options.currentTheme === 'dark';
    const highlightBlendMode = isDark ? 'screen' : 'multiply';
    const highlightOpacity = isDark ? 0.4 : 0.3;

    // TTS Highlight Theme
    themes.default({
      '.tts-highlight': {
        'fill': '#fde047',
        'background-color': isDark ? 'rgba(253, 224, 71, 0.4)' : 'rgba(253, 224, 71, 0.3)',
        'fill-opacity': highlightOpacity,
        'mix-blend-mode': highlightBlendMode
      },
      '.highlight-yellow': { 'fill': '#fde047', 'background-color': isDark ? 'rgba(253, 224, 71, 0.4)' : 'rgba(253, 224, 71, 0.3)', 'fill-opacity': highlightOpacity, 'mix-blend-mode': highlightBlendMode },
      '.highlight-green': { 'fill': '#86efac', 'background-color': isDark ? 'rgba(134, 239, 172, 0.4)' : 'rgba(134, 239, 172, 0.3)', 'fill-opacity': highlightOpacity, 'mix-blend-mode': highlightBlendMode },
      '.highlight-blue': { 'fill': '#93c5fd', 'background-color': isDark ? 'rgba(147, 197, 253, 0.4)' : 'rgba(147, 197, 253, 0.3)', 'fill-opacity': highlightOpacity, 'mix-blend-mode': highlightBlendMode },
      '.highlight-red': { 'fill': '#fca5a5', 'background-color': isDark ? 'rgba(252, 165, 165, 0.4)' : 'rgba(252, 165, 165, 0.3)', 'fill-opacity': highlightOpacity, 'mix-blend-mode': highlightBlendMode }
    });

    themes.select(options.currentTheme);

    // Set the theme font options.
    themes.fontSize(options.fontSize);
    themes.font(options.fontFamily);

    const TARGET_BASE_PX = 16; // The ideal unified size at 100% scale
    const TARGET_RATIO = 1.35; // Standard baseline leading ratio

    // Fallback to TARGET_BASE_PX if metadata is missing, resulting in a 1.0 multiplier
    const bookBasePx = metadata?.baseFontSize || TARGET_BASE_PX;
    // Calculate book's native ratio (resolved px LH / resolved px FS)
    const bookBaseLH = metadata?.baseLineHeight || (bookBasePx * TARGET_RATIO);
    const bookNativeRatio = bookBaseLH / bookBasePx;

    // Normalization factors
    const fsNormalizationFactor = TARGET_BASE_PX / bookBasePx;
    const lhNormalizationFactor = TARGET_RATIO / bookNativeRatio;
    const finalFSScalePct = Math.round(fsNormalizationFactor * 100);

    // Apply line height normalization
    const userLH = options.lineHeight;
    const normalizedLH = userLH * lhNormalizationFactor;
    // Respect Pinyin minimum leading even after normalization
    const finalLH = showPinyin ? Math.max(normalizedLH, 1.8) : normalizedLH;

    themes.default({
      p: {
        'line-height': `${finalLH} !important`,
      },
      body: {
        'line-height': `${finalLH} !important`
      }
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

      // The scaling part MUST always apply for normalization to work
      let css = `
            html {
              font-size: ${finalFSScalePct}% !important;
            }
          `;

      // Only add the "Force Font" and "Theme Colors" mapping if requested or in non-light themes
      if (options.shouldForceFont || isDarkOrSepia) {
        let bg, fg, linkColor;
        switch (options.currentTheme) {
          case 'dark':
            bg = '#1a1a1a'; fg = '#f5f5f5'; linkColor = '#6ab0f3';
            break;
          case 'sepia':
            bg = '#f4ecd8'; fg = '#5b4636'; linkColor = '#0000ee';
            break;
          case 'custom':
            bg = options.customTheme?.bg || '#ffffff'; fg = options.customTheme?.fg || '#000000'; linkColor = options.customTheme?.fg || '#000000';
            break;
          default: // light + forced font
            bg = '#ffffff'; fg = '#000000'; linkColor = '#0000ee';
        }

        const fontCss = options.shouldForceFont ? `
                font-family: ${options.fontFamily} !important;
                line-height: ${options.lineHeight} !important;
                text-align: left !important;
            ` : '';

        css += `
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
      }

      // Apply to all active contents
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (r as any).getContents().forEach((content: any) => {
        const doc = content.document;
        if (doc) {
          safeInjectStyles(doc, css, 'force-theme-style');
        }
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
    options.shouldForceFont,
    metadata?.baseFontSize,
    metadata?.baseLineHeight,
    forceTraditionalChinese,
    showPinyin,
    pinyinSize
  ]);

  return { book, rendition, isReady, areLocationsReady, isLoading, metadata, toc, error };
}

/**
 * EpubJsEngine — the epub.js implementation of the ReaderEngine port
 * (contract C7) and the SOLE runtime importer of `epubjs` in the tree
 * (boundary rule 8, lint-enforced; the kernel's epubcfi shim and the two
 * named P7-deadlined ingestion exceptions are the only carve-outs).
 *
 * Strategy (prep doc §Risks "under-the-shell adapter"): the engine wraps the
 * LIVE book/rendition pair the React lifecycle hook (useEpubReader) still
 * constructs — consumers moved onto the port without the load pipeline
 * moving in the same change. The remaining hook internals (theming effect,
 * chinese content processor, locations cache) dissolve into engine modules
 * in their own Phase 6 items (PR-4/PR-10 of the prep doc).
 *
 * Every `(x as any)` here is inherited verbatim from the pre-port call
 * sites: the ambient epubjs stub (src/types/epubjs.d.ts) does not type these
 * internals; its retirement is the separate §8 stub-refactor item.
 */
import ePub, { type Book, type Rendition, type Location } from 'epubjs';
import { createLogger } from '@lib/logger';
import type { NavigationItem } from '~types/db';
import { HighlightLayerManager, type AnnotatingRendition } from './HighlightLayerManager';
import type {
  ContentView,
  EngineLocation,
  EngineLocations,
  EngineStatus,
  RangeRects,
  ReaderEngine,
  ReaderEngineEvent,
  ResolvedSection,
} from './ReaderEngine';

const logger = createLogger('EpubJsEngine');

/**
 * The ONE runtime entry into epub.js book construction. The reader lifecycle
 * hook calls this instead of importing `epubjs` itself.
 */
export function createEpubJsBook(data: ArrayBuffer | Blob | File): Book {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ePub(data as any);
}

export interface EpubJsEngineDeps {
  book: Book;
  rendition: Rendition;
  /** The viewer element the rendition was rendered into. */
  container: HTMLElement;
  /** Resolves when the CFI<->percentage registry is loaded or generated. */
  locationsReady: Promise<void>;
}

export class EpubJsEngine implements ReaderEngine {
  readonly highlights: HighlightLayerManager;
  readonly locations: EngineLocations;

  private _status: EngineStatus = 'ready';
  private listeners = new Set<(e: ReaderEngineEvent) => void>();
  private detachFns: Array<() => void> = [];
  private locationsAreReady = false;
  private destroyed = false;

  constructor(private readonly deps: EpubJsEngineDeps) {
    this.highlights = new HighlightLayerManager(
      deps.rendition as unknown as AnnotatingRendition,
    );

    const whenReady = deps.locationsReady.then(() => {
      if (this.destroyed) return;
      this.locationsAreReady = true;
      this.emit({ type: 'locationsReady' });
    });
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const engine = this;
    this.locations = {
      get ready() {
        return engine.locationsAreReady;
      },
      whenReady: () => whenReady,
      length: () => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this.deps.book.locations as any)?.length() ?? 0;
        } catch {
          return 0;
        }
      },
      percentageFromCfi: (cfi: string) => {
        try {
          return this.deps.book.locations.percentageFromCfi(cfi) ?? 0;
        } catch {
          return 0;
        }
      },
      cfiFromPercentage: (p: number) => {
        try {
          return this.deps.book.locations.cfiFromPercentage(p) ?? '';
        } catch {
          return '';
        }
      },
    };

    this.wireRenditionEvents();
  }

  get status(): EngineStatus {
    return this._status;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.detachFns.forEach((fn) => {
      try {
        fn();
      } catch {
        /* rendition may already be torn down */
      }
    });
    this.detachFns = [];
    this.highlights.detach();
    this.listeners.clear();
    this._status = 'idle';
  }

  // --- navigation & position -------------------------------------------

  display(target: string): Promise<void> {
    return Promise.resolve(this.deps.rendition.display(target));
  }

  next(): Promise<void> {
    return Promise.resolve(this.deps.rendition.next());
  }

  prev(): Promise<void> {
    return Promise.resolve(this.deps.rendition.prev());
  }

  currentLocation(): EngineLocation | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const location = (this.deps.rendition as any).location as Location | undefined;
    if (!location || !location.start) return null;
    return this.toEngineLocation(location);
  }

  // --- events ------------------------------------------------------------

  subscribe(listener: (e: ReaderEngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // --- geometry ------------------------------------------------------------

  /** Async, book-backed resolver (kernel CfiRangeResolver — snapping). */
  async getRange(cfi: string): Promise<Range | null> {
    try {
      // Lifecycle guard: the book may be destroyed during teardown.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (this.destroyed || !this.deps.book || !(this.deps.book as any).spine) return null;
      const range = await this.deps.book.getRange(cfi);
      return range ?? null;
    } catch {
      return null;
    }
  }

  /** Sync, rendition-backed range — only resolves on-screen content. */
  getRenderedRange(cfiRange: string): Range | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((this.deps.rendition as any).getRange(cfiRange) as Range) ?? null;
    } catch {
      return null;
    }
  }

  getRangeRects(cfi: string): RangeRects | null {
    const range = this.getRenderedRange(cfi);
    if (!range) return null;
    try {
      const rects = range.getClientRects();
      if (!rects || rects.length === 0) return null;
      return { rects, iframeOffset: this.iframeOffset() };
    } catch {
      return null;
    }
  }

  getOverlayContainer(): Element | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.deps.rendition as any)?.manager?.container || null;
  }

  getContentViews(): ContentView[] {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contents = ((this.deps.rendition as any).getContents() as any[]) || [];
      return contents
        .filter((c) => c && c.document)
        .map((c) => this.toContentView(c));
    } catch {
      return [];
    }
  }

  // --- structure ------------------------------------------------------------

  getToc(): NavigationItem[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((this.deps.book as any).navigation?.toc as NavigationItem[]) || [];
  }

  resolveSection(cfiOrHref: string): ResolvedSection | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const item = this.deps.book.spine.get(cfiOrHref) as any;
      if (!item) return null;
      return {
        href: item.href ?? '',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        index: item.index ?? (this.deps.book.spine as any).items?.indexOf(item) ?? -1,
        label: item.label,
      };
    } catch {
      return null;
    }
  }

  /**
   * Nav-based section label — ReadingHistoryPanel's resolveSectionLabel
   * moved verbatim behind the port (it reached through book.navigation and
   * the spine index scan).
   */
  getNavLabel(cfiOrHref: string): string | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const book = this.deps.book as any;
    let section;
    try {
      section = book.spine.get(cfiOrHref);
    } catch {
      return null;
    }
    if (!section) return null;

    if (section.href) {
      const navItem = book.navigation?.get(section.href);
      if (navItem?.label && navItem.label.trim() !== 'Chapter') {
        return navItem.label.trim();
      }
    }

    const spinePos = section.index ?? book.spine.items?.indexOf(section);

    // Try to find nav item by checking all nav items for matching spine index
    // This handles cases where href lookup fails or is mismatched
    if (spinePos >= 0 && book.navigation) {
      let foundLabel: string | null = null;
      book.navigation.forEach((item: { href?: string; label?: string }) => {
        // Check if nav item's href points to our spine item
        const itemHref = item.href ? item.href.split('#')[0] : null;
        const itemSection = itemHref ? book.spine.get(itemHref) : null;
        if (itemSection && itemSection.index === spinePos) {
          foundLabel = item.label ?? null;
        }
      });
      if (foundLabel && typeof foundLabel === 'string' && (foundLabel as string).trim() !== 'Chapter') {
        return (foundLabel as string).trim();
      }
    }

    return spinePos >= 0 ? `Chapter ${spinePos + 1}` : null;
  }

  /**
   * Loads a section's text content without rendering it (useSmartTOC's
   * collectSectionData internals, verbatim; P7 reuses it for indexing).
   */
  async loadSectionText(href: string): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contentOrDoc = await (this.deps.book as any).load(href.split('#')[0]);
    let doc: Document | null = null;

    if (typeof contentOrDoc === 'string') {
      doc = new DOMParser().parseFromString(contentOrDoc, 'text/html');
    } else if (contentOrDoc && typeof contentOrDoc === 'object') {
      doc = contentOrDoc as Document;
    }

    if (!doc) return '';
    // Try innerText first (browser), then textContent (standard) — the
    // textContent fallback was always the documented intent of this logic
    // (and is what jsdom exercises; browsers resolve innerText first).
    const content =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (doc.body as any)?.innerText ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (doc.documentElement as any)?.innerText ||
      doc.body?.textContent ||
      '';
    return typeof content === 'string' ? content : '';
  }

  // --- metadata ------------------------------------------------------------

  getLanguage(): string | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lang = (this.deps.book as any)?.packaging?.metadata?.language;
    return lang && typeof lang === 'string' ? lang : undefined;
  }

  // --- selection ------------------------------------------------------------

  /** Programmatic block selection (the audio-bookmark triage path, verbatim). */
  selectRange(cfiRange: string): void {
    try {
      const range = this.getRenderedRange(cfiRange);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = (this.deps.rendition as any).manager?.getContents()?.[0]?.window;
      if (win && range) {
        win.getSelection()?.removeAllRanges();
        win.getSelection()?.addRange(range);
      }
    } catch (e) {
      logger.warn('selectRange failed', e);
    }
  }

  clearSelection(): void {
    try {
      const iframe = this.deps.container.querySelector('iframe');
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.getSelection()?.removeAllRanges();
      }
    } catch {
      /* iframe may be mid-teardown */
    }
  }

  // --- internals ------------------------------------------------------------

  private emit(e: ReaderEngineEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(e);
      } catch (err) {
        logger.warn('engine listener failed', err);
      }
    });
  }

  private iframeOffset(): { top: number; left: number } {
    const iframe = this.getOverlayContainer()?.querySelector('iframe');
    return { top: iframe?.offsetTop || 0, left: iframe?.offsetLeft || 0 };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toContentView(contents: any): ContentView {
    const iframe = contents?.window?.frameElement as HTMLIFrameElement | null;
    const sectionIndex = contents?.sectionIndex;
    let sectionHref = '';
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const item = (this.deps.book.spine as any)?.get?.(sectionIndex);
      sectionHref = item?.href ?? '';
    } catch {
      /* best effort */
    }
    return {
      sectionHref,
      document: contents.document,
      window: contents.window,
      iframeOffset: {
        top: iframe?.offsetTop || 0,
        left: iframe?.offsetLeft || 0,
      },
      cfiFromRange: (range: Range) => contents.cfiFromRange(range),
    };
  }

  private toEngineLocation(location: Location): EngineLocation {
    let percentage = 0;
    try {
      percentage = this.deps.book.locations.percentageFromCfi(location.start.cfi) ?? 0;
    } catch {
      // ignore — registry may not be generated yet (legacy behavior)
    }
    return {
      startCfi: location.start.cfi,
      endCfi: location.end?.cfi ?? location.start.cfi,
      sectionHref: location.start.href,
      percentage,
      atStart: !!location.atStart,
      atEnd: !!location.atEnd,
      displayed: location.start.displayed,
    };
  }

  private wireRenditionEvents(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rendition = this.deps.rendition as any;

    const on = (event: string, handler: (...args: unknown[]) => void) => {
      try {
        rendition.on(event, handler);
        this.detachFns.push(() => rendition.off?.(event, handler));
      } catch (e) {
        logger.warn(`failed to wire '${event}'`, e);
      }
    };

    on('relocated', (location) => {
      this.emit({ type: 'relocated', location: this.toEngineLocation(location as Location) });
    });

    on('selected', (cfiRange, contents) => {
      const range = this.getRenderedRange(cfiRange as string);
      if (!range) return; // legacy guard: epub.js 'selected' with no live range is dropped
      this.emit({
        type: 'selected',
        cfiRange: cfiRange as string,
        range,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        view: contents && (contents as any).document ? this.toContentView(contents) : null,
      });
    });

    on('click', (event) => {
      this.emit({ type: 'click', event: event as MouseEvent });
    });

    // The forwarded iframe keydown stream (P0 keyboard-gating hotfix path).
    on('keydown', (event) => {
      this.emit({ type: 'keydown', event: event as KeyboardEvent });
    });

    on('resized', () => {
      this.emit({ type: 'resized' });
    });

    // Per-section content pipeline: emit contentRendered and set the
    // accessible iframe title (the C7 SR contract: every reader iframe is
    // named for screen readers at content render).
    try {
      rendition.hooks?.content?.register?.((contents: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c = contents as any;
        if (!c?.document) return;
        try {
          const iframe = c.window?.frameElement as HTMLIFrameElement | null;
          if (iframe && !iframe.getAttribute('title')) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const title = (this.deps.book as any)?.packaging?.metadata?.title;
            iframe.setAttribute('title', typeof title === 'string' && title ? title : 'Book content');
          }
        } catch {
          /* best effort */
        }
        this.emit({ type: 'contentRendered', view: this.toContentView(c) });
      });
    } catch (e) {
      logger.warn('failed to register content hook', e);
    }
  }
}

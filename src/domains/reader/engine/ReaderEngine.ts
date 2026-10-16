/**
 * ReaderEngine — contract C7, the reader engine port. Components, panels and
 * hooks consume THIS surface; `EpubJsEngine` is the sole runtime epubjs
 * importer (boundary rule 8 — lint-enforced) and `FakeReaderEngine` proves
 * the port is renderer agnostic (the C7 acceptance: swapping to foliate-js
 * is a one-module change, demonstrated by the shell booting on the fake).
 *
 * Notes on the surface:
 *  - `getRenderedRange(cfi)` is the sync, rendition-backed range used by
 *    geometry/queue-matching call sites (renders only what is on screen);
 *    `getRange(cfi)` (async, book-backed) is the kernel CfiRangeResolver
 *    used for sentence snapping — they have different semantics and both
 *    are kept.
 *  - `getNavLabel(target)` keeps ReadingHistoryPanel's nav-based section
 *    label resolution behind the port (no book.navigation/spine reach-in).
 *  - `getLanguage()` keeps reader-side sentence snapping on the OPF
 *    language (the locale-aware kernel behavior) without handing
 *    components the Book.
 *  - The port has no theming/flow API: presentation is applied by the
 *    `epubTheming` module, not through the engine.
 *  - The event union includes 'statusChanged' and 'locationsReady' (the
 *    React adapter needs them).
 */
import type { CfiRangeResolver } from '@kernel/cfi';
import type { NavigationItem } from '~types/book';
import type { HighlightLayerManager } from './HighlightLayerManager';

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface EngineLocation {
  startCfi: string;
  endCfi: string;
  sectionHref: string;
  percentage: number;
  atStart: boolean;
  atEnd: boolean;
  displayed?: { page: number; total: number };
}

/** A rendered section's content surface (wraps an epub.js Contents). */
export interface ContentView {
  sectionHref: string;
  document: Document;
  window: Window;
  /** Scrolled-doc stacking offsets of this view's iframe within the container. */
  iframeOffset: { top: number; left: number };
  cfiFromRange(range: Range): string;
}

export type ReaderEngineEvent =
  | { type: 'relocated'; location: EngineLocation }
  | { type: 'selected'; cfiRange: string; range: Range; view: ContentView | null }
  | { type: 'click'; event: MouseEvent }
  /** Forwarded iframe keydown stream (bridged into the keyboard shortcut service). */
  | { type: 'keydown'; event: KeyboardEvent }
  /** Per-section render; chinese processing + overlays subscribe. */
  | { type: 'contentRendered'; view: ContentView }
  | { type: 'contentDestroyed'; sectionHref: string }
  | { type: 'resized' }
  | { type: 'statusChanged'; status: EngineStatus }
  | { type: 'locationsReady' };

export interface ResolvedSection {
  href: string;
  index: number;
  /** Raw spine-item label (may be absent; nav-based labels via getNavLabel). */
  label?: string;
}

export interface EngineLocations {
  readonly ready: boolean;
  whenReady(): Promise<void>;
  /** Location-registry size (0 until generated/loaded). */
  length(): number;
  percentageFromCfi(cfi: string): number;
  cfiFromPercentage(p: number): string;
}

export interface RangeRects {
  rects: DOMRectList | DOMRect[];
  iframeOffset: { top: number; left: number };
}

export interface ReaderEngine extends CfiRangeResolver {
  // lifecycle
  readonly status: EngineStatus;
  destroy(): void;

  // navigation & position
  display(target: string): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  currentLocation(): EngineLocation | null;

  // events
  subscribe(listener: (e: ReaderEngineEvent) => void): () => void;

  // geometry (the MeasuredOverlay primitive)
  /** Async, book-backed resolver — the kernel CfiRangeResolver (snapping). */
  getRange(cfi: string): Promise<Range | null>;
  /** Sync, rendition-backed range for on-screen content; null off-screen. */
  getRenderedRange(cfiRange: string): Range | null;
  getRangeRects(cfi: string): RangeRects | null;
  getOverlayContainer(): Element | null;
  getContentViews(): ContentView[];

  // highlights — the ONLY path to epub.js annotations
  readonly highlights: HighlightLayerManager;

  // structure
  /** The publisher TOC with hrefs resolved onto the spine (see normalizeToc). */
  getToc(): NavigationItem[];
  /**
   * Resolve a TOC tree's hrefs onto this book's spine (@lib/epub/structure):
   * nav-relative, differently-encoded or -cased hrefs become spine hrefs and
   * entries that cannot be displayed get `unresolved: true`. `stored` order
   * (default) is idempotent — safe on TOCs persisted by any earlier build.
   */
  normalizeToc(items: NavigationItem[], order?: 'raw' | 'stored'): NavigationItem[];
  resolveSection(cfiOrHref: string): ResolvedSection | null;
  /** Nav-based human label for a section (ReadingHistoryPanel semantics). */
  getNavLabel(cfiOrHref: string): string | null;
  /** Section text without re-unzipping (useSmartTOC). */
  loadSectionText(href: string): Promise<string>;

  // locations registry
  readonly locations: EngineLocations;

  // metadata
  /** OPF language (locale-aware sentence snapping), if declared. */
  getLanguage(): string | undefined;

  // selection utilities (audio-bookmark triage path)
  selectRange(cfiRange: string): void;
  clearSelection(): void;
}

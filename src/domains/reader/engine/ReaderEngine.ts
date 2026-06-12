/**
 * ReaderEngine — contract C7, the reader engine port (Phase 6 §2,
 * prep/phase6-reader-engine.md). Components, panels and hooks consume THIS
 * surface; `EpubJsEngine` is the sole runtime epubjs importer (boundary
 * rule 8 — lint-enforced) and `FakeReaderEngine` proves the port is renderer
 * agnostic (the C7 acceptance: swapping to foliate-js is a one-module
 * change, demonstrated by the shell booting on the fake).
 *
 * Reconciliations vs the prep-doc §2b sketch (tree moved since it was
 * written; recorded per the program rules):
 *  - `getRenderedRange(cfi)` added: the sync, rendition-backed range used by
 *    geometry/queue-matching call sites (renders only what is on screen);
 *    `getRange(cfi)` (async, book-backed) is the kernel CfiRangeResolver
 *    used for sentence snapping — they had different semantics in the
 *    legacy code and both are preserved.
 *  - `getNavLabel(target)` added: ReadingHistoryPanel's nav-based section
 *    label resolution moved verbatim behind the port (it was deep
 *    book.navigation/spine reach-in).
 *  - `getLanguage()` added: keeps reader-side sentence snapping on the OPF
 *    language (the P5c locale-aware kernel behavior) without handing
 *    components the Book.
 *  - `locations.length()` added (panel guard parity); `applyTheme`/`setFlow`
 *    stay HOOK-side for now — the theming split is the separate
 *    epubTheming-extraction item (prep doc PR-4), not this port commit.
 *  - Event union gains 'statusChanged' and 'locationsReady' (the React
 *    adapter needs them; the doc's union predates the adapter design).
 */
import type { CfiRangeResolver } from '@kernel/cfi';
import type { NavigationItem } from '~types/db';
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
  /** Forwarded iframe keydown stream (the P0 keyboard-gating hotfix path). */
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

  // highlights — the ONLY path to epub.js annotations (Phase 6 §4)
  readonly highlights: HighlightLayerManager;

  // structure
  getToc(): NavigationItem[];
  resolveSection(cfiOrHref: string): ResolvedSection | null;
  /** Nav-based human label for a section (ReadingHistoryPanel semantics). */
  getNavLabel(cfiOrHref: string): string | null;
  /** Section text without re-unzipping (useSmartTOC; P7 search indexing). */
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

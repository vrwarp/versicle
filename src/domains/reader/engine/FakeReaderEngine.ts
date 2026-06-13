/**
 * FakeReaderEngine — the in-memory ReaderEngine implementation (contract C7).
 *
 * Exists to prove the port is renderer-agnostic: the conformance suite
 * (describeReaderEngineContract) runs against BOTH engines, and the
 * renderer-swap smoke boots the reader shell on this fake in jsdom — the C7
 * acceptance test ("swapping to foliate-js is a one-module change").
 *
 * Deterministic geometry: each section is a flat list of sentences; CFIs are
 * the synthetic `epubcfi(/6/{2*(i+1)}!/4/2/{n}:0)` shape; every sentence
 * occupies one 20px line of 200px width.
 */
import type { NavigationItem } from '~types/book';
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

export interface FakeSection {
  href: string;
  label: string;
  text: string;
}

export interface FakeReaderEngineOptions {
  sections?: FakeSection[];
  language?: string;
}

const DEFAULT_SECTIONS: FakeSection[] = [
  { href: 'chapter1.xhtml', label: 'Chapter 1', text: 'First sentence. Second sentence.' },
  { href: 'chapter2.xhtml', label: 'Chapter 2', text: 'Another chapter. More text here.' },
];

interface RecordedAnnotation {
  type: string;
  cfiRange: string;
  className: string;
  styles?: Record<string, string>;
}

export class FakeReaderEngine implements ReaderEngine {
  readonly highlights: HighlightLayerManager;
  readonly locations: EngineLocations;

  /** Every epub.js-shaped annotation call, recorded for assertions. */
  readonly annotationLog: RecordedAnnotation[] = [];

  private _status: EngineStatus = 'ready';
  private listeners = new Set<(e: ReaderEngineEvent) => void>();
  private sections: FakeSection[];
  private language?: string;
  private sectionIndex = 0;
  private container: HTMLElement;
  private locationsReady = true;
  private destroyed = false;

  constructor(opts: FakeReaderEngineOptions = {}) {
    this.sections = opts.sections ?? DEFAULT_SECTIONS;
    this.language = opts.language;
    this.container = document.createElement('div');
    this.container.setAttribute('data-fake-reader-container', 'true');

    const log = this.annotationLog;
    const fakeRendition: AnnotatingRendition = {
      annotations: {
        add: (type, cfiRange, _data, _cb, className, styles) => {
          log.push({ type, cfiRange, className, styles });
        },
        remove: (cfiRange) => {
          const idx = log.findIndex((a) => a.cfiRange === cfiRange);
          if (idx >= 0) log.splice(idx, 1);
        },
      },
      views: () => [],
    };
    this.highlights = new HighlightLayerManager(fakeRendition);

    this.locations = {
      get ready() {
        return true;
      },
      whenReady: () => Promise.resolve(),
      length: () => this.sections.length * 10,
      percentageFromCfi: (cfi) => {
        const idx = this.sectionIndexFromCfi(cfi);
        return idx < 0 ? 0 : idx / Math.max(1, this.sections.length);
      },
      cfiFromPercentage: (p) => {
        const idx = Math.min(
          this.sections.length - 1,
          Math.max(0, Math.floor(p * this.sections.length)),
        );
        return this.cfiForSection(idx);
      },
    };
    void this.locationsReady;
  }

  get status(): EngineStatus {
    return this._status;
  }

  destroy(): void {
    this.destroyed = true;
    this.listeners.clear();
    this.highlights.detach();
    this._status = 'idle';
  }

  // --- navigation ------------------------------------------------------------

  async display(target: string): Promise<void> {
    if (this.destroyed) return;
    const idx = this.indexFor(target);
    if (idx < 0) return;
    this.sectionIndex = idx;
    this.emit({ type: 'relocated', location: this.currentLocation()! });
  }

  async next(): Promise<void> {
    if (this.destroyed || this.sectionIndex >= this.sections.length - 1) return;
    this.sectionIndex += 1;
    this.emit({ type: 'relocated', location: this.currentLocation()! });
  }

  async prev(): Promise<void> {
    if (this.destroyed || this.sectionIndex <= 0) return;
    this.sectionIndex -= 1;
    this.emit({ type: 'relocated', location: this.currentLocation()! });
  }

  currentLocation(): EngineLocation | null {
    if (this.destroyed) return null;
    const section = this.sections[this.sectionIndex];
    return {
      startCfi: this.cfiForSection(this.sectionIndex),
      endCfi: this.cfiForSection(this.sectionIndex, 1),
      sectionHref: section.href,
      percentage: this.sectionIndex / Math.max(1, this.sections.length),
      atStart: this.sectionIndex === 0,
      atEnd: this.sectionIndex === this.sections.length - 1,
    };
  }

  // --- events ------------------------------------------------------------

  subscribe(listener: (e: ReaderEngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Test helper: drive an arbitrary event through the bus. */
  emit(e: ReaderEngineEvent): void {
    this.listeners.forEach((listener) => listener(e));
  }

  // --- geometry ------------------------------------------------------------

  async getRange(cfi: string): Promise<Range | null> {
    if (this.destroyed) return null;
    return this.syntheticRange(cfi);
  }

  getRenderedRange(cfiRange: string): Range | null {
    if (this.destroyed) return null;
    // Only the displayed section is "rendered".
    const idx = this.sectionIndexFromCfi(cfiRange);
    if (idx !== this.sectionIndex) return null;
    return this.syntheticRange(cfiRange);
  }

  getRangeRects(cfi: string): RangeRects | null {
    const range = this.getRenderedRange(cfi);
    if (!range) return null;
    const n = this.sentenceIndexFromCfi(cfi);
    const rect = {
      top: n * 20,
      left: 0,
      right: 200,
      bottom: n * 20 + 20,
      width: 200,
      height: 20,
      x: 0,
      y: n * 20,
      toJSON: () => ({}),
    } as DOMRect;
    return { rects: [rect], iframeOffset: { top: 0, left: 0 } };
  }

  getOverlayContainer(): Element | null {
    return this.destroyed ? null : this.container;
  }

  getContentViews(): ContentView[] {
    if (this.destroyed) return [];
    const section = this.sections[this.sectionIndex];
    const doc = document.implementation.createHTMLDocument(section.label);
    const p = doc.createElement('p');
    p.textContent = section.text;
    doc.body.appendChild(p);
    return [
      {
        sectionHref: section.href,
        document: doc,
        window: window,
        iframeOffset: { top: 0, left: 0 },
        cfiFromRange: () => this.cfiForSection(this.sectionIndex),
      },
    ];
  }

  // --- structure ------------------------------------------------------------

  getToc(): NavigationItem[] {
    return this.sections.map((s, i) => ({
      id: `toc-${i}`,
      href: s.href,
      label: s.label,
    }));
  }

  resolveSection(cfiOrHref: string): ResolvedSection | null {
    const idx = this.indexFor(cfiOrHref);
    if (idx < 0) return null;
    return { href: this.sections[idx].href, index: idx, label: this.sections[idx].label };
  }

  getNavLabel(cfiOrHref: string): string | null {
    const resolved = this.resolveSection(cfiOrHref);
    return resolved ? this.sections[resolved.index].label : null;
  }

  async loadSectionText(href: string): Promise<string> {
    const idx = this.indexFor(href);
    return idx < 0 ? '' : this.sections[idx].text;
  }

  getLanguage(): string | undefined {
    return this.language;
  }

  // --- selection ------------------------------------------------------------

  selectRange(_cfiRange: string): void {
    /* no live selection in the fake */
  }

  clearSelection(): void {
    /* no live selection in the fake */
  }

  // --- synthetic CFI helpers -------------------------------------------------

  private cfiForSection(idx: number, sentence = 0): string {
    return `epubcfi(/6/${2 * (idx + 1)}!/4/2/${sentence + 1}:0)`;
  }

  private indexFor(target: string): number {
    const byHref = this.sections.findIndex((s) => s.href === target.split('#')[0]);
    if (byHref >= 0) return byHref;
    return this.sectionIndexFromCfi(target);
  }

  private sectionIndexFromCfi(cfi: string): number {
    const m = /^epubcfi\(\/6\/(\d+)!/.exec(cfi);
    if (!m) return -1;
    const idx = Number(m[1]) / 2 - 1;
    return idx >= 0 && idx < this.sections.length ? idx : -1;
  }

  private sentenceIndexFromCfi(cfi: string): number {
    const m = /\/4\/2\/(\d+):/.exec(cfi);
    return m ? Number(m[1]) - 1 : 0;
  }

  private syntheticRange(cfi: string): Range | null {
    if (this.sectionIndexFromCfi(cfi) < 0) return null;
    const doc = document.implementation.createHTMLDocument('fake');
    const text = doc.createTextNode(this.sections[Math.max(0, this.sectionIndexFromCfi(cfi))].text);
    doc.body.appendChild(text);
    const range = doc.createRange();
    range.setStart(text, 0);
    range.setEnd(text, Math.min(1, text.length));
    return range;
  }
}

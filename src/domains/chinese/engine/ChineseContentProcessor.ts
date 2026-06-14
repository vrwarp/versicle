/**
 * ChineseContentProcessor — the event-driven Chinese reading pass
 * (Phase 6 §7.2, prep/phase6-reader-engine.md PR-10; supersedes the
 * chineseContentProcessor.ts seam, which had replaced the inline pass in
 * useEpubReader).
 *
 * CH-2 dies here: the legacy pass ran only on content load + a fixed React
 * dependency list ([isReady, forceTraditionalChinese, showPinyin,
 * pinyinSize]) and REPLACED the whole position array per run, so a
 * relocation, a resize, or a second loaded section (scrolled mode stacks
 * iframes) dropped or clobbered annotations. This processor:
 *
 *  - keys positions per section (`Map<sectionHref, PinyinPosition[]>`) and
 *    emits the MERGED array, so multi-section scrolled mode composes;
 *  - subscribes to the ReaderEngine events: `contentRendered` (process the
 *    new view), `contentDestroyed` (invalidate that section), `relocated` +
 *    `resized` (re-measure all live views, coalesced), plus an explicit
 *    `refresh()` for preference/book-language changes;
 *  - threads a PER-SECTION cancellation token per scheduled run, shared by
 *    the traditional-conversion and geometry passes (CH-7's interleaving
 *    hazard): a superseded run abandons its writes instead of racing, and
 *    one section's fresh render never cancels a neighbor's pass.
 *
 * Boundary: domains-no-store — preferences arrive via the injected
 * `getPrefs()` thunk (read at run time, exactly the getState() timing the
 * legacy pass had); the app layer owns the wiring (src/app/reader).
 */
import type { ContentView, ReaderEngine } from '@domains/reader/engine/ReaderEngine';
import type { PinyinPosition } from '@domains/chinese/types';
import {
  collectNodePinyinPositions,
  ensurePinyin,
  findHanTextNodes,
} from './PinyinGeometryEngine';
import { applyDisplayScript, ensureOpenCC } from './TraditionalConverter';

export interface ChineseReadingPrefs {
  forceTraditionalChinese: boolean;
  showPinyin: boolean;
}

export interface ChineseReadingHooks {
  /** Read the CURRENT preferences (called at run time, never cached). */
  getPrefs(): ChineseReadingPrefs;
  /** Receives the merged overlay geometry across all live sections. */
  onPositions(positions: PinyinPosition[]): void;
}

export class ChineseContentProcessor {
  /** Live section views, in render order (merge order of the overlay). */
  private views = new Map<string, ContentView>();
  private positionsBySection = new Map<string, PinyinPosition[]>();
  /**
   * PER-SECTION run tokens: a stale async pass abandons its writes without
   * cancelling other sections' in-flight passes (scrolled mode renders
   * neighbors in quick succession).
   */
  private tokens = new Map<string, number>();
  private remeasureScheduled = false;
  private disposed = false;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly engine: ReaderEngine,
    private readonly hooks: ChineseReadingHooks,
  ) {}

  /** Subscribe to engine events and process the already-rendered views. */
  start(): void {
    if (this.disposed) return;
    this.unsubscribe = this.engine.subscribe((event) => {
      switch (event.type) {
        case 'contentRendered':
          this.adoptView(event.view);
          void this.processView(event.view, this.nextToken(event.view.sectionHref));
          break;
        case 'contentDestroyed': {
          this.nextToken(event.sectionHref); // abandon any in-flight pass
          const hadView = this.views.delete(event.sectionHref);
          const hadPositions = this.positionsBySection.delete(event.sectionHref);
          if (hadView || hadPositions) this.emitMerged();
          break;
        }
        case 'relocated':
        case 'resized':
          // Geometry moved under the same content — re-measure, coalesced
          // (paginated page turns and container resizes both shift rects).
          this.scheduleRemeasure();
          break;
        default:
          break;
      }
    });
    // Sections rendered before registration (the engine wires its content
    // hook at construction, before display) are processed at start.
    for (const view of this.engine.getContentViews()) {
      this.adoptView(view);
    }
    this.refresh();
  }

  /** Re-run the full pass over every live view (preference change). */
  refresh(): void {
    if (this.disposed) return;
    for (const view of this.views.values()) {
      void this.processView(view, this.nextToken(view.sectionHref));
    }
    if (this.views.size === 0 && this.positionsBySection.size > 0) {
      this.positionsBySection.clear();
      this.emitMerged();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.views.clear();
    this.positionsBySection.clear();
    this.tokens.clear();
  }

  private adoptView(view: ContentView): void {
    this.views.set(view.sectionHref, view);
  }

  private nextToken(sectionHref: string): number {
    const next = (this.tokens.get(sectionHref) ?? 0) + 1;
    this.tokens.set(sectionHref, next);
    return next;
  }

  private scheduleRemeasure(): void {
    if (this.remeasureScheduled || this.disposed) return;
    this.remeasureScheduled = true;
    // Macrotask: lets the renderer settle its layout first and coalesces
    // bursts (epub.js can emit several relocations per gesture).
    setTimeout(() => {
      this.remeasureScheduled = false;
      if (!this.disposed) this.refresh();
    }, 0);
  }

  /**
   * The content pass for one section view: display script (traditional or
   * restored original) then pinyin geometry, keyed by section. A token
   * mismatch after any await abandons the run (its writes never land).
   */
  private async processView(view: ContentView, token: number): Promise<void> {
    const doc = view.document;
    if (!doc) return;

    const prefs = this.hooks.getPrefs();

    // Pre-load processors so the DOM loop below is fully synchronous.
    if (prefs.forceTraditionalChinese) await ensureOpenCC();
    if (prefs.showPinyin) await ensurePinyin();
    if (token !== this.tokens.get(view.sectionHref) || this.disposed) return;

    // Iframe offsets are read FRESH at measure time (scrolled mode stacks
    // iframes; a section's offsets change as neighbors load/unload).
    const frame = view.window?.frameElement as HTMLIFrameElement | null;
    const iframeOffset = frame
      ? { top: frame.offsetTop, left: frame.offsetLeft }
      : view.iframeOffset;

    const positions: PinyinPosition[] = [];
    for (const textNode of findHanTextNodes(doc)) {
      const displayed = applyDisplayScript(textNode, prefs.forceTraditionalChinese);
      if (prefs.showPinyin && displayed) {
        positions.push(...collectNodePinyinPositions(doc, textNode, iframeOffset));
      }
    }

    if (token !== this.tokens.get(view.sectionHref) || this.disposed) return;
    this.positionsBySection.set(view.sectionHref, positions);
    this.emitMerged();
  }

  private emitMerged(): void {
    const merged: PinyinPosition[] = [];
    for (const positions of this.positionsBySection.values()) {
      merged.push(...positions);
    }
    this.hooks.onPositions(merged);
  }
}

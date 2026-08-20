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
 * Jank posture (the remeasure path runs on EVERY page turn, scroll-settle
 * relocation and TTS follow-display, so it must never block a frame):
 *
 *  - the pass is phased WRITE-then-READ: the display-script mutations land
 *    for every node before the first `getBoundingClientRect`, so
 *    Traditional mode does one reflow per pass instead of one per node;
 *  - readings are cached per text node (PinyinGeometryEngine); remeasures
 *    re-read rects only, never re-run pinyin-pro/OpenCC over the chapter;
 *  - the measure loop yields to the event loop on a time budget
 *    (MEASURE_SLICE_BUDGET_MS) — the existing run tokens make each slice
 *    safely abortable, so a superseded pass stops at its next slice edge;
 *  - a pass whose positions come out IDENTICAL to the section's current
 *    ones neither rewrites the map nor emits — the no-op remeasure storm
 *    (paginated page turns / scroll pauses, where in-iframe geometry is
 *    stable) stops re-rendering the overlay entirely;
 *  - views whose iframe left the parent DOM are dropped at pass time
 *    (belt-and-braces under the engine's `contentDestroyed`), so detached
 *    documents can never accumulate work.
 *
 * Boundary: domains-no-store — preferences arrive via the injected
 * `getPrefs()` thunk (read at run time, exactly the getState() timing the
 * legacy pass had); the app layer owns the wiring (src/app/reader).
 */
import type { ContentView, ReaderEngine } from '@domains/reader/engine/ReaderEngine';
import type { PinyinPosition } from '@domains/chinese/types';
import { measureSince } from '@lib/perf';
import {
  ensurePinyin,
  findHanTextNodes,
  getNodeReadings,
  measureNodePinyinPositions,
} from './PinyinGeometryEngine';
import { applyDisplayScript, ensureOpenCC, getPinyinSourceText } from './TraditionalConverter';

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

/**
 * Per-slice synchronous budget for the geometry loops. 8ms keeps each slice
 * within half a 60Hz frame even with browser work around it; the yield is a
 * macrotask so input/paint interleave between slices.
 */
const MEASURE_SLICE_BUDGET_MS = 8;

/**
 * First partial-emit size while streaming a section's initial annotation
 * (then doubling). Small enough that pinyin paints almost immediately,
 * large enough that a short section lands in ONE emit.
 */
const STREAM_FIRST_EMIT = 200;

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Field-wise equality of two position lists (the no-op remeasure guard). */
function positionsEqual(a: PinyinPosition[], b: PinyinPosition[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.char !== y.char ||
      x.pinyin !== y.pinyin ||
      x.top !== y.top ||
      x.left !== y.left ||
      x.width !== y.width ||
      x.height !== y.height
    ) {
      return false;
    }
  }
  return true;
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
        case 'contentDestroyed':
          this.dropView(event.sectionHref);
          break;
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
    this.scheduleWarmup();
  }

  /**
   * Idle-time warmup of the heavy lazily-loaded processors (jank fix): the
   * pinyin-pro and OpenCC dictionary modules parse in one unbreakable task,
   * which used to land INSIDE the first "show pinyin"/"traditional" toggle.
   * The processor only exists for zh books, so prefetching at idle trades a
   * few MB of memory for a toggle that starts annotating immediately.
   */
  private scheduleWarmup(): void {
    const warm = () => {
      if (this.disposed) return;
      void ensureOpenCC().catch(() => {});
      void ensurePinyin().catch(() => {});
    };
    const ric = (
      globalThis as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    if (ric) {
      ric(warm, { timeout: 3000 });
    } else {
      setTimeout(warm, 1500);
    }
  }

  /** Re-run the full pass over every live view (preference change). */
  refresh(): void {
    if (this.disposed) return;
    for (const view of this.views.values()) {
      if (!this.isViewLive(view)) {
        // The engine missed (or has not yet delivered) this section's
        // destroy — drop it here so detached documents never keep costing
        // a full pass per remeasure.
        this.dropView(view.sectionHref);
        continue;
      }
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

  private dropView(sectionHref: string): void {
    this.nextToken(sectionHref); // abandon any in-flight pass
    const hadView = this.views.delete(sectionHref);
    const hadPositions = this.positionsBySection.delete(sectionHref);
    if (hadView || hadPositions) this.emitMerged();
  }

  /**
   * A view is dead when its iframe element has left the parent document
   * (epub.js destroyed the section). Deliberately conservative: only a
   * positive `isConnected === false` counts — test fixtures and exotic
   * views without a real frameElement stay live. An unreachable window
   * (discarded browsing context throws) also counts as dead.
   */
  private isViewLive(view: ContentView): boolean {
    try {
      const frame = view.window?.frameElement;
      return !(frame && frame.isConnected === false);
    } catch {
      return false;
    }
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

  /** True when `token` is no longer the section's current run. */
  private isStale(view: ContentView, token: number): boolean {
    return token !== this.tokens.get(view.sectionHref) || this.disposed;
  }

  /**
   * The content pass for one section view: display script (traditional or
   * restored original) then pinyin geometry, keyed by section. A token
   * mismatch after any await abandons the run (its writes never land).
   */
  private async processView(view: ContentView, token: number): Promise<void> {
    const doc = view.document;
    if (!doc) return;
    if (!this.isViewLive(view)) {
      this.dropView(view.sectionHref);
      return;
    }

    const prefs = this.hooks.getPrefs();

    // Pre-load processors so the DOM loops below never await mid-node. OpenCC
    // is needed for the display pass (forceTraditional) AND for normalizing the
    // pinyin source to Simplified (showPinyin) — pinyin-pro is Simplified-centric,
    // so tw-native books are read via tw→cn (see getPinyinSourceText).
    if (prefs.forceTraditionalChinese || prefs.showPinyin) await ensureOpenCC();
    if (prefs.showPinyin) await ensurePinyin();
    if (this.isStale(view, token)) return;

    // Iframe offsets are read FRESH at measure time (scrolled mode stacks
    // iframes; a section's offsets change as neighbors load/unload).
    const frame = view.window?.frameElement as HTMLIFrameElement | null;
    const iframeOffset = frame
      ? { top: frame.offsetTop, left: frame.offsetLeft }
      : view.iframeOffset;

    const passStart = performance.now();

    // WRITE phase (+ pure reading computation, cached per node): every
    // display-script mutation lands before the first rect read below, so the
    // whole pass forces at most one reflow instead of one per mutated node.
    // Time-sliced on the same budget as the measure loop — a cold readings
    // pass over a full chapter is real work too.
    const annotate: Array<{ node: Text; readings: string[] }> = [];
    let sliceStart = performance.now();
    for (const textNode of findHanTextNodes(doc)) {
      // Cache the native (Simplified) source BEFORE applyDisplayScript mutates
      // the node to Traditional, then read pinyin from it — the readings line
      // up 1:1 with the displayed glyphs (cn→tw is code-point-preserving).
      const pinyinSource = getPinyinSourceText(textNode);
      const displayed = applyDisplayScript(textNode, prefs.forceTraditionalChinese);
      if (prefs.showPinyin && displayed) {
        annotate.push({ node: textNode, readings: getNodeReadings(textNode, pinyinSource) });
      }
      if (performance.now() - sliceStart > MEASURE_SLICE_BUDGET_MS) {
        await yieldToEventLoop();
        if (this.isStale(view, token)) return;
        sliceStart = performance.now();
      }
    }

    // READ phase: geometry only, time-sliced so a full-chapter measure never
    // blocks a frame. Rects are in-iframe coordinates, so nothing the parent
    // page does between slices moves them; a section-content change bumps
    // the token and aborts at the next slice edge.
    //
    // FIRST annotation of a section (no previous positions) STREAMS partial
    // results, so a 4,000-span chapter fills in top-down instead of landing
    // in one frame-blocking commit. The partial emits DOUBLE in size
    // (STREAM_FIRST_EMIT, then x2): the overlay re-renders its whole span
    // list per emit, so emitting every slice would make the mount quadratic
    // in span count — doubling keeps it linear (~2x total) while still
    // painting the first pinyin within a slice or two.
    //
    // REMEASURES never stream: they must compare against the previous pass
    // to keep the no-op guard below, so they emit at most once, at the end.
    const previous = this.positionsBySection.get(view.sectionHref);
    const streaming = !previous || previous.length === 0;
    const positions: PinyinPosition[] = [];
    let emitted = 0;
    let nextEmitAt = STREAM_FIRST_EMIT;
    sliceStart = performance.now();
    for (const { node, readings } of annotate) {
      positions.push(...measureNodePinyinPositions(doc, node, iframeOffset, readings));
      if (performance.now() - sliceStart > MEASURE_SLICE_BUDGET_MS) {
        if (streaming && positions.length >= nextEmitAt) {
          emitted = positions.length;
          nextEmitAt = emitted * 2;
          this.positionsBySection.set(view.sectionHref, positions.slice());
          this.emitMerged();
        }
        await yieldToEventLoop();
        if (this.isStale(view, token)) return;
        sliceStart = performance.now();
      }
    }
    measureSince('chinese:process-section', passStart);

    if (this.isStale(view, token)) return;

    if (streaming) {
      // Land the tail; an all-empty pass that never partial-emitted has
      // nothing to say (the section stays absent/empty in the map).
      if (positions.length > emitted) {
        this.positionsBySection.set(view.sectionHref, positions);
        this.emitMerged();
      }
      return;
    }

    // No-op remeasure guard: identical geometry (the common case for page
    // turns and scroll-settle relocations, where in-iframe rects are stable)
    // must not rebuild the merged array or re-render the overlay.
    if (positionsEqual(previous, positions)) return;

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

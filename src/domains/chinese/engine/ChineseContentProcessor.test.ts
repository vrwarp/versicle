/**
 * ChineseContentProcessor suite (Phase 6 §7.2, prep doc PR-10): the CH-2
 * invalidation matrix — per-section position maps, multi-section merge,
 * event-driven recompute (contentRendered / contentDestroyed / relocated /
 * resized / prefs refresh) and the per-run cancellation token.
 *
 * The relocate/resize/multi-section/prefs cases are DELIBERATE behavior
 * improvements over the pinned legacy pass (which only ran on content load
 * + a React dependency list) — added here as new assertions per the prep
 * doc's PR-10 row, never silently edited into old pins.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type {
  ContentView,
  ReaderEngine,
  ReaderEngineEvent,
} from '@domains/reader/engine/ReaderEngine';
import type { PinyinPosition } from '@domains/chinese/types';
import { ChineseContentProcessor, type ChineseReadingPrefs } from './ChineseContentProcessor';
import { ensurePinyin, getPinyin } from './PinyinGeometryEngine';
import { ensureOpenCC } from './TraditionalConverter';

const UNIT_PX = 10;

interface FixtureView extends ContentView {
  textNode: Text;
  setIframeOffset(offset: { top: number; left: number }): void;
}

/** A ContentView over a real jsdom doc with synthetic range geometry. */
function makeView(sectionHref: string, text: string, offset = { top: 0, left: 0 }): FixtureView {
  const doc = document.implementation.createHTMLDocument(sectionHref);
  const p = doc.createElement('p');
  p.textContent = text;
  doc.body.appendChild(p);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (doc as any).createRange = () => {
    let start = 0;
    let end = 0;
    return {
      setStart: (_node: Node, o: number) => {
        start = o;
      },
      setEnd: (_node: Node, o: number) => {
        end = o;
      },
      getBoundingClientRect: () => ({
        top: 0,
        left: start * UNIT_PX,
        right: end * UNIT_PX,
        bottom: 20,
        width: (end - start) * UNIT_PX,
        height: 20,
      }),
    };
  };

  const frameElement = { offsetTop: offset.top, offsetLeft: offset.left };
  return {
    sectionHref,
    document: doc,
    window: { frameElement, getSelection: () => null } as unknown as Window,
    iframeOffset: { ...offset },
    cfiFromRange: () => 'epubcfi(/6/2!/4/2)',
    textNode: p.firstChild as Text,
    setIframeOffset: (next) => {
      frameElement.offsetTop = next.top;
      frameElement.offsetLeft = next.left;
    },
  };
}

/** Minimal engine stub: the two surfaces the processor consumes. */
class StubEngine {
  private listeners = new Set<(e: ReaderEngineEvent) => void>();
  views: ContentView[] = [];

  subscribe(listener: (e: ReaderEngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getContentViews(): ContentView[] {
    return [...this.views];
  }

  emit(event: ReaderEngineEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  asEngine(): ReaderEngine {
    return this as unknown as ReaderEngine;
  }
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

describe('ChineseContentProcessor (CH-2 matrix)', () => {
  let prefs: ChineseReadingPrefs;
  let positions: PinyinPosition[];
  let onPositions: ReturnType<typeof vi.fn>;

  const hooks = () => ({
    getPrefs: () => ({ ...prefs }),
    onPositions: onPositions as unknown as (p: PinyinPosition[]) => void,
  });

  beforeAll(async () => {
    await ensurePinyin();
    await ensureOpenCC();
  });

  beforeEach(() => {
    prefs = { forceTraditionalChinese: false, showPinyin: true };
    positions = [];
    onPositions = vi.fn((p: PinyinPosition[]) => {
      positions = p;
    });
  });

  it('processes views already rendered at start (registration after first section render)', async () => {
    const engine = new StubEngine();
    engine.views = [makeView('ch1.xhtml', '你好')];
    const processor = new ChineseContentProcessor(engine.asEngine(), hooks());
    processor.start();
    await settle();

    expect(positions.map((p) => p.char)).toEqual(['你', '好']);
    expect(positions.map((p) => p.pinyin)).toEqual(getPinyin('你好'));
    processor.dispose();
  });

  it('merges positions across sections and keys them per section (scrolled-mode stacking)', async () => {
    const engine = new StubEngine();
    const processor = new ChineseContentProcessor(engine.asEngine(), hooks());
    processor.start();

    engine.emit({ type: 'contentRendered', view: makeView('ch1.xhtml', '你好', { top: 0, left: 0 }) });
    await settle();
    engine.emit({ type: 'contentRendered', view: makeView('ch2.xhtml', '世界', { top: 500, left: 0 }) });
    await settle();

    expect(positions).toHaveLength(4);
    expect(positions.map((p) => p.char)).toEqual(['你', '好', '世', '界']);
    // Each section contributes its OWN iframe offsets.
    expect(positions[0].top).toBe(0);
    expect(positions[2].top).toBe(500);
    processor.dispose();
  });

  it('contentDestroyed invalidates exactly that section', async () => {
    const engine = new StubEngine();
    const processor = new ChineseContentProcessor(engine.asEngine(), hooks());
    processor.start();

    engine.emit({ type: 'contentRendered', view: makeView('ch1.xhtml', '你好') });
    engine.emit({ type: 'contentRendered', view: makeView('ch2.xhtml', '世界') });
    await settle();
    expect(positions).toHaveLength(4);

    engine.emit({ type: 'contentDestroyed', sectionHref: 'ch1.xhtml' });
    expect(positions.map((p) => p.char)).toEqual(['世', '界']);
    processor.dispose();
  });

  it('re-measures on resized with FRESH iframe offsets (coalesced)', async () => {
    const engine = new StubEngine();
    const view = makeView('ch1.xhtml', '你好', { top: 100, left: 0 });
    engine.views = [view];
    const processor = new ChineseContentProcessor(engine.asEngine(), hooks());
    processor.start();
    await settle();
    expect(positions[0].top).toBe(100);

    // Layout shifts (neighbor section grew): offsets change under the view.
    view.setIframeOffset({ top: 350, left: 0 });
    engine.emit({ type: 'resized' });
    engine.emit({ type: 'resized' }); // burst — coalesced into one pass
    await settle();

    expect(positions[0].top).toBe(350);
    processor.dispose();
  });

  it('re-measures on relocated (paginated page turns shift rects)', async () => {
    const engine = new StubEngine();
    const view = makeView('ch1.xhtml', '你好');
    engine.views = [view];
    const processor = new ChineseContentProcessor(engine.asEngine(), hooks());
    processor.start();
    await settle();
    const callsBefore = onPositions.mock.calls.length;

    view.setIframeOffset({ top: 0, left: -700 });
    engine.emit({
      type: 'relocated',
      location: {
        startCfi: 'epubcfi(/6/2!/4/2)',
        endCfi: 'epubcfi(/6/2!/4/4)',
        sectionHref: 'ch1.xhtml',
        percentage: 0.5,
        atStart: false,
        atEnd: false,
      },
    });
    await settle();

    expect(onPositions.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(positions[0].left).toBe(-700 + 0 * UNIT_PX + UNIT_PX / 2);
    processor.dispose();
  });

  it('refresh() applies preference changes: traditional round-trip + pinyin toggle', async () => {
    const engine = new StubEngine();
    const view = makeView('ch1.xhtml', '这是一本测试用的中文书');
    engine.views = [view];
    const processor = new ChineseContentProcessor(engine.asEngine(), hooks());
    processor.start();
    await settle();
    expect(view.textNode.nodeValue).toBe('这是一本测试用的中文书');
    expect(positions.length).toBeGreaterThan(0);

    prefs = { forceTraditionalChinese: true, showPinyin: true };
    processor.refresh();
    await settle();
    expect(view.textNode.nodeValue).toBe('這是一本測試用的中文書');

    // Pinyin off: positions empty; the display script still applies.
    prefs = { forceTraditionalChinese: true, showPinyin: false };
    processor.refresh();
    await settle();
    expect(positions).toEqual([]);
    expect(view.textNode.nodeValue).toBe('這是一本測試用的中文書');

    // Back to simplified: byte-for-byte restore via _originalText.
    prefs = { forceTraditionalChinese: false, showPinyin: true };
    processor.refresh();
    await settle();
    expect(view.textNode.nodeValue).toBe('这是一本测试用的中文书');
    processor.dispose();
  });

  it('a superseded run abandons its writes (per-run cancellation token)', async () => {
    const engine = new StubEngine();
    engine.views = [makeView('ch1.xhtml', '你好')];
    const processor = new ChineseContentProcessor(engine.asEngine(), hooks());
    processor.start();
    await settle();

    onPositions.mockClear();
    processor.refresh(); // run A — superseded immediately…
    processor.refresh(); // …by run B
    await settle();

    // Exactly ONE emission lands: run A hit the stale-token check after its
    // first await and dropped its write.
    expect(onPositions).toHaveBeenCalledTimes(1);
    processor.dispose();
  });

  it('dispose() unsubscribes and stops in-flight passes from emitting', async () => {
    const engine = new StubEngine();
    engine.views = [makeView('ch1.xhtml', '你好')];
    const processor = new ChineseContentProcessor(engine.asEngine(), hooks());
    processor.start();
    expect(engine.listenerCount).toBe(1);

    onPositions.mockClear();
    processor.refresh();
    processor.dispose(); // before the async pass lands
    await settle();

    expect(engine.listenerCount).toBe(0);
    expect(onPositions).not.toHaveBeenCalled();
  });
});

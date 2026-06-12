/**
 * ReaderEngine conformance suite (contract C7, Phase 6 §Test plan): one
 * describe block runs against BOTH implementations —
 *
 *  - FakeReaderEngine (pure in-memory), and
 *  - EpubJsEngine over typed book/rendition doubles (jsdom; the same fixture
 *    shapes the legacy hook suites used — real epub.js cannot render inside
 *    jsdom, so the adapter logic is what this tier pins; full-renderer
 *    behavior is covered by the Playwright journeys).
 *
 * Every clause here is part of the port contract: event shape, layer
 * isolation, unsubscribe, resolver conformance, destroy idempotence.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Book, Rendition } from 'epubjs';
import { EpubJsEngine } from './EpubJsEngine';
import { FakeReaderEngine } from './FakeReaderEngine';
import type { ReaderEngine, ReaderEngineEvent } from './ReaderEngine';

interface EngineFixture {
  engine: ReaderEngine;
  /** Drives a relocation however the implementation needs. */
  relocate: () => Promise<void> | void;
  knownHref: string;
}

function makeEpubJsFixture(): EngineFixture {
  type Handler = (...args: unknown[]) => void;
  const handlers = new Map<string, Handler[]>();
  const spineItems = [
    { href: 'chapter1.xhtml', index: 0, label: undefined },
    { href: 'chapter2.xhtml', index: 1, label: undefined },
  ];
  const book = {
    spine: {
      get: (target: string | number) => {
        if (typeof target === 'number') return spineItems[target] ?? null;
        return spineItems.find((s) => target.includes(s.href.split('.')[0]) || s.href === target) ?? null;
      },
      items: spineItems,
    },
    navigation: {
      toc: [
        { id: 't1', href: 'chapter1.xhtml', label: 'One' },
        { id: 't2', href: 'chapter2.xhtml', label: 'Two' },
      ],
      get: (href: string) =>
        href === 'chapter1.xhtml' ? { id: 't1', href, label: 'One' } : undefined,
      forEach: (cb: (item: { href?: string; label?: string }) => void) => {
        cb({ href: 'chapter1.xhtml', label: 'One' });
        cb({ href: 'chapter2.xhtml', label: 'Two' });
      },
    },
    locations: {
      length: () => 100,
      percentageFromCfi: () => 0.25,
      cfiFromPercentage: () => 'epubcfi(/6/2!/4/2/1:0)',
    },
    packaging: { metadata: { language: 'en', title: 'Fixture Book' } },
    load: async () => '<html><body><p>section text</p></body></html>',
    getRange: async (cfi: string) =>
      cfi.startsWith('epubcfi(') ? (document.createRange() as Range) : null,
  } as unknown as Book;

  const container = document.createElement('div');
  let currentLocation: unknown = null;
  const rendition = {
    on: (event: string, handler: Handler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    off: (event: string, handler: Handler) => {
      handlers.set(event, (handlers.get(event) ?? []).filter((h) => h !== handler));
    },
    display: vi.fn(async (target?: string) => {
      currentLocation = {
        start: { cfi: 'epubcfi(/6/2!/4/2/1:0)', href: target ?? 'chapter1.xhtml', displayed: { page: 1, total: 2 } },
        end: { cfi: 'epubcfi(/6/2!/4/2/2:0)', href: target ?? 'chapter1.xhtml' },
        atStart: true,
        atEnd: false,
      };
      (handlers.get('relocated') ?? []).forEach((h) => h(currentLocation));
    }),
    next: vi.fn(async () => {
      (handlers.get('relocated') ?? []).forEach((h) => h(currentLocation));
    }),
    prev: vi.fn(async () => {
      (handlers.get('relocated') ?? []).forEach((h) => h(currentLocation));
    }),
    get location() {
      return currentLocation;
    },
    getRange: (cfiRange: string) => {
      if (!cfiRange.startsWith('epubcfi(')) throw new Error('bad cfi');
      const range = document.createRange();
      return range;
    },
    getContents: () => [],
    annotations: { add: vi.fn(), remove: vi.fn() },
    views: () => [],
    manager: { container, getContents: () => [] },
    hooks: { content: { register: vi.fn() } },
  } as unknown as Rendition;

  const engine = new EpubJsEngine({
    book,
    rendition,
    container,
    locationsReady: Promise.resolve(),
  });

  return {
    engine,
    relocate: () => engine.display('chapter1.xhtml'),
    knownHref: 'chapter1.xhtml',
  };
}

function makeFakeFixture(): EngineFixture {
  const engine = new FakeReaderEngine();
  return {
    engine,
    relocate: () => engine.display('chapter1.xhtml'),
    knownHref: 'chapter1.xhtml',
  };
}

function describeReaderEngineContract(name: string, makeFixture: () => EngineFixture) {
  describe(`ReaderEngine contract: ${name}`, () => {
    it('starts ready and exposes an overlay container', () => {
      const { engine } = makeFixture();
      expect(engine.status).toBe('ready');
      expect(engine.getOverlayContainer()).toBeTruthy();
    });

    it('emits relocated with the EngineLocation shape on display()', async () => {
      const { engine, relocate } = makeFixture();
      const events: ReaderEngineEvent[] = [];
      engine.subscribe((e) => events.push(e));

      await relocate();

      const relocated = events.find((e) => e.type === 'relocated');
      expect(relocated).toBeTruthy();
      if (relocated && relocated.type === 'relocated') {
        expect(typeof relocated.location.startCfi).toBe('string');
        expect(relocated.location.startCfi.startsWith('epubcfi(')).toBe(true);
        expect(typeof relocated.location.endCfi).toBe('string');
        expect(typeof relocated.location.sectionHref).toBe('string');
        expect(relocated.location.percentage).toBeGreaterThanOrEqual(0);
        expect(relocated.location.percentage).toBeLessThanOrEqual(1);
        expect(typeof relocated.location.atStart).toBe('boolean');
        expect(typeof relocated.location.atEnd).toBe('boolean');
      }
      expect(engine.currentLocation()?.startCfi).toBeTruthy();
    });

    it('unsubscribe stops event delivery', async () => {
      const { engine, relocate } = makeFixture();
      const events: ReaderEngineEvent[] = [];
      const unsubscribe = engine.subscribe((e) => events.push(e));
      unsubscribe();

      await relocate();
      expect(events).toEqual([]);
    });

    it('isolates highlight layers: tts adds never disturb annotation bookkeeping', () => {
      const { engine } = makeFixture();
      engine.highlights.add('annotation', 'epubcfi(/6/2!/4/2/1:0)', { className: 'highlight-yellow' });
      engine.highlights.add('tts', 'epubcfi(/6/2!/4/2/2:0)', {});

      expect(engine.highlights.count('annotation')).toBe(1);
      expect(engine.highlights.count('tts')).toBe(1);

      engine.highlights.remove('tts', 'epubcfi(/6/2!/4/2/2:0)');
      expect(engine.highlights.count('annotation')).toBe(1);
      expect(engine.highlights.count('tts')).toBe(0);
    });

    it('resolveSection() resolves known hrefs and rejects unknowns', () => {
      const { engine, knownHref } = makeFixture();
      const resolved = engine.resolveSection(knownHref);
      expect(resolved).toBeTruthy();
      expect(resolved?.href).toBe(knownHref);
      expect(resolved?.index).toBeGreaterThanOrEqual(0);
      expect(engine.resolveSection('definitely-not-a-section.xhtml')).toBeNull();
    });

    it('getNavLabel() yields a human label for a known section', () => {
      const { engine, knownHref } = makeFixture();
      const label = engine.getNavLabel(knownHref);
      expect(typeof label).toBe('string');
      expect((label ?? '').length).toBeGreaterThan(0);
    });

    it('loadSectionText() returns section text without rendering', async () => {
      const { engine, knownHref } = makeFixture();
      const text = await engine.loadSectionText(knownHref);
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);
    });

    it('locations facade: ready resolves; percentage and cfi mapping are total', async () => {
      const { engine } = makeFixture();
      await engine.locations.whenReady();
      expect(engine.locations.ready).toBe(true);
      expect(engine.locations.length()).toBeGreaterThan(0);
      const p = engine.locations.percentageFromCfi('epubcfi(/6/2!/4/2/1:0)');
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      expect(typeof engine.locations.cfiFromPercentage(0.5)).toBe('string');
    });

    it('CfiRangeResolver conformance: getRange resolves valid CFIs, null otherwise', async () => {
      const { engine } = makeFixture();
      expect(await engine.getRange('epubcfi(/6/2!/4/2/1:0)')).not.toBeNull();
      expect(await engine.getRange('not-a-cfi')).toBeNull();
    });

    it('selection utilities never throw', () => {
      const { engine } = makeFixture();
      expect(() => engine.selectRange('epubcfi(/6/2!/4/2/1:0)')).not.toThrow();
      expect(() => engine.clearSelection()).not.toThrow();
    });

    it('destroy() is idempotent, silences events, and resolver returns null', async () => {
      const { engine, relocate } = makeFixture();
      const events: ReaderEngineEvent[] = [];
      engine.subscribe((e) => events.push(e));

      engine.destroy();
      engine.destroy(); // idempotent

      await relocate();
      expect(events).toEqual([]);
      expect(engine.status).toBe('idle');
      expect(await engine.getRange('epubcfi(/6/2!/4/2/1:0)')).toBeNull();
    });
  });
}

describeReaderEngineContract('FakeReaderEngine', makeFakeFixture);
describeReaderEngineContract('EpubJsEngine (jsdom doubles)', makeEpubJsFixture);

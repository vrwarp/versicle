/**
 * `EpubJsEngine` unit suite — the C7 port over a duck-typed book/rendition
 * pair.
 *
 * The engine is the tree's only epub.js importer, and almost every method is
 * a guard around an upstream call that is typed more optimistically than it
 * behaves (`location` before the first display, `spine` deleted at destroy,
 * `navigation` undefined until it loads, `getContents()` returning an array
 * where the types say one). Those guards are the behavior worth pinning, so
 * the fakes here deliberately reproduce the awkward runtime shapes rather
 * than the declared ones.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Book, Contents, Rendition } from 'epubjs';
import type { ReaderEngineEvent } from './ReaderEngine';
import { EpubJsEngine, createEpubJsBook } from './EpubJsEngine';

const ePubFactory = vi.fn(() => ({ mocked: true }));
vi.mock('epubjs', () => ({
  default: (...args: unknown[]) => ePubFactory(...(args as [])),
}));

// ── fakes ──────────────────────────────────────────────────────────────────

type Handlers = Record<string, Array<(...args: unknown[]) => void>>;

interface FakeRendition {
  handlers: Handlers;
  contentHooks: Array<(c: Contents) => void>;
  offCalls: string[];
  fire(event: string, ...args: unknown[]): void;
  [key: string]: unknown;
}

const makeRendition = (over: Record<string, unknown> = {}): FakeRendition => {
  const handlers: Handlers = {};
  const contentHooks: Array<(c: Contents) => void> = [];
  const offCalls: string[] = [];
  const r: FakeRendition = {
    handlers,
    contentHooks,
    offCalls,
    annotations: { add: vi.fn(), remove: vi.fn() },
    views: () => [],
    display: vi.fn(async () => undefined),
    next: vi.fn(async () => undefined),
    prev: vi.fn(async () => undefined),
    location: undefined,
    getRange: vi.fn(() => null),
    getContents: () => [],
    manager: { container: null, getContents: () => [] },
    hooks: {
      content: {
        register: (fn: (c: Contents) => void) => contentHooks.push(fn),
      },
    },
    on: (event: string, handler: (...a: unknown[]) => void) => {
      (handlers[event] ??= []).push(handler);
    },
    off: (event: string) => {
      offCalls.push(event);
    },
    fire: (event, ...args) => {
      for (const h of handlers[event] ?? []) h(...args);
    },
    ...over,
  };
  return r;
};

const makeBook = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  navigation: { toc: [], get: () => undefined, forEach: () => undefined },
  spine: { get: () => undefined, items: [] },
  locations: {
    length: () => 0,
    percentageFromCfi: () => 0,
    cfiFromPercentage: () => '',
  },
  load: async () => '',
  packaging: { metadata: {} },
  getRange: async () => null,
  ...over,
});

interface Built {
  engine: EpubJsEngine;
  rendition: FakeRendition;
  book: Record<string, unknown>;
  container: HTMLElement;
  events: ReaderEngineEvent[];
  resolveLocations: () => void;
}

const build = (
  opts: { book?: Record<string, unknown>; rendition?: Record<string, unknown> } = {}
): Built => {
  const rendition = makeRendition(opts.rendition);
  const book = makeBook(opts.book);
  const container = document.createElement('div');
  let resolveLocations!: () => void;
  const locationsReady = new Promise<void>((r) => {
    resolveLocations = r;
  });
  const engine = new EpubJsEngine({
    book: book as unknown as Book,
    rendition: rendition as unknown as Rendition,
    container,
    locationsReady,
  });
  const events: ReaderEngineEvent[] = [];
  engine.subscribe((e) => events.push(e));
  return { engine, rendition, book, container, events, resolveLocations };
};

const locationAt = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  start: { cfi: 'epubcfi(/6/2!/4/2/1:0)', href: 'ch1.xhtml', displayed: { page: 1, total: 10 } },
  end: { cfi: 'epubcfi(/6/2!/4/2/1:40)' },
  atStart: false,
  atEnd: false,
  ...over,
});

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  ePubFactory.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createEpubJsBook', () => {
  it('is the one runtime entry into epub.js book construction', () => {
    const data = new ArrayBuffer(8);

    const book = createEpubJsBook(data);

    expect(ePubFactory).toHaveBeenCalledWith(data);
    expect(book).toEqual({ mocked: true });
  });

  it('passes a Blob through unwidened', () => {
    const blob = new Blob(['x']);

    createEpubJsBook(blob);

    expect(ePubFactory).toHaveBeenCalledWith(blob);
  });
});

describe('EpubJsEngine — lifecycle', () => {
  it('starts ready and exposes a highlight manager', () => {
    const { engine } = build();

    expect(engine.status).toBe('ready');
    expect(engine.highlights).toBeDefined();
  });

  it('goes idle on destroy and detaches every wired rendition event', () => {
    const { engine, rendition } = build();

    engine.destroy();

    expect(engine.status).toBe('idle');
    expect(new Set(rendition.offCalls)).toEqual(
      new Set(['relocated', 'selected', 'click', 'keydown', 'resized', 'removed'])
    );
  });

  it('is idempotent — a second destroy detaches nothing further', () => {
    const { engine, rendition } = build();

    engine.destroy();
    const after = rendition.offCalls.length;
    engine.destroy();

    expect(rendition.offCalls).toHaveLength(after);
  });

  it('survives a detach that throws (rendition already torn down)', () => {
    const { engine } = build({
      rendition: {
        off: () => {
          throw new Error('already gone');
        },
      },
    });

    expect(() => engine.destroy()).not.toThrow();
    expect(engine.status).toBe('idle');
  });

  it('stops notifying subscribers after destroy', () => {
    const { engine, rendition, events } = build();

    engine.destroy();
    rendition.fire('resized');

    expect(events).toEqual([]);
  });

  it('warns instead of throwing when a rendition refuses subscription', () => {
    expect(() =>
      build({
        rendition: {
          on: () => {
            throw new Error('no events here');
          },
        },
      })
    ).not.toThrow();
  });
});

describe('EpubJsEngine — the locations facade', () => {
  it('is not ready until the registry promise settles, then announces once', async () => {
    const { engine, events, resolveLocations } = build();

    expect(engine.locations.ready).toBe(false);

    resolveLocations();
    await engine.locations.whenReady();

    expect(engine.locations.ready).toBe(true);
    expect(events).toEqual([{ type: 'locationsReady' }]);
  });

  it('stays silent when the registry lands AFTER destroy', async () => {
    const { engine, events, resolveLocations } = build();

    engine.destroy();
    resolveLocations();
    await engine.locations.whenReady();

    expect(events).toEqual([]);
    expect(engine.locations.ready).toBe(false);
  });

  it('forwards length / percentageFromCfi / cfiFromPercentage to the book', () => {
    const { engine } = build({
      book: {
        locations: {
          length: () => 120,
          percentageFromCfi: (cfi: string) => (cfi === 'here' ? 0.42 : 0),
          cfiFromPercentage: (p: number) => `cfi@${p}`,
        },
      },
    });

    expect(engine.locations.length()).toBe(120);
    expect(engine.locations.percentageFromCfi('here')).toBe(0.42);
    expect(engine.locations.cfiFromPercentage(0.5)).toBe('cfi@0.5');
  });

  it('substitutes empty answers when the registry is not generated yet', () => {
    const boom = () => {
      throw new Error('locations not generated');
    };
    const { engine } = build({
      book: {
        locations: { length: boom, percentageFromCfi: boom, cfiFromPercentage: boom },
      },
    });

    expect(engine.locations.length()).toBe(0);
    expect(engine.locations.percentageFromCfi('x')).toBe(0);
    expect(engine.locations.cfiFromPercentage(0.5)).toBe('');
  });

  it('substitutes empty answers when the registry returns nullish', () => {
    const { engine } = build({
      book: {
        locations: {
          length: () => undefined,
          percentageFromCfi: () => undefined,
          cfiFromPercentage: () => undefined,
        },
      },
    });

    expect(engine.locations.length()).toBe(0);
    expect(engine.locations.percentageFromCfi('x')).toBe(0);
    expect(engine.locations.cfiFromPercentage(0.5)).toBe('');
  });
});

describe('EpubJsEngine — navigation', () => {
  it('delegates display/next/prev and always yields a promise', async () => {
    const { engine, rendition } = build({
      rendition: { display: vi.fn(() => undefined), next: vi.fn(() => undefined), prev: vi.fn(() => undefined) },
    });

    await expect(engine.display('ch2.xhtml')).resolves.toBeUndefined();
    await expect(engine.next()).resolves.toBeUndefined();
    await expect(engine.prev()).resolves.toBeUndefined();

    expect(rendition.display).toHaveBeenCalledWith('ch2.xhtml');
    expect(rendition.next).toHaveBeenCalled();
    expect(rendition.prev).toHaveBeenCalled();
  });
});

describe('EpubJsEngine — currentLocation', () => {
  it('is null before the first display resolves', () => {
    expect(build().engine.currentLocation()).toBeNull();
  });

  it('is null for a location with no start', () => {
    const { engine } = build({ rendition: { location: { end: { cfi: 'x' } } } });

    expect(engine.currentLocation()).toBeNull();
  });

  it('projects the epub.js location onto the port shape', () => {
    const { engine } = build({
      rendition: { location: locationAt({ atStart: true, atEnd: false }) },
      book: { locations: { percentageFromCfi: () => 0.25, length: () => 1, cfiFromPercentage: () => '' } },
    });

    expect(engine.currentLocation()).toEqual({
      startCfi: 'epubcfi(/6/2!/4/2/1:0)',
      endCfi: 'epubcfi(/6/2!/4/2/1:40)',
      sectionHref: 'ch1.xhtml',
      percentage: 0.25,
      atStart: true,
      atEnd: false,
      displayed: { page: 1, total: 10 },
    });
  });

  it('falls back to the start CFI when the location has no end', () => {
    const { engine } = build({ rendition: { location: locationAt({ end: undefined }) } });

    expect(engine.currentLocation()?.endCfi).toBe('epubcfi(/6/2!/4/2/1:0)');
  });

  it('reports 0% rather than failing when the registry is not generated', () => {
    const { engine } = build({
      rendition: { location: locationAt() },
      book: {
        locations: {
          percentageFromCfi: () => {
            throw new Error('no registry');
          },
          length: () => 0,
          cfiFromPercentage: () => '',
        },
      },
    });

    expect(engine.currentLocation()?.percentage).toBe(0);
  });

  it('coerces the boundary flags to real booleans', () => {
    const { engine } = build({
      rendition: { location: locationAt({ atStart: undefined, atEnd: 1 }) },
    });

    expect(engine.currentLocation()).toMatchObject({ atStart: false, atEnd: true });
  });
});

describe('EpubJsEngine — subscribe / emit', () => {
  it('the returned handle unsubscribes exactly that listener', () => {
    const { engine, rendition } = build();
    const a: ReaderEngineEvent[] = [];
    const b: ReaderEngineEvent[] = [];
    const offA = engine.subscribe((e) => a.push(e));
    engine.subscribe((e) => b.push(e));

    offA();
    rendition.fire('resized');

    expect(a).toEqual([]);
    expect(b).toEqual([{ type: 'resized' }]);
  });

  it('one throwing listener does not starve the others', () => {
    const { engine, rendition } = build();
    const seen: ReaderEngineEvent[] = [];
    engine.subscribe(() => {
      throw new Error('bad subscriber');
    });
    engine.subscribe((e) => seen.push(e));

    rendition.fire('resized');

    expect(seen).toEqual([{ type: 'resized' }]);
  });
});

describe('EpubJsEngine — geometry', () => {
  const makeRange = (rects: DOMRect[] = [{} as DOMRect]): Range =>
    ({ getClientRects: () => rects as unknown as DOMRectList }) as unknown as Range;

  it('getRange resolves through the book', async () => {
    const range = makeRange();
    const { engine } = build({ book: { getRange: async () => range } });

    await expect(engine.getRange('cfi')).resolves.toBe(range);
  });

  it('getRange is null after destroy — the book may already be gone', async () => {
    const { engine } = build({ book: { getRange: async () => makeRange() } });

    engine.destroy();

    await expect(engine.getRange('cfi')).resolves.toBeNull();
  });

  it('getRange is null once epub.js has deleted the spine', async () => {
    const { engine } = build({ book: { spine: undefined, getRange: async () => makeRange() } });

    await expect(engine.getRange('cfi')).resolves.toBeNull();
  });

  it('getRange swallows a rejecting lookup', async () => {
    const { engine } = build({
      book: {
        getRange: async () => {
          throw new Error('bad cfi');
        },
      },
    });

    await expect(engine.getRange('cfi')).resolves.toBeNull();
  });

  it('getRange normalizes an undefined result to null', async () => {
    const { engine } = build({ book: { getRange: async () => undefined } });

    await expect(engine.getRange('cfi')).resolves.toBeNull();
  });

  it('getRenderedRange delegates to the rendition and normalizes/absorbs failure', () => {
    const range = makeRange();
    const ok = build({ rendition: { getRange: () => range } });
    const nullish = build({ rendition: { getRange: () => undefined } });
    const throwing = build({
      rendition: {
        getRange: () => {
          throw new Error('offscreen');
        },
      },
    });

    expect(ok.engine.getRenderedRange('cfi')).toBe(range);
    expect(nullish.engine.getRenderedRange('cfi')).toBeNull();
    expect(throwing.engine.getRenderedRange('cfi')).toBeNull();
  });

  it('getRangeRects returns the rects plus the iframe offset', () => {
    const iframe = document.createElement('iframe');
    Object.defineProperty(iframe, 'offsetTop', { value: 30 });
    Object.defineProperty(iframe, 'offsetLeft', { value: 12 });
    const overlay = document.createElement('div');
    overlay.appendChild(iframe);
    const rects = [{} as DOMRect];
    const { engine } = build({
      rendition: { getRange: () => makeRange(rects), manager: { container: overlay } },
    });

    expect(engine.getRangeRects('cfi')).toEqual({
      rects,
      iframeOffset: { top: 30, left: 12 },
    });
  });

  it('getRangeRects is null when the range is not rendered', () => {
    const { engine } = build({ rendition: { getRange: () => null } });

    expect(engine.getRangeRects('cfi')).toBeNull();
  });

  it('getRangeRects is null for an EMPTY rect list', () => {
    const { engine } = build({ rendition: { getRange: () => makeRange([]) } });

    expect(engine.getRangeRects('cfi')).toBeNull();
  });

  it('getRangeRects is null when measuring throws', () => {
    const range = {
      getClientRects: () => {
        throw new Error('detached');
      },
    } as unknown as Range;
    const { engine } = build({ rendition: { getRange: () => range } });

    expect(engine.getRangeRects('cfi')).toBeNull();
  });

  it('reports a zero offset when the overlay holds no iframe', () => {
    const overlay = document.createElement('div');
    const { engine } = build({
      rendition: { getRange: () => makeRange(), manager: { container: overlay } },
    });

    expect(engine.getRangeRects('cfi')?.iframeOffset).toEqual({ top: 0, left: 0 });
  });

  it('getOverlayContainer exposes the manager container, or null', () => {
    const overlay = document.createElement('div');

    expect(build({ rendition: { manager: { container: overlay } } }).engine.getOverlayContainer()).toBe(
      overlay
    );
    expect(build({ rendition: { manager: undefined } }).engine.getOverlayContainer()).toBeNull();
    expect(build({ rendition: { manager: { container: null } } }).engine.getOverlayContainer()).toBeNull();
  });
});

describe('EpubJsEngine — content views', () => {
  const makeContents = (over: Record<string, unknown> = {}): Contents =>
    ({
      document: document.implementation.createHTMLDocument('c'),
      window: { frameElement: null },
      sectionIndex: 0,
      cfiFromRange: (r: Range) => `cfi-for-${(r as unknown as { id: string }).id}`,
      ...over,
    }) as unknown as Contents;

  it('projects each live content into the port shape', () => {
    const contents = makeContents();
    const { engine } = build({
      rendition: { getContents: () => [contents] },
      book: { spine: { get: (i: number) => ({ href: `ch${i}.xhtml` }), items: [] } },
    });

    const views = engine.getContentViews();

    expect(views).toHaveLength(1);
    expect(views[0].sectionHref).toBe('ch0.xhtml');
    expect(views[0].document).toBe(contents.document);
    expect(views[0].cfiFromRange({ id: 'r1' } as unknown as Range)).toBe('cfi-for-r1');
  });

  it('drops entries with no document (a view mid-teardown)', () => {
    const { engine } = build({
      rendition: { getContents: () => [null, { document: null }, makeContents()] },
    });

    expect(engine.getContentViews()).toHaveLength(1);
  });

  it('is an empty list when the manager is gone', () => {
    const { engine } = build({
      rendition: {
        getContents: () => {
          throw new Error('no manager');
        },
      },
    });

    expect(engine.getContentViews()).toEqual([]);
  });

  it('is an empty list when getContents returns nothing at all', () => {
    const { engine } = build({ rendition: { getContents: () => undefined } });

    expect(engine.getContentViews()).toEqual([]);
  });

  it('leaves the section href blank when the spine lookup fails', () => {
    const { engine } = build({
      rendition: { getContents: () => [makeContents()] },
      book: {
        spine: {
          get: () => {
            throw new Error('spine gone');
          },
        },
      },
    });

    expect(engine.getContentViews()[0].sectionHref).toBe('');
  });

  it('reads the iframe offset off the content window frame element', () => {
    const iframe = document.createElement('iframe');
    Object.defineProperty(iframe, 'offsetTop', { value: 7 });
    Object.defineProperty(iframe, 'offsetLeft', { value: 3 });
    const { engine } = build({
      rendition: { getContents: () => [makeContents({ window: { frameElement: iframe } })] },
    });

    expect(engine.getContentViews()[0].iframeOffset).toEqual({ top: 7, left: 3 });
  });
});

describe('EpubJsEngine — structure', () => {
  it('getToc returns the navigation toc, or an empty list before it loads', () => {
    const toc = [{ id: '1', href: 'a', label: 'A', subitems: [] }];

    expect(build({ book: { navigation: { toc } } }).engine.getToc()).toBe(toc);
    expect(build({ book: { navigation: undefined } }).engine.getToc()).toEqual([]);
    expect(build({ book: { navigation: { toc: undefined } } }).engine.getToc()).toEqual([]);
  });

  it('resolveSection reports href, index and label', () => {
    const { engine } = build({
      book: { spine: { get: () => ({ href: 'ch3.xhtml', index: 2, label: 'Three' }), items: [] } },
    });

    expect(engine.resolveSection('ch3.xhtml')).toEqual({
      href: 'ch3.xhtml',
      index: 2,
      label: 'Three',
    });
  });

  it('resolveSection falls back to the spine position when index is absent', () => {
    const item = { href: 'ch3.xhtml' };
    const { engine } = build({
      book: { spine: { get: () => item, items: [{ href: 'a' }, item] } },
    });

    expect(engine.resolveSection('ch3.xhtml')?.index).toBe(1);
  });

  it('resolveSection reports -1 when neither index nor items can place it', () => {
    const { engine } = build({
      book: { spine: { get: () => ({ href: 'ch3.xhtml' }), items: undefined } },
    });

    expect(engine.resolveSection('ch3.xhtml')?.index).toBe(-1);
  });

  it('resolveSection blanks a missing href rather than reporting undefined', () => {
    const { engine } = build({ book: { spine: { get: () => ({ index: 0 }), items: [] } } });

    expect(engine.resolveSection('x')?.href).toBe('');
  });

  it('resolveSection is null for an unknown or unresolvable target', () => {
    expect(build().engine.resolveSection('nope')).toBeNull();
    expect(
      build({
        book: {
          spine: {
            get: () => {
              throw new Error('bad cfi');
            },
          },
        },
      }).engine.resolveSection('nope')
    ).toBeNull();
  });
});

describe('EpubJsEngine.getNavLabel — the label cascade', () => {
  const withNav = (
    section: unknown,
    nav: Record<string, unknown> | undefined,
    items: unknown[] = []
  ) =>
    build({
      book: {
        spine: { get: (t: unknown) => (typeof t === 'string' ? section : section), items },
        navigation: nav,
      },
    }).engine;

  it('prefers the navigation label for the section href', () => {
    const engine = withNav({ href: 'ch1.xhtml', index: 0 }, {
      get: (href: string) => (href === 'ch1.xhtml' ? { label: '  Down the Rabbit-Hole  ' } : undefined),
      forEach: () => undefined,
    });

    expect(engine.getNavLabel('ch1.xhtml')).toBe('Down the Rabbit-Hole');
  });

  it("rejects the generic 'Chapter' label and falls through", () => {
    const engine = withNav({ href: 'ch1.xhtml', index: 4 }, {
      get: () => ({ label: ' Chapter ' }),
      forEach: () => undefined,
    });

    expect(engine.getNavLabel('ch1.xhtml')).toBe('Chapter 5');
  });

  it('scans the nav tree by SPINE INDEX when the href lookup misses', () => {
    // The scan matches a nav item by resolving ITS href back to a spine
    // index — only the entry landing on our index supplies the label.
    const engine = build({
      book: {
        spine: {
          get: (t: string) => (t === 'ch2.xhtml' ? { href: 'ch2.xhtml', index: 1 } : { index: 9 }),
          items: [],
        },
        navigation: {
          get: () => undefined,
          forEach: (fn: (i: Record<string, unknown>) => void) => {
            fn({ href: 'other.xhtml', label: 'Other' });
            fn({ href: 'ch2.xhtml#frag', label: '  A Caucus-Race  ' });
          },
        },
      },
    }).engine;

    expect(engine.getNavLabel('ch2.xhtml')).toBe('A Caucus-Race');
  });

  it('takes the LAST nav item matching the spine index when several do', () => {
    const engine = build({
      book: {
        spine: { get: () => ({ href: 'ch2.xhtml', index: 1 }), items: [] },
        navigation: {
          get: () => undefined,
          forEach: (fn: (i: Record<string, unknown>) => void) => {
            fn({ href: 'ch2.xhtml', label: 'First Match' });
            fn({ href: 'ch2.xhtml', label: 'Last Match' });
          },
        },
      },
    }).engine;

    expect(engine.getNavLabel('ch2.xhtml')).toBe('Last Match');
  });

  it('strips the fragment before resolving a nav href back to the spine', () => {
    const seen: string[] = [];
    const engine = build({
      book: {
        spine: {
          get: (t: string) => {
            seen.push(t);
            return { href: 'ch2.xhtml', index: 1 };
          },
          items: [],
        },
        navigation: {
          get: () => undefined,
          forEach: (fn: (i: Record<string, unknown>) => void) =>
            fn({ href: 'ch2.xhtml#section-3', label: 'Named' }),
        },
      },
    }).engine;

    expect(engine.getNavLabel('ch2.xhtml')).toBe('Named');
    expect(seen).toContain('ch2.xhtml');
    expect(seen).not.toContain('ch2.xhtml#section-3');
  });

  it('skips a nav item with no href during the scan', () => {
    const engine = build({
      book: {
        spine: { get: () => ({ href: 'ch1.xhtml', index: 0 }), items: [] },
        navigation: {
          get: () => undefined,
          forEach: (fn: (i: Record<string, unknown>) => void) => fn({ label: 'Hrefless' }),
        },
      },
    }).engine;

    expect(engine.getNavLabel('ch1.xhtml')).toBe('Chapter 1');
  });

  it("falls back to a 1-based positional name, and rejects a scanned 'Chapter'", () => {
    const engine = withNav({ href: 'ch1.xhtml', index: 2 }, {
      get: () => undefined,
      forEach: (fn: (i: Record<string, unknown>) => void) => fn({ href: 'ch1.xhtml', label: 'Chapter' }),
    });

    expect(engine.getNavLabel('ch1.xhtml')).toBe('Chapter 3');
  });

  it('uses the spine ITEMS position when the section carries no index', () => {
    const section = { href: 'ch2.xhtml' };
    const engine = build({
      book: {
        spine: { get: () => section, items: [{ href: 'ch1.xhtml' }, section] },
        navigation: undefined,
      },
    }).engine;

    expect(engine.getNavLabel('ch2.xhtml')).toBe('Chapter 2');
  });

  it('is null when the section cannot be placed at all', () => {
    const engine = build({
      book: { spine: { get: () => ({ href: 'ghost.xhtml' }), items: undefined }, navigation: undefined },
    }).engine;

    expect(engine.getNavLabel('ghost.xhtml')).toBeNull();
  });

  it('is null for an unknown target, and for a throwing spine lookup', () => {
    expect(build().engine.getNavLabel('nope')).toBeNull();
    expect(
      build({
        book: {
          spine: {
            get: () => {
              throw new Error('bad cfi');
            },
          },
        },
      }).engine.getNavLabel('nope')
    ).toBeNull();
  });

  it('works with no navigation at all', () => {
    const engine = build({
      book: { spine: { get: () => ({ href: 'ch1.xhtml', index: 0 }), items: [] }, navigation: undefined },
    }).engine;

    expect(engine.getNavLabel('ch1.xhtml')).toBe('Chapter 1');
  });
});

describe('EpubJsEngine.loadSectionText', () => {
  it('parses an HTML string payload and returns its text', async () => {
    const { engine } = build({
      book: { load: async () => '<html><body><p>Hello there</p></body></html>' },
    });

    await expect(engine.loadSectionText('ch1.xhtml')).resolves.toContain('Hello there');
  });

  it('strips the fragment before asking the book to load', async () => {
    const asked: string[] = [];
    const { engine } = build({
      book: {
        load: async (h: string) => {
          asked.push(h);
          return '<html><body>x</body></html>';
        },
      },
    });

    await engine.loadSectionText('ch1.xhtml#para-4');

    expect(asked).toEqual(['ch1.xhtml']);
  });

  it('accepts a Document payload directly', async () => {
    const doc = document.implementation.createHTMLDocument('d');
    doc.body.textContent = 'already parsed';
    const { engine } = build({ book: { load: async () => doc } });

    await expect(engine.loadSectionText('ch1.xhtml')).resolves.toBe('already parsed');
  });

  it('prefers innerText when the environment provides it', async () => {
    const doc = document.implementation.createHTMLDocument('d');
    doc.body.textContent = 'text content';
    Object.defineProperty(doc.body, 'innerText', { value: 'rendered text', configurable: true });
    const { engine } = build({ book: { load: async () => doc } });

    await expect(engine.loadSectionText('ch1.xhtml')).resolves.toBe('rendered text');
  });

  it('is empty for a payload that is neither string nor object', async () => {
    const { engine } = build({ book: { load: async () => undefined } });

    await expect(engine.loadSectionText('ch1.xhtml')).resolves.toBe('');
  });

  it('is empty for a document with no text', async () => {
    const { engine } = build({ book: { load: async () => '<html><body></body></html>' } });

    await expect(engine.loadSectionText('ch1.xhtml')).resolves.toBe('');
  });
});

describe('EpubJsEngine.getLanguage', () => {
  it('reports a declared language', () => {
    expect(
      build({ book: { packaging: { metadata: { language: 'fr' } } } }).engine.getLanguage()
    ).toBe('fr');
  });

  it('is undefined when unset, blank, non-string, or the book has not opened', () => {
    expect(build({ book: { packaging: { metadata: {} } } }).engine.getLanguage()).toBeUndefined();
    expect(
      build({ book: { packaging: { metadata: { language: '' } } } }).engine.getLanguage()
    ).toBeUndefined();
    expect(
      build({ book: { packaging: { metadata: { language: 42 } } } }).engine.getLanguage()
    ).toBeUndefined();
    expect(build({ book: { packaging: undefined } }).engine.getLanguage()).toBeUndefined();
  });
});

describe('EpubJsEngine — selection', () => {
  const makeSelectionWindow = () => {
    const removeAllRanges = vi.fn();
    const addRange = vi.fn();
    const win = {
      getSelection: () => ({ removeAllRanges, addRange }),
    } as unknown as Window;
    return { win, removeAllRanges, addRange };
  };

  it('selectRange marks the mutation programmatic, clears, then applies the range', () => {
    const { win, removeAllRanges, addRange } = makeSelectionWindow();
    const range = {} as Range;
    const { engine } = build({
      rendition: {
        getRange: () => range,
        manager: { container: null, getContents: () => [{ window: win }] },
      },
    });

    engine.selectRange('cfi');

    expect(
      (win as unknown as { __versicleProgrammaticSelectionAt?: number })
        .__versicleProgrammaticSelectionAt
    ).toEqual(expect.any(Number));
    expect(removeAllRanges).toHaveBeenCalled();
    expect(addRange).toHaveBeenCalledWith(range);
  });

  it('selectRange does nothing when the range is not on screen', () => {
    const { win, addRange } = makeSelectionWindow();
    const { engine } = build({
      rendition: {
        getRange: () => null,
        manager: { container: null, getContents: () => [{ window: win }] },
      },
    });

    engine.selectRange('cfi');

    expect(addRange).not.toHaveBeenCalled();
  });

  it('selectRange does nothing when no content window is attached', () => {
    const { engine } = build({
      rendition: { getRange: () => ({}) as Range, manager: { container: null, getContents: () => [] } },
    });

    expect(() => engine.selectRange('cfi')).not.toThrow();
  });

  it('selectRange swallows a failure mid-teardown', () => {
    const { engine } = build({
      rendition: {
        getRange: () => ({}) as Range,
        manager: {
          container: null,
          getContents: () => {
            throw new Error('gone');
          },
        },
      },
    });

    expect(() => engine.selectRange('cfi')).not.toThrow();
  });

  it('clearSelection collapses the selection in the container iframe — WITHOUT arming the flag', () => {
    const removeAllRanges = vi.fn();
    const { engine, container } = build();
    const iframe = document.createElement('iframe');
    container.appendChild(iframe);
    const contentWindow = { getSelection: () => ({ removeAllRanges }) };
    Object.defineProperty(iframe, 'contentWindow', { value: contentWindow });

    engine.clearSelection();

    expect(removeAllRanges).toHaveBeenCalledTimes(1);
    expect(
      (contentWindow as { __versicleProgrammaticSelectionAt?: number })
        .__versicleProgrammaticSelectionAt
    ).toBeUndefined();
  });

  it('clearSelection is a no-op with no iframe, and swallows a teardown race', () => {
    const { engine, container } = build();

    expect(() => engine.clearSelection()).not.toThrow();

    const iframe = document.createElement('iframe');
    container.appendChild(iframe);
    Object.defineProperty(iframe, 'contentWindow', {
      get() {
        throw new Error('detached');
      },
    });
    expect(() => engine.clearSelection()).not.toThrow();
  });
});

describe('EpubJsEngine — rendition event forwarding', () => {
  it('relocated republishes the projected location', () => {
    const { rendition, events } = build();

    rendition.fire('relocated', locationAt());

    expect(events).toEqual([
      {
        type: 'relocated',
        location: expect.objectContaining({ startCfi: 'epubcfi(/6/2!/4/2/1:0)', sectionHref: 'ch1.xhtml' }),
      },
    ]);
  });

  it('selected carries the live range and the originating view', () => {
    const range = {} as Range;
    const contents = {
      document: document.implementation.createHTMLDocument('c'),
      window: { frameElement: null },
      sectionIndex: 0,
      cfiFromRange: () => 'cfi',
    };
    const { rendition, events } = build({ rendition: { getRange: () => range } });

    rendition.fire('selected', 'epubcfi(range)', contents);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'selected', cfiRange: 'epubcfi(range)', range });
    expect((events[0] as { view: unknown }).view).toMatchObject({ document: contents.document });
  });

  it('selected with no live range is DROPPED', () => {
    const { rendition, events } = build({ rendition: { getRange: () => null } });

    rendition.fire('selected', 'epubcfi(range)', {});

    expect(events).toEqual([]);
  });

  it('selected without usable contents reports a null view', () => {
    const { rendition, events } = build({ rendition: { getRange: () => ({}) as Range } });

    rendition.fire('selected', 'epubcfi(range)', undefined);

    expect((events[0] as { view: unknown }).view).toBeNull();
  });

  it('click and keydown forward the raw DOM events', () => {
    const { rendition, events } = build();
    const click = new MouseEvent('click');
    const keydown = new KeyboardEvent('keydown', { key: 'j' });

    rendition.fire('click', click);
    rendition.fire('keydown', keydown);

    expect(events).toEqual([
      { type: 'click', event: click },
      { type: 'keydown', event: keydown },
    ]);
  });

  it('resized is forwarded bare', () => {
    const { rendition, events } = build();

    rendition.fire('resized');

    expect(events).toEqual([{ type: 'resized' }]);
  });

  it('removed announces the destroyed section by href', () => {
    const { rendition, events } = build();

    rendition.fire('removed', { href: 'ch1.xhtml' });

    expect(events).toEqual([{ type: 'contentDestroyed', sectionHref: 'ch1.xhtml' }]);
  });

  it('removed is silent for a section with no usable href', () => {
    const { rendition, events } = build();

    rendition.fire('removed', undefined);
    rendition.fire('removed', {});
    rendition.fire('removed', { href: '' });
    rendition.fire('removed', { href: 7 });

    expect(events).toEqual([]);
  });
});

describe('EpubJsEngine — the content hook', () => {
  const contentsWithIframe = (): { contents: Contents; iframe: HTMLIFrameElement } => {
    const iframe = document.createElement('iframe');
    const contents = {
      document: document.implementation.createHTMLDocument('c'),
      window: { frameElement: iframe },
      sectionIndex: 0,
      cfiFromRange: () => 'cfi',
    } as unknown as Contents;
    return { contents, iframe };
  };

  it('names the iframe for screen readers from the book title', () => {
    const { rendition } = build({ book: { packaging: { metadata: { title: 'Alice' } } } });
    const { contents, iframe } = contentsWithIframe();

    rendition.contentHooks[0](contents);

    expect(iframe.getAttribute('title')).toBe('Alice');
  });

  it('falls back to a generic name when the book has no usable title', () => {
    const { contents, iframe } = contentsWithIframe();
    build({ book: { packaging: { metadata: { title: '' } } } }).rendition.contentHooks[0](contents);
    expect(iframe.getAttribute('title')).toBe('Book content');

    const second = contentsWithIframe();
    build({ book: { packaging: { metadata: { title: 42 } } } }).rendition.contentHooks[0](
      second.contents
    );
    expect(second.iframe.getAttribute('title')).toBe('Book content');
  });

  it('never overwrites a title that is already set', () => {
    const { contents, iframe } = contentsWithIframe();
    iframe.setAttribute('title', 'Set by someone else');

    build({ book: { packaging: { metadata: { title: 'Alice' } } } }).rendition.contentHooks[0](
      contents
    );

    expect(iframe.getAttribute('title')).toBe('Set by someone else');
  });

  it('announces the rendered view', () => {
    const { rendition, events } = build();
    const { contents } = contentsWithIframe();

    rendition.contentHooks[0](contents);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'contentRendered' });
    expect((events[0] as { view: { document: unknown } }).view.document).toBe(contents.document);
  });

  it('ignores a hook firing with no document', () => {
    const { rendition, events } = build();

    rendition.contentHooks[0](undefined as unknown as Contents);
    rendition.contentHooks[0]({ document: null } as unknown as Contents);

    expect(events).toEqual([]);
  });

  it('still announces the view when naming the iframe fails', () => {
    const { rendition, events } = build();
    const { contents, iframe } = contentsWithIframe();
    vi.spyOn(iframe, 'getAttribute').mockImplementation(() => {
      throw new Error('cross-origin');
    });

    expect(() => rendition.contentHooks[0](contents)).not.toThrow();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'contentRendered' });
  });

  it('tolerates a rendition with no content-hook surface', () => {
    expect(() => build({ rendition: { hooks: undefined } })).not.toThrow();
  });
});

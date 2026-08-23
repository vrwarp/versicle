/**
 * `styleSampling` — the offscreen pass's base-style measurement.
 *
 * The canvas 2D context is the only I/O here, so it is supplied explicitly:
 * a stub that reports whatever ink box the case needs lets every filter,
 * fallback and tie-break in the sampler be stated as an arithmetic fact.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  accumulateChapterStyles,
  calculateDominantStyle,
  createZeroDelayTick,
  fontStringOf,
  getActualInkHeight,
  getCanvasLineHeight,
  getMeasureContext,
  MAX_SAMPLE_CHARS,
  MIN_SAMPLE_TEXT_LENGTH,
  type StyleAccumulator,
} from './styleSampling';

/** A canvas 2D stand-in whose metrics are a pure function of the font size. */
const makeContext = (
  metricsFor: (font: string, text: string) => Partial<TextMetrics> = () => ({})
): CanvasRenderingContext2D & { fonts: string[] } => {
  const ctx = {
    font: '',
    fonts: [] as string[],
    measureText(text: string) {
      ctx.fonts.push(ctx.font);
      return {
        actualBoundingBoxAscent: 10,
        actualBoundingBoxDescent: 2,
        fontBoundingBoxAscent: 12,
        fontBoundingBoxDescent: 4,
        ...metricsFor(ctx.font, text),
      } as TextMetrics;
    },
  };
  return ctx as unknown as CanvasRenderingContext2D & { fonts: string[] };
};

const style = (over: Partial<CSSStyleDeclaration> = {}): CSSStyleDeclaration =>
  ({
    fontWeight: '400',
    fontSize: '16px',
    fontFamily: 'Times',
    lineHeight: 'normal',
    ...over,
  }) as CSSStyleDeclaration;

/** A document plus a window whose getComputedStyle is keyed off a data attr. */
const makeChapter = (
  html: string,
  styleFor: (el: Element) => Partial<CSSStyleDeclaration> = () => ({})
): { doc: Document; win: Window } => {
  const doc = new DOMParser().parseFromString(`<html><body>${html}</body></html>`, 'text/html');
  const win = {
    getComputedStyle: (el: Element) => style(styleFor(el)),
  } as unknown as Window;
  return { doc, win };
};

const body = (n: number, char = 'a'): string => char.repeat(n);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fontStringOf', () => {
  it('builds the canvas shorthand in weight/size/family order', () => {
    expect(fontStringOf(style({ fontWeight: '700', fontSize: '18px', fontFamily: 'Georgia' }))).toBe(
      '700 18px Georgia'
    );
  });
});

describe('getCanvasLineHeight', () => {
  it('trusts an explicit line-height and never touches the canvas', () => {
    const ctx = makeContext();

    expect(getCanvasLineHeight(style({ lineHeight: '24px' }), ctx)).toBe(24);
    expect(ctx.fonts).toEqual([]);
  });

  it("measures the font's bounding box when line-height is `normal`", () => {
    const ctx = makeContext(() => ({ fontBoundingBoxAscent: 15, fontBoundingBoxDescent: 5 }));

    expect(getCanvasLineHeight(style(), ctx)).toBe(20);
    expect(ctx.fonts).toEqual(['400 16px Times']);
  });

  it('reports 0 when the measuring context is unavailable', () => {
    expect(getCanvasLineHeight(style(), null)).toBe(0);
  });

  it('still reports an explicit line-height with no context at all', () => {
    expect(getCanvasLineHeight(style({ lineHeight: '30px' }), null)).toBe(30);
  });

  it('yields NaN for an unparseable explicit line-height (the caller substitutes)', () => {
    expect(getCanvasLineHeight(style({ lineHeight: 'inherit' }), makeContext())).toBeNaN();
  });
});

describe('getActualInkHeight', () => {
  it('sums the ascent and descent of the ACTUAL glyphs', () => {
    const ctx = makeContext(() => ({ actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 3 }));

    expect(getActualInkHeight(style(), ctx, 'Wangle')).toBe(12);
  });

  it('measures the passed text, defaulting to a capital M', () => {
    const seen: string[] = [];
    const ctx = makeContext((_font, text) => {
      seen.push(text);
      return {};
    });

    getActualInkHeight(style(), ctx);
    getActualInkHeight(style(), ctx, 'specific text');

    expect(seen).toEqual(['M', 'specific text']);
  });

  it('sets the element font before measuring', () => {
    const ctx = makeContext();

    getActualInkHeight(style({ fontWeight: '300', fontSize: '11px', fontFamily: 'Arial' }), ctx);

    expect(ctx.fonts).toEqual(['300 11px Arial']);
  });

  it('reports 0 with no context', () => {
    expect(getActualInkHeight(style(), null)).toBe(0);
  });
});

describe('accumulateChapterStyles — the sampling filters', () => {
  const inkOf = (px: number) => () => ({
    actualBoundingBoxAscent: px,
    actualBoundingBoxDescent: 0,
  });

  it('accumulates count, characters and line height per rounded size', () => {
    const { doc, win } = makeChapter(`<p>${body(60)}</p><p>${body(80)}</p>`);
    const acc: StyleAccumulator = new Map();

    accumulateChapterStyles(doc, win, acc, makeContext(inkOf(16)));

    expect(acc.get(16)).toEqual({ count: 2, charCount: 140, totalLineHeight: 32 });
  });

  it('ROUNDS sizes to one decimal so float noise does not fragment the histogram', () => {
    const { doc, win } = makeChapter(
      `<p data-a>${body(60)}</p><p data-b>${body(60)}</p>`
    );
    const acc: StyleAccumulator = new Map();
    const ctx = makeContext((_f, text) => ({
      actualBoundingBoxAscent: text.startsWith('a') ? 16.001 : 16.04,
      actualBoundingBoxDescent: 0,
    }));

    accumulateChapterStyles(doc, win, acc, ctx);

    expect([...acc.keys()]).toEqual([16]);
    expect(acc.get(16)?.count).toBe(2);
  });

  it('skips text shorter than the sampling floor', () => {
    const { doc, win } = makeChapter(
      `<p>${body(MIN_SAMPLE_TEXT_LENGTH - 1)}</p><p>${body(MIN_SAMPLE_TEXT_LENGTH)}</p>`
    );
    const acc: StyleAccumulator = new Map();

    accumulateChapterStyles(doc, win, acc, makeContext(inkOf(16)));

    expect(acc.get(16)).toMatchObject({ count: 1, charCount: MIN_SAMPLE_TEXT_LENGTH });
  });

  it('measures the TRIMMED text, so padding does not inflate the volume', () => {
    const { doc, win } = makeChapter(`<p>   ${body(60)}   </p>`);
    const acc: StyleAccumulator = new Map();

    accumulateChapterStyles(doc, win, acc, makeContext(inkOf(16)));

    expect(acc.get(16)?.charCount).toBe(60);
  });

  it.each(['aside', 'nav', 'footer'])('skips prose inside <%s>', (tag) => {
    const { doc, win } = makeChapter(`<${tag}><p>${body(60)}</p></${tag}>`);
    const acc: StyleAccumulator = new Map();

    accumulateChapterStyles(doc, win, acc, makeContext(inkOf(16)));

    expect(acc.size).toBe(0);
  });

  it('keeps prose inside ordinary containers', () => {
    const { doc, win } = makeChapter(`<section><p>${body(60)}</p></section>`);
    const acc: StyleAccumulator = new Map();

    accumulateChapterStyles(doc, win, acc, makeContext(inkOf(16)));

    expect(acc.get(16)?.count).toBe(1);
  });

  it('samples the publisher div conventions, not just <p>', () => {
    const { doc, win } = makeChapter(
      `<div class="paragraph">${body(60)}</div>` +
        `<div class="bodytext">${body(60)}</div>` +
        `<div class="calibre1">${body(60)}</div>` +
        `<div class="unrelated">${body(60)}</div>`
    );
    const acc: StyleAccumulator = new Map();

    accumulateChapterStyles(doc, win, acc, makeContext(inkOf(16)));

    expect(acc.get(16)?.count).toBe(3);
  });

  it('stops once the chapter budget is spent — later paragraphs never counted', () => {
    const chunk = body(MAX_SAMPLE_CHARS);
    const { doc, win } = makeChapter(`<p>${chunk}</p><p>${chunk}</p><p>${chunk}</p>`);
    const acc: StyleAccumulator = new Map();

    accumulateChapterStyles(doc, win, acc, makeContext(inkOf(16)));

    // The first paragraph alone exhausts the budget; the loop breaks before
    // the second is measured.
    expect(acc.get(16)).toMatchObject({ count: 1, charCount: MAX_SAMPLE_CHARS });
  });

  it('substitutes a 1.2x line height when the resolved one is unparseable', () => {
    const { doc, win } = makeChapter(`<p>${body(60)}</p>`, () => ({ lineHeight: 'inherit' }));
    const acc: StyleAccumulator = new Map();

    accumulateChapterStyles(doc, win, acc, makeContext(inkOf(20)));

    expect(acc.get(20)?.totalLineHeight).toBeCloseTo(24);
  });

  it('ignores a paragraph whose ink measures to zero', () => {
    const { doc, win } = makeChapter(`<p>${body(60)}</p>`);
    const acc: StyleAccumulator = new Map();

    accumulateChapterStyles(doc, win, acc, makeContext(inkOf(0)));

    expect(acc.size).toBe(0);
  });

  it('ignores a paragraph whose ink measures to NaN', () => {
    const { doc, win } = makeChapter(`<p>${body(60)}</p>`);
    const acc: StyleAccumulator = new Map();
    const ctx = makeContext(() => ({
      actualBoundingBoxAscent: NaN,
      actualBoundingBoxDescent: 0,
    }));

    accumulateChapterStyles(doc, win, acc, ctx);

    expect(acc.size).toBe(0);
  });

  it('returns immediately for a chapter with no paragraphs at all', () => {
    const { doc, win } = makeChapter('<h1>Title only</h1>');
    const acc: StyleAccumulator = new Map();

    accumulateChapterStyles(doc, win, acc, makeContext(inkOf(16)));

    expect(acc.size).toBe(0);
  });

  it('ACCUMULATES across chapters rather than resetting', () => {
    const acc: StyleAccumulator = new Map();
    const one = makeChapter(`<p>${body(60)}</p>`);
    const two = makeChapter(`<p>${body(70)}</p>`);

    accumulateChapterStyles(one.doc, one.win, acc, makeContext(inkOf(16)));
    accumulateChapterStyles(two.doc, two.win, acc, makeContext(inkOf(16)));

    expect(acc.get(16)).toMatchObject({ count: 2, charCount: 130 });
  });

  it('resolves style through the CHAPTER window, not the host document', () => {
    const seen: Element[] = [];
    const doc = new DOMParser().parseFromString(
      `<html><body><p>${body(60)}</p></body></html>`,
      'text/html'
    );
    const win = {
      getComputedStyle: (el: Element) => {
        seen.push(el);
        return style();
      },
    } as unknown as Window;

    accumulateChapterStyles(doc, win, new Map(), makeContext(inkOf(16)));

    expect(seen).toHaveLength(1);
    expect(seen[0].tagName).toBe('P');
  });

  it('records nothing when no measuring context is available', () => {
    const { doc, win } = makeChapter(`<p>${body(60)}</p>`);
    const acc: StyleAccumulator = new Map();

    accumulateChapterStyles(doc, win, acc, null);

    expect(acc.size).toBe(0);
  });
});

describe('calculateDominantStyle', () => {
  it('returns null for an empty accumulator', () => {
    expect(calculateDominantStyle(new Map())).toBeNull();
  });

  it('picks the size carrying the most CHARACTERS, not the most paragraphs', () => {
    const acc: StyleAccumulator = new Map([
      [12, { count: 10, charCount: 500, totalLineHeight: 140 }],
      [16, { count: 2, charCount: 4000, totalLineHeight: 40 }],
    ]);

    expect(calculateDominantStyle(acc)?.fontSize).toBe(16);
  });

  it('reports the MEAN line height measured at the dominant size', () => {
    const acc: StyleAccumulator = new Map([
      [16, { count: 4, charCount: 4000, totalLineHeight: 96 }],
    ]);

    expect(calculateDominantStyle(acc)).toEqual({ fontSize: 16, lineHeight: 24 });
  });

  it('keeps the FIRST size on a volume tie (insertion order wins)', () => {
    const acc: StyleAccumulator = new Map([
      [14, { count: 1, charCount: 1000, totalLineHeight: 20 }],
      [18, { count: 1, charCount: 1000, totalLineHeight: 30 }],
    ]);

    expect(calculateDominantStyle(acc)?.fontSize).toBe(14);
  });

  it('handles a single entry whose volume is zero', () => {
    const acc: StyleAccumulator = new Map([
      [16, { count: 1, charCount: 0, totalLineHeight: 20 }],
    ]);

    expect(calculateDominantStyle(acc)).toEqual({ fontSize: 16, lineHeight: 20 });
  });
});

describe('createZeroDelayTick', () => {
  it('runs queued callbacks as macrotasks, in order, with a timestamp', async () => {
    const scheduler = createZeroDelayTick();
    const order: number[] = [];
    const times: number[] = [];

    scheduler.tick((t) => {
      order.push(1);
      times.push(t);
    });
    scheduler.tick(() => order.push(2));

    expect(order).toEqual([]); // never synchronous
    await new Promise((r) => setTimeout(r, 10));

    expect(order).toEqual([1, 2]);
    expect(times[0]).toBeGreaterThan(0);
    scheduler.dispose();
  });

  it('stops delivering once disposed', async () => {
    const scheduler = createZeroDelayTick();
    const ran: number[] = [];

    scheduler.tick(() => ran.push(1));
    scheduler.dispose();
    await new Promise((r) => setTimeout(r, 10));

    expect(ran).toEqual([]);
  });
});

describe('getMeasureContext', () => {
  it('allocates ONE canvas for the whole pass and reuses it', () => {
    const first = getMeasureContext(); // warms the module cache
    const createElement = vi.spyOn(document, 'createElement');

    const second = getMeasureContext();
    const third = getMeasureContext();

    expect(createElement).not.toHaveBeenCalled();
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('is the default measuring surface for the sampler', () => {
    // jsdom has no 2D context, so the default resolves to null and the
    // sampler records nothing — the same arm as an explicit null.
    const { doc, win } = makeChapter(`<p>${body(60)}</p>`);
    const acc: StyleAccumulator = new Map();

    accumulateChapterStyles(doc, win, acc);

    expect(getMeasureContext()).toBeNull();
    expect(acc.size).toBe(0);
  });
});

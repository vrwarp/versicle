/**
 * Base-style sampling for the offscreen extraction pass — the pure half of
 * `offscreen-renderer`.
 *
 * The renderer's job is to drive epub.js; deciding what a book's *body*
 * font size and line height actually are is a measurement problem with no
 * I/O in it, so it lives here where it can be reasoned about (and tested)
 * against a plain document instead of a live rendition.
 *
 * The sampler walks each chapter's paragraphs, measures the real inked
 * height of their text on a canvas (CSS `font-size` lies: publishers ship
 * `62.5%`/`em` cascades and webfonts with wildly different ink boxes), and
 * accumulates a size→volume histogram across the WHOLE book. The dominant
 * style is then the size that carried the most characters — footnotes,
 * captions and front matter lose to the body text by volume, which is
 * exactly the intent.
 */

/** size(px, 1dp) → how much text was set at it. */
export type StyleAccumulator = Map<
  number,
  { count: number; charCount: number; totalLineHeight: number }
>;

/**
 * Zero-delay macrotask scheduler for epub.js queues (see QueueInternals).
 *
 * epub.js runs every queued task on a requestAnimationFrame tick, and one
 * `rendition.display()` crosses its queue several times — so each chapter of
 * the extraction loop pays multiple frame-lengths of pure idle (measured
 * ~40% of extraction wall time on Chromium, more on WebKit, on the Alice
 * fixture). Nothing this pipeline renders is ever painted, so frame
 * alignment buys nothing here. A MessageChannel macrotask (setTimeout(0) is
 * clamped to 4ms when chained) keeps queue tasks running back-to-back while
 * still yielding to the event loop for iframe load events. The LIVE reader
 * keeps the default rAF tick: it paints, and frame batching is correct there.
 */
export function createZeroDelayTick(): {
  tick: (this: unknown, callback: (time: number) => void) => void;
  dispose: () => void;
} {
  const channel = new MessageChannel();
  const pending: Array<() => void> = [];
  channel.port1.onmessage = () => pending.shift()?.();
  return {
    tick: (callback) => {
      pending.push(() => callback(performance.now()));
      channel.port2.postMessage(null);
    },
    dispose: () => {
      channel.port1.close();
      channel.port2.close();
    },
  };
}

/**
 * ONE measuring canvas for the whole extraction pass. The helpers below run
 * per sampled paragraph per chapter, so a 300-section book used to allocate
 * tens of thousands of canvases + 2D contexts; the context is stateless
 * between calls (every call sets `font` before measuring), so a single
 * shared one is equivalent. Created lazily and cached (null = 2D
 * unavailable).
 */
let measureContext: CanvasRenderingContext2D | null | undefined;

export function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureContext === undefined) {
    measureContext = document.createElement('canvas').getContext('2d');
  }
  return measureContext;
}

/** The canvas `font` shorthand for an element's resolved style. */
export function fontStringOf(computedStyle: CSSStyleDeclaration): string {
  return `${computedStyle.fontWeight} ${computedStyle.fontSize} ${computedStyle.fontFamily}`;
}

/**
 * Line height in px. An explicit `line-height` is authoritative; `normal`
 * resolves to the font's own bounding box, which is what the browser would
 * lay the line out at.
 */
export function getCanvasLineHeight(
  computedStyle: CSSStyleDeclaration,
  context: CanvasRenderingContext2D | null
): number {
  if (computedStyle.lineHeight !== 'normal') {
    return parseFloat(computedStyle.lineHeight);
  }

  if (!context) return 0;

  // Reconstruct the exact font string (e.g., "400 16px Times")
  context.font = fontStringOf(computedStyle);

  // Measure a standard character
  const metrics = context.measureText('M');

  // Calculate total pixel height based on font bounding box
  // Note: fontBoundingBox is supported in all modern browsers
  return metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
}

/**
 * The height of the text's actual INK — baseline-relative ascent + descent
 * of the glyphs really present, not the declared font size.
 */
export function getActualInkHeight(
  computedStyle: CSSStyleDeclaration,
  context: CanvasRenderingContext2D | null,
  textToMeasure = 'M'
): number {
  if (!context) return 0;

  // Set the canvas font to match the element exactly
  context.font = fontStringOf(computedStyle);

  // Measure the exact text
  const metrics = context.measureText(textToMeasure);

  // actualBoundingBoxAscent: pixels from the baseline to the top of the highest letter
  // actualBoundingBoxDescent: pixels from the baseline to the bottom of the lowest letter (e.g., 'g', 'j')
  return metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
}

/** Below this, a "paragraph" is a heading, a caption or ToC furniture. */
export const MIN_SAMPLE_TEXT_LENGTH = 50;
/** Per-chapter sampling budget — enough to be representative, cheap to take. */
export const MAX_SAMPLE_CHARS = 5000;
/** Containers whose prose is never body text. */
const NON_BODY_PARENTS = new Set(['aside', 'nav', 'footer']);
const PARAGRAPH_SELECTOR = 'p, div.paragraph, div.bodytext, div.calibre1';

/**
 * Samples the dominant font size of a single document/chapter and adds it
 * to the global accumulator. Stops early once the chapter's budget is spent
 * — which also keeps end-of-chapter footnotes out of the sample.
 */
export function accumulateChapterStyles(
  doc: Document,
  win: Window,
  accumulator: StyleAccumulator,
  context: CanvasRenderingContext2D | null = getMeasureContext()
): void {
  const paragraphs = Array.from(doc.querySelectorAll(PARAGRAPH_SELECTOR));
  if (paragraphs.length === 0) return;

  let totalSampledChars = 0;

  for (const p of paragraphs) {
    if (totalSampledChars >= MAX_SAMPLE_CHARS) break;

    const text = p.textContent?.trim() || '';

    // Filter 1: Ignore short strings (ToC, headings)
    if (text.length < MIN_SAMPLE_TEXT_LENGTH) continue;

    // Filter 2: Ignore explicit metadata containers
    const parentTag = p.parentElement?.tagName.toLowerCase();
    if (parentTag !== undefined && NON_BODY_PARENTS.has(parentTag)) {
      continue;
    }
    // ONE resolved-style read per paragraph, shared by both measurements
    // (each helper used to call getComputedStyle itself — two cross-realm
    // style resolutions per paragraph).
    const computedStyle = win.getComputedStyle(p as HTMLElement);
    const fontSize = getActualInkHeight(computedStyle, context, text);
    let lineHeight = getCanvasLineHeight(computedStyle, context);

    if (isNaN(lineHeight)) {
      lineHeight = fontSize * 1.2; // Standard browser default fallback
    }

    if (!isNaN(fontSize) && fontSize > 0) {
      // Round to 1 decimal place to prevent floating point fragmentation mapping (e.g., 16.001px vs 16.0px)
      const roundedSize = Math.round(fontSize * 10) / 10;

      const existing = accumulator.get(roundedSize) || {
        count: 0,
        charCount: 0,
        totalLineHeight: 0,
      };
      existing.count += 1;
      existing.charCount += text.length;
      existing.totalLineHeight += lineHeight;
      accumulator.set(roundedSize, existing);

      totalSampledChars += text.length;
    }
  }
}

/**
 * Evaluates the global accumulator to find the mathematically dominant
 * style: the size that carried the most CHARACTERS (not the most
 * paragraphs — one long body paragraph outweighs a run of short captions),
 * with the mean line height measured at that size.
 */
export function calculateDominantStyle(
  accumulator: StyleAccumulator
): { fontSize: number; lineHeight: number } | null {
  if (accumulator.size === 0) return null;

  let dominantSize = 0;
  let maxVolume = -1;

  for (const [size, data] of accumulator.entries()) {
    if (data.charCount > maxVolume) {
      maxVolume = data.charCount;
      dominantSize = size;
    }
  }

  const dominantData = accumulator.get(dominantSize)!;

  return {
    fontSize: dominantSize,
    lineHeight: dominantData.totalLineHeight / dominantData.count,
  };
}

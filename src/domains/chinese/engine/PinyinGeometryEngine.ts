/**
 * PinyinGeometryEngine — the pure pinyin geometry pass (Phase 6 §7.1,
 * prep/phase6-reader-engine.md PR-10).
 *
 * Code-point SAFE by construction (CH-1, fixed at PR-1 and moved here
 * verbatim): pinyin-pro returns one entry per Unicode CODE POINT while DOM
 * Range offsets count UTF-16 CODE UNITS, so the loop iterates code points
 * and advances a parallel code-unit cursor. The Han test is the full
 * `\p{Script=Han}` property — Ext-B+ astral characters included.
 *
 * pinyin-pro is loaded lazily (it is a sizable dictionary) but TYPED
 * against the real package types (CH-11 — the legacy wrapper held it as
 * `any`). No store imports, no epubjs imports: callers inject nothing but
 * DOM nodes and offsets, so this module is trivially unit-testable.
 */
import type { PinyinPosition } from '@domains/chinese/types';
import { applyPolyphonicOverrides } from './polyphonic';

/**
 * The Han test (CH-1): the full Unicode script property, NOT the BMP block
 * range `[一-鿿]` — Ext-B+ characters (e.g. U+20000 𠀀) are surrogate
 * PAIRS in UTF-16 and invisible to a per-code-unit block test. Apply to one
 * CODE POINT at a time (no /g state).
 */
export const HAN_RE = /\p{Script=Han}/u;

type PinyinFn = typeof import('pinyin-pro').pinyin;

let pinyinFn: PinyinFn | null = null;

/** Lazily load pinyin-pro (idempotent). */
export async function ensurePinyin(): Promise<void> {
  if (!pinyinFn) {
    pinyinFn = (await import('pinyin-pro')).pinyin;
  }
}

/**
 * Per-code-point pinyin for `text` (tone symbols). Requires
 * {@link ensurePinyin} to have resolved — synchronous on purpose so the
 * geometry loop never awaits between DOM reads.
 *
 * pinyin-pro segments the text and disambiguates most polyphonic (多音字)
 * characters by context, but its phrase dictionary leaves a curated tail
 * wrong; {@link applyPolyphonicOverrides} corrects those against the
 * context-word rules (Simplified + Traditional). Both layers operate on the
 * SAME per-code-point alignment, so the geometry loop indexing is unchanged.
 */
export function getPinyin(text: string): string[] {
  if (!pinyinFn) {
    throw new Error('Pinyin module not loaded. Call ensurePinyin() first.');
  }
  const base = pinyinFn(text, { type: 'array', toneType: 'symbol' });
  return applyPolyphonicOverrides(text, base);
}

/**
 * Per-node readings cache (jank fix): the reading pass (pinyin-pro
 * segmentation + polyphonic overrides) is pure string work over text that
 * never changes for a given node — only its GEOMETRY moves on relocation /
 * resize. Remeasure passes used to recompute readings for the whole chapter
 * on every page turn and scroll-settle; this cache makes those passes
 * rect-reads only. Keyed weakly on the Text node; the entry stores the
 * exact string the readings were computed from, so a node whose displayed
 * text changes (Traditional toggle re-running before the cache was built,
 * a mutated DOM) recomputes instead of serving stale readings. cn→tw is
 * code-point aligned, so both display scripts share one entry (the
 * Simplified source key).
 */
const readingsCache = new WeakMap<Text, { key: string; readings: string[] }>();

/**
 * The aligned per-code-point readings for a node's CURRENT displayed text,
 * cached (see {@link readingsCache}). `pinyinSourceText` carries the
 * Simplified original when the displayed text is Traditional (pinyin-pro is
 * far stronger on Simplified); if the source ever disagrees in code-point
 * count, the displayed text is read instead so the array can never
 * misalign with the rects.
 */
export function getNodeReadings(textNode: Text, pinyinSourceText?: string): string[] {
  const displayedText = textNode.nodeValue || '';
  const sourceText = pinyinSourceText ?? displayedText;
  const aligned =
    sourceText === displayedText ||
    Array.from(sourceText).length === Array.from(displayedText).length;
  const key = aligned ? sourceText : displayedText;

  const cached = readingsCache.get(textNode);
  if (cached && cached.key === key) return cached.readings;

  const readings = getPinyin(key);
  readingsCache.set(textNode, { key, readings });
  return readings;
}

/**
 * Collect the Han text nodes of a section document (the walker half of the
 * legacy pass): text nodes containing at least one Han code point, skipping
 * nodes inside ruby annotations (`<rt>`/`<ruby>` may already carry readings).
 */
export function findHanTextNodes(doc: Document): Text[] {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Text | null;
  while ((node = walker.nextNode() as Text)) {
    if (!node.textContent || !HAN_RE.test(node.textContent)) continue;
    const parent = node.parentElement;
    if (!parent || parent.tagName === 'RT' || parent.tagName === 'RUBY') continue;
    textNodes.push(node);
  }
  return textNodes;
}

/**
 * The measure half of the geometry pass for ONE text node: one
 * {@link PinyinPosition} per Han code point with a non-empty rect,
 * positioned at the character center in container coordinates (rect +
 * iframe offsets — scrolled-doc mode stacks several section iframes, so
 * each view contributes its own offsets). `readings` is the aligned
 * per-code-point array from {@link getNodeReadings} — computed separately
 * so callers can batch all DOM WRITES (the display-script pass) before any
 * geometry READ, avoiding write/read layout thrash across nodes.
 */
export function measureNodePinyinPositions(
  doc: Document,
  textNode: Text,
  iframeOffset: { top: number; left: number },
  readings: string[],
): PinyinPosition[] {
  const positions: PinyinPosition[] = [];
  const codePoints = Array.from(textNode.nodeValue || '');

  // ONE reusable Range per node: setStart/setEnd per character instead of a
  // fresh Range allocation per glyph (thousands per chapter).
  let range: Range;
  try {
    range = doc.createRange();
  } catch {
    return positions;
  }

  let unit = 0;
  for (let cp = 0; cp < codePoints.length; cp++) {
    const char = codePoints[cp];
    if (HAN_RE.test(char) && readings[cp]) {
      try {
        range.setStart(textNode, unit);
        range.setEnd(textNode, unit + char.length);

        const rect = range.getBoundingClientRect();
        // Optimization: Skip if rect has no dimensions
        if (rect.width > 0 && rect.height > 0) {
          positions.push({
            char,
            pinyin: readings[cp],
            // Document-relative top/left via the iframe offsets
            top: rect.top + iframeOffset.top,
            left: rect.left + iframeOffset.left + rect.width / 2, // character center
            width: rect.width,
            height: rect.height,
          });
        }
      } catch {
        // Range errors can happen during rapid updates
      }
    }
    unit += char.length;
  }

  return positions;
}

/**
 * The full geometry pass for ONE text node — readings ({@link
 * getNodeReadings}, cached) then rects ({@link measureNodePinyinPositions}).
 * Kept as the single-node entry point (and the characterization surface);
 * the content processor calls the two halves itself to phase writes before
 * reads across the whole section.
 */
export function collectNodePinyinPositions(
  doc: Document,
  textNode: Text,
  iframeOffset: { top: number; left: number },
  pinyinSourceText?: string,
): PinyinPosition[] {
  const readings = getNodeReadings(textNode, pinyinSourceText);
  return measureNodePinyinPositions(doc, textNode, iframeOffset, readings);
}

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
 * The geometry pass for ONE text node: one {@link PinyinPosition} per Han
 * code point with a non-empty rect, positioned at the character center in
 * container coordinates (rect + iframe offsets — scrolled-doc mode stacks
 * several section iframes, so each view contributes its own offsets).
 */
export function collectNodePinyinPositions(
  doc: Document,
  textNode: Text,
  iframeOffset: { top: number; left: number },
  pinyinSourceText?: string,
): PinyinPosition[] {
  const positions: PinyinPosition[] = [];
  const displayedText = textNode.nodeValue || '';
  const codePoints = Array.from(displayedText);

  // Readings come from the source text (the Simplified original in Traditional
  // display mode — pinyin-pro is far stronger on Simplified); geometry comes
  // from the displayed glyphs. cn→tw is 1:1 code-point aligned, so reading[cp]
  // pairs with displayed code point cp. Defensive guard: if the source ever
  // disagrees in code-point count, read from the displayed text so the array
  // can never misalign with the rects.
  const sourceText = pinyinSourceText ?? displayedText;
  const aligned = Array.from(sourceText).length === codePoints.length;
  const pinyinArray = getPinyin(aligned ? sourceText : displayedText);

  let unit = 0;
  for (let cp = 0; cp < codePoints.length; cp++) {
    const char = codePoints[cp];
    if (HAN_RE.test(char) && pinyinArray[cp]) {
      try {
        const range = doc.createRange();
        range.setStart(textNode, unit);
        range.setEnd(textNode, unit + char.length);

        const rect = range.getBoundingClientRect();
        // Optimization: Skip if rect has no dimensions
        if (rect.width > 0 && rect.height > 0) {
          positions.push({
            char,
            pinyin: pinyinArray[cp],
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

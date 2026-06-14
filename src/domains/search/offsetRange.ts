/**
 * Map a plain-text character offset back onto a DOM Range (Phase 7 §F,
 * PR-S4's engine-side half).
 *
 * The search corpus is the concatenation of a section's text nodes in
 * document order (`textContent`), so walking text nodes while accumulating
 * lengths reproduces the offset space exactly. CFI GENERATION IS INJECTED:
 * this module never imports epubjs — the reader passes its content view's
 * `cfiFromRange` at the call site (app/reader/searchNavigation).
 */
import type { DetailedSearchResult } from '~types/search';

/**
 * Resolve `[charOffset, charOffset + length)` in `root`'s concatenated text
 * to a DOM Range. Returns null when the offsets fall outside the document
 * (stale index vs re-rendered content — callers fall back to plain
 * `display(href)` navigation).
 */
export function findRangeForOffset(root: Node, charOffset: number, length: number): Range | null {
  if (charOffset < 0 || length <= 0) return null;

  const doc = root.ownerDocument ?? (root as Document);
  if (!doc || typeof doc.createTreeWalker !== 'function') return null;

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const endOffset = charOffset + length;

  let consumed = 0;
  let startNode: Text | null = null;
  let startInNode = 0;
  let endNode: Text | null = null;
  let endInNode = 0;

  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const len = node.data.length;

    if (startNode === null && charOffset < consumed + len) {
      startNode = node;
      startInNode = charOffset - consumed;
    }
    if (endOffset <= consumed + len) {
      endNode = node;
      endInNode = endOffset - consumed;
      break;
    }
    consumed += len;
  }

  if (!startNode || !endNode) return null;

  const range = doc.createRange();
  range.setStart(startNode, startInNode);
  range.setEnd(endNode, endInNode);
  return range;
}

/**
 * Resolve a result's exact-occurrence CFI with an INJECTED CFI generator
 * (the reader's `contents.cfiFromRange`). Returns the result with `cfi`
 * populated, or unchanged when resolution fails — navigation then degrades
 * to `display(href)` (the doc's fallback).
 */
export function resolveResultCfi(
  result: DetailedSearchResult,
  sectionRoot: Node,
  cfiFromRange: (range: Range) => string | null,
): DetailedSearchResult {
  try {
    const range = findRangeForOffset(sectionRoot, result.charOffset, result.matchLength);
    if (!range) return result;
    const cfi = cfiFromRange(range);
    return cfi ? { ...result, cfi } : result;
  } catch {
    return result;
  }
}

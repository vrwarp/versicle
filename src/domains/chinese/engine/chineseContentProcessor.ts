/**
 * chineseContentProcessor — the Chinese reading content pass, extracted
 * VERBATIM from useEpubReader (Phase 6 §5 table / §7 seam,
 * prep/phase6-reader-engine.md PR-4).
 *
 * This was the SEAM commit (byte-equivalent extraction); the prep doc's
 * PR-1 then landed the CH-1 fix IN PLACE: the pinyin loop iterates CODE
 * POINTS (matching pinyin-pro's one-entry-per-code-point array) while
 * Range offsets advance in CODE UNITS, and the Han test is the full
 * `\p{Script=Han}` property (Ext-B+ astral Han included). The two
 * misalignment pins in useEpubReader_Pinyin.characterization.test.tsx were
 * rewritten in the same commit (enumerated characterization delta, prep
 * doc §Execution PR-1) and the astral specs flipped to passing. The CH-7
 * unguarded nodeValue mutation keeps its own prep-doc item (PR-10), never
 * silently here. Preference/book-language reads are injected by the caller,
 * so this module has no store imports and already satisfies the
 * domains-no-store boundary the §7 extraction inherits.
 */
import type { Contents } from 'epubjs';
import {
  toTraditional,
  getPinyin,
  ensureOpenCC,
  ensurePinyin,
} from '@lib/chinese/ChineseTextProcessor';
import type { PinyinPosition } from '@domains/chinese/types';

/**
 * The Han test (CH-1): the full Unicode script property, NOT the BMP block
 * range `[一-鿿]` — Ext-B+ characters (e.g. U+20000 𠀀) are
 * surrogate PAIRS in UTF-16 and invisible to a per-code-unit block test.
 * Must be applied to one CODE POINT at a time (no /g state).
 */
export const HAN_RE = /\p{Script=Han}/u;

export interface ChineseProcessingOptions {
  /** Normalized base language of the book ('zh' activates processing). */
  bookLang: string;
  forceTraditionalChinese: boolean;
  showPinyin: boolean;
  /** Receives the collected overlay geometry (empty for non-zh books). */
  onPinyinPositions: (positions: PinyinPosition[]) => void;
}

/** Process Chinese text without corrupting DOM structure (verbatim). */
export async function processChineseContent(
  contents: Contents,
  opts: ChineseProcessingOptions,
): Promise<void> {
  const doc = contents.document;
  if (!doc) return;

  if (opts.bookLang !== 'zh') {
    opts.onPinyinPositions([]);
    return;
  }

  // Pre-load processors to allow synchronous calls in the loop
  if (opts.forceTraditionalChinese) await ensureOpenCC();
  if (opts.showPinyin) await ensurePinyin();

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Text | null;
  while ((node = walker.nextNode() as Text)) {
    if (node.textContent && HAN_RE.test(node.textContent)) {
      textNodes.push(node);
    }
  }

  const pinyinPositions: PinyinPosition[] = [];
  const iframe = contents.window.frameElement as HTMLIFrameElement | null;
  if (!iframe) return;

  // In scrolled-doc mode, several iframes might be stacked.
  // We need to account for each iframe's position within the manager's container.
  const iframeOffsetTop = iframe.offsetTop;
  const iframeOffsetLeft = iframe.offsetLeft;

  for (const textNode of textNodes) {
    const parent = textNode.parentElement;
    // Skip ruby/rt elements as they might already have annotations or be part of one
    if (!parent || parent.tagName === 'RT' || parent.tagName === 'RUBY') continue;

    // 1. Cache original text for clean reversion/toggling
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(textNode as any)._originalText) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (textNode as any)._originalText = textNode.nodeValue;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalText = (textNode as any)._originalText;

    // 2. Handle Traditional Chinese (In-place string mutation)
    if (opts.forceTraditionalChinese) {
      const translated = toTraditional(originalText);
      if (textNode.nodeValue !== translated) {
        textNode.nodeValue = translated;
      }
    } else {
      if (textNode.nodeValue !== originalText) {
        textNode.nodeValue = originalText;
      }
    }

    // 3. Handle Pinyin (Ephemeral Geometry Collection).
    // CH-1 fix (prep doc PR-1): pinyin-pro returns ONE entry per CODE
    // POINT, while DOM Range offsets count UTF-16 CODE UNITS. Iterate code
    // points (indexing pinyinArray by code point) and advance a parallel
    // code-unit cursor for the Range offsets \u2014 astral Han gets its pinyin
    // and nothing after it shifts.
    if (opts.showPinyin) {
      const currentText = textNode.nodeValue || '';
      const pinyinArray = getPinyin(currentText);
      const codePoints = Array.from(currentText);

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
              pinyinPositions.push({
                char,
                pinyin: pinyinArray[cp],
                // Use document-relative top and left by adding iframe offsets
                top: rect.top + iframeOffsetTop,
                left: rect.left + iframeOffsetLeft + (rect.width / 2), // Center of character
                width: rect.width,
                height: rect.height
              });
            }
          } catch {
            // Range errors can happen during rapid updates
          }
        }
        unit += char.length;
      }
    }
  }

  opts.onPinyinPositions(pinyinPositions);
}

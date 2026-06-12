/**
 * chineseContentProcessor — the Chinese reading content pass, extracted
 * VERBATIM from useEpubReader (Phase 6 §5 table / §7 seam,
 * prep/phase6-reader-engine.md PR-4).
 *
 * This is the SEAM commit, not the §7 engine rewrite: the function body is
 * byte-equivalent to the legacy `processChineseContent`
 * (useEpubReader.ts:599-699 at the doc's HEAD), including the verified
 * CH-1 code-unit/code-point misalignment and the CH-7 unguarded nodeValue
 * mutation — both pinned by useEpubReader_Pinyin.characterization.test.tsx
 * and fixed by their own prep-doc items (PR-1 / PR-10), never silently
 * here. What changed is ONLY the wiring: preference/book-language reads are
 * injected by the caller (the reader lifecycle hook reads its stores at
 * call time exactly as before), so this module has no store imports and
 * already satisfies the domains-no-store boundary the §7 extraction will
 * inherit.
 */
import type { Contents } from 'epubjs';
import {
  toTraditional,
  getPinyin,
  ensureOpenCC,
  ensurePinyin,
} from '@lib/chinese/ChineseTextProcessor';
import type { PinyinPosition } from '@domains/chinese/types';

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
    if (node.textContent && /[\u4e00-\u9fff]/.test(node.textContent)) {
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

    // 3. Handle Pinyin (Ephemeral Geometry Collection)
    if (opts.showPinyin) {
      const currentText = textNode.nodeValue || '';
      const pinyinArray = getPinyin(currentText);

      for (let i = 0; i < currentText.length; i++) {
        const char = currentText[i];
        if (/[\u4e00-\u9fff]/.test(char) && pinyinArray[i]) {
          try {
            const range = doc.createRange();
            range.setStart(textNode, i);
            range.setEnd(textNode, i + 1);

            const rect = range.getBoundingClientRect();
            // Optimization: Skip if rect has no dimensions
            if (rect.width > 0 && rect.height > 0) {
              pinyinPositions.push({
                char,
                pinyin: pinyinArray[i],
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
      }
    }
  }

  opts.onPinyinPositions(pinyinPositions);
}

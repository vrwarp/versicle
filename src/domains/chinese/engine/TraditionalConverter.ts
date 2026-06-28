/**
 * TraditionalConverter — the simplified→traditional display pass
 * (Phase 6 §7.3, prep/phase6-reader-engine.md PR-10).
 *
 * KEEPER semantics preserved from the legacy pass (analysis/chinese.md):
 * in-place `nodeValue` mutation with an `_originalText` cache on the text
 * node for clean restore — DOM structure (and therefore every computed CFI)
 * is never touched.
 *
 * CH-7 guard, new here: the conversion is applied ONLY when it preserves
 * the code-unit length. OpenCC cn→tw is single-char (length-preserving) by
 * configuration, but a violation would silently corrupt CFI/Range offsets
 * computed against the displayed text — so a mismatch skips the node and
 * records a diagnostics event instead of mutating.
 */
import { RingRecorder } from '@kernel/diagnostics/ringRecorder';
import { createLogger } from '@lib/logger';

const logger = createLogger('TraditionalConverter');

type OpenCCConverter = (text: string) => string;

/** cn→tw, for the display pass. */
let converter: OpenCCConverter | null = null;
/** tw→cn, for normalizing the pinyin source to Simplified (see below). */
let simplifier: OpenCCConverter | null = null;

/** Diagnostics ring for CH-7 guard violations (namespaced buffer pattern). */
export const traditionalGuardRecorder = new RingRecorder<'chinese'>({ capacity: 100 });

/** Lazily load opencc-js and build both converters (idempotent). */
export async function ensureOpenCC(): Promise<void> {
  if (converter && simplifier) return;
  // Types: src/types/opencc-js.d.ts (the package ships none).
  const OpenCC = await import('opencc-js');
  converter = converter ?? OpenCC.Converter({ from: 'cn', to: 'tw' });
  simplifier = simplifier ?? OpenCC.Converter({ from: 'tw', to: 'cn' });
}

/**
 * Convert to Traditional. Requires {@link ensureOpenCC} to have resolved —
 * synchronous on purpose (no awaits between DOM reads/writes).
 */
export function toTraditional(text: string): string {
  if (!converter) {
    throw new Error('OpenCC module not loaded. Call ensureOpenCC() first.');
  }
  return converter(text);
}

/** Test seam: reset the lazy module cache. */
export function __resetOpenCCForTests(): void {
  converter = null;
  simplifier = null;
}

/** Test seam: install stub converters (CH-7 guard tests). */
export function __setOpenCCForTests(stub: OpenCCConverter, simpStub?: OpenCCConverter): void {
  converter = stub;
  if (simpStub) simplifier = simpStub;
}

/** The `_originalText` cache rides on the text node itself (legacy shape). */
interface CachedTextNode extends Text {
  _originalText?: string | null;
}

/**
 * The Simplified pinyin source for a node. pinyin-pro's dictionary is
 * Simplified-centric, so it mis-reads Traditional glyphs wholesale (樂→lè not
 * yuè, 難→nán, 應→yīng, 間→jiàn, 乾淨's 乾→qián not gān…). Computing readings
 * on a Simplified form and rendering them above the displayed glyphs fixes
 * that for BOTH book kinds:
 *  - cn→tw books: the node's cached `_originalText` is already Simplified, and
 *    tw→cn is identity on it;
 *  - tw-native books: `_originalText` is Traditional, and tw→cn normalizes it
 *    to Simplified.
 *
 * tw→cn is 1:1 code-point aligned, as is the cn→tw display pass, so the
 * readings line up with the displayed characters. The length guard keeps that
 * invariant: a (vanishingly rare) length-changing conversion falls back to the
 * unconverted original rather than desyncing the reading array from the rects.
 * Before {@link ensureOpenCC} resolves, returns the original unchanged.
 */
export function getPinyinSourceText(textNode: Text): string {
  const cached = textNode as CachedTextNode;
  const original = cached._originalText ?? textNode.nodeValue ?? '';
  if (!simplifier) return original;
  const simplified = simplifier(original);
  return simplified.length === original.length ? simplified : original;
}

/**
 * Apply the display script to one text node: Traditional when
 * `forceTraditional`, otherwise the cached original — byte-for-byte
 * round-trip via `_originalText`.
 *
 * Returns the node's CURRENT text after the pass (the geometry pass runs on
 * the displayed text).
 */
export function applyDisplayScript(textNode: Text, forceTraditional: boolean): string {
  const cached = textNode as CachedTextNode;

  // 1. Cache original text for clean reversion/toggling
  if (!cached._originalText) {
    cached._originalText = textNode.nodeValue;
  }
  const originalText = cached._originalText || '';

  // 2. In-place string mutation (structure untouched)
  if (forceTraditional) {
    const translated = toTraditional(originalText);
    // CH-7 guard: a length-changing conversion would desync every
    // code-unit offset computed against the displayed text. Skip + record.
    if (translated.length !== originalText.length) {
      traditionalGuardRecorder.record('chinese', 'traditional-length-mismatch', {
        originalLength: originalText.length,
        translatedLength: translated.length,
      });
      logger.warn(
        `Traditional conversion changed text length (${originalText.length} → ${translated.length}); node skipped.`,
      );
      if (textNode.nodeValue !== originalText) {
        textNode.nodeValue = originalText;
      }
      return originalText;
    }
    if (textNode.nodeValue !== translated) {
      textNode.nodeValue = translated;
    }
    return translated;
  }

  if (textNode.nodeValue !== originalText) {
    textNode.nodeValue = originalText;
  }
  return originalText;
}

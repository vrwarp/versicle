/**
 * chunkSection (Increment C §2; was deferred from B4) — split a search
 * section's concatenated plain text into sentence-snapped, ~target-token
 * windows with ~15% overlap, recording CHARACTER OFFSETS into the section's
 * text (the exact offset space `findRangeForOffset`/`resolveResultCfi` consume,
 * offsetRange.ts:20,63).
 *
 * Boundaries are snapped to sentence ends via `getCachedSegmenter`
 * (@kernel/locale/segmenterCache:15 — domains may import kernel); windows are
 * sized with the ~4-chars/token heuristic that GeminiClient.estTokens uses
 * (GeminiClient.ts:80). Pure: NO cheapHash (sectionTextHash is stamped at
 * import, extract.ts) and NO CFI (the chunker cannot emit CFI from text —
 * cache.ts:188; real CFI needs the live reader view, injected at query time,
 * deferred to Phase D).
 */
import { getCachedSegmenter } from '@kernel/locale/segmenterCache';

/** ~4 chars per token (matches GeminiClient.estTokens, GeminiClient.ts:80). */
const CHARS_PER_TOKEN = 4;

export interface SectionChunk {
  text: string;
  /** Inclusive start offset into the section's concatenated text. */
  charStart: number;
  /** Exclusive end offset into the section's concatenated text. */
  charEnd: number;
  /** Coarse token count (~chars/4) of this chunk. */
  tokenCount: number;
}

export interface ChunkSectionOptions {
  /** ~Target window size in tokens (default 320). */
  targetTokens?: number;
  /** Fractional overlap between adjacent windows (default 0.15). */
  overlapPct?: number;
  /** BCP-47 locale for sentence segmentation (default 'en'). */
  locale?: string;
}

/** A sentence span `[start, end)` in the section's text. */
interface Sentence {
  start: number;
  end: number;
}

/**
 * Segment `text` into sentence spans, with each span's `end` trimmed to
 * exclude the trailing whitespace the Intl.Segmenter span carries (so a chunk
 * boundary lands right after the sentence terminator, never on a space). Falls
 * back to one whole-text span when Intl.Segmenter is unavailable.
 */
function segmentSentences(text: string, locale: string): Sentence[] {
  const segmenter = getCachedSegmenter(locale);
  if (!segmenter) {
    const trimmedEnd = text.trimEnd().length;
    return trimmedEnd > 0 ? [{ start: 0, end: trimmedEnd }] : [];
  }
  const sentences: Sentence[] = [];
  for (const seg of segmenter.segment(text)) {
    const start = seg.index;
    // Drop trailing whitespace from the segment so `end` sits on the sentence
    // terminator (the leading whitespace stays inside the prior gap).
    const end = start + seg.segment.trimEnd().length;
    if (end > start) sentences.push({ start, end });
  }
  return sentences;
}

/**
 * Chunk a section into sentence-snapped, ~targetTokens windows with ~overlapPct
 * overlap. Each chunk's `text` is exactly `text.slice(charStart, charEnd)`, so
 * the offsets round-trip the source. Empty/whitespace-only text yields no
 * chunks.
 */
export function chunkSection(
  section: { href: string; title: string; text: string },
  options: ChunkSectionOptions = {},
): { chunks: SectionChunk[] } {
  const { targetTokens = 320, overlapPct = 0.15, locale = 'en' } = options;
  const text = section.text;
  if (text.trim().length === 0) return { chunks: [] };

  const targetChars = Math.max(1, targetTokens * CHARS_PER_TOKEN);
  const overlapChars = Math.max(0, Math.floor(targetChars * overlapPct));

  const sentences = segmentSentences(text, locale);
  if (sentences.length === 0) return { chunks: [] };

  const chunks: SectionChunk[] = [];
  let i = 0;
  // When >= 0, the NEXT window begins at this CHAR offset (a mid-sentence
  // overlap continuation into an oversized single sentence) rather than at
  // `sentences[i].start`. See the j===i branch below.
  let charStartOverride = -1;
  while (i < sentences.length) {
    const windowStart = charStartOverride >= 0 ? charStartOverride : sentences[i].start;
    charStartOverride = -1;
    let windowEnd = sentences[i].end;
    let j = i;

    // Grow the window sentence-by-sentence until it reaches ~targetChars,
    // snapping the boundary to a sentence end (never mid-sentence).
    while (
      j + 1 < sentences.length &&
      sentences[j + 1].end - windowStart <= targetChars
    ) {
      j += 1;
      windowEnd = sentences[j].end;
    }

    const chunkText = text.slice(windowStart, windowEnd);
    chunks.push({
      text: chunkText,
      charStart: windowStart,
      charEnd: windowEnd,
      tokenCount: Math.ceil(chunkText.length / CHARS_PER_TOKEN),
    });

    if (j + 1 >= sentences.length) break;

    // Advance with ~overlapPct overlap: the next window starts at the FIRST
    // sentence (after the window's first) that extends into the overlap zone
    // `[windowEnd - overlapChars, windowEnd)`, so adjacent windows share
    // ~overlapChars of context. Always make forward progress (at least one
    // sentence past the window start) to avoid an infinite loop.
    const overlapStart = windowEnd - overlapChars;
    let next = j + 1;
    for (let k = i + 1; k <= j; k++) {
      if (sentences[k].end > overlapStart) {
        next = k;
        break;
      }
    }

    // No sentence in `(i, j]` reached the overlap zone: this window was a SINGLE
    // sentence (j===i) — either genuinely oversized (> targetChars) or merely
    // unable to grow because the next sentence is too big. A sentence-snapped
    // overlap is then impossible (the next sentence starts AT/after windowEnd),
    // so the overlap would be silently lost. Continue the next window from a
    // MID-sentence offset inside the overlap zone so adjacent windows still
    // share ~overlapChars, then still advance `i` past this sentence (no
    // re-chunking of the oversized sentence, guaranteed forward progress).
    if (next > j && overlapChars > 0) {
      const ov = Math.max(windowStart + 1, overlapStart);
      if (ov > windowStart && ov < sentences[next].start) {
        charStartOverride = ov;
      }
    }
    i = Math.max(next, i + 1);
  }

  return { chunks };
}

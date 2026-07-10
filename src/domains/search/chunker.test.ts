/**
 * chunkSection unit suite (Increment C §2): window sizing, overlap continuity,
 * sentence-boundary snapping (no mid-sentence cuts), char-offset round-trip,
 * and the single-sentence / empty-text edge cases.
 */
import { describe, expect, it } from 'vitest';
// Reach the chunker via the published domain surface (the barrel), the same
// way an in-domain consumer would (Increment C §2 barrel export).
import { chunkSection, sectionHasEmbeddableText } from './index';

/**
 * Build N sentences of `wordsPer` words each (deterministic plain text). The
 * first word of each sentence is Capitalized so Intl.Segmenter recognizes the
 * sentence boundaries (it needs a capital-letter sentence start).
 */
function buildText(sentences: number, wordsPer = 12): string {
  const out: string[] = [];
  for (let s = 0; s < sentences; s++) {
    const words: string[] = [];
    for (let w = 0; w < wordsPer; w++) words.push(`${w === 0 ? 'W' : 'w'}${s}x${w}`);
    out.push(`${words.join(' ')}.`);
  }
  return out.join(' ');
}

describe('chunkSection', () => {
  it('returns no chunks for empty / whitespace-only text', () => {
    expect(chunkSection({ href: 'h', title: 't', text: '' }).chunks).toEqual([]);
    expect(chunkSection({ href: 'h', title: 't', text: '   \n  ' }).chunks).toEqual([]);
  });

  it('sectionHasEmbeddableText agrees with whether chunkSection yields chunks', () => {
    // The predicate indexing-progress denominators filter on MUST match the
    // chunker's own empty-text guard, or a text-less section (an image-only
    // cover page) leaves a book stuck one section shy of fully indexed.
    for (const text of ['', '   ', '\n\t ', 'Call me Ishmael.', buildText(3)]) {
      expect(sectionHasEmbeddableText(text)).toBe(
        chunkSection({ href: 'h', title: 't', text }).chunks.length > 0,
      );
    }
  });

  it('keeps a single short section as one chunk spanning the whole text', () => {
    const text = 'Call me Ishmael.';
    const { chunks } = chunkSection({ href: 'h', title: 't', text });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].charStart).toBe(0);
    expect(chunks[0].charEnd).toBe(text.length);
    expect(chunks[0].text).toBe(text);
  });

  it('char offsets reconstruct the source slice exactly', () => {
    const text = buildText(40);
    const { chunks } = chunkSection({ href: 'h', title: 't', text });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text).toBe(text.slice(chunk.charStart, chunk.charEnd));
    }
  });

  it('produces windows near the ~320-token target (≈1280 chars) and snaps to sentence ends', () => {
    const text = buildText(120);
    const { chunks } = chunkSection({ href: 'h', title: 't', text }, { targetTokens: 320 });
    expect(chunks.length).toBeGreaterThan(1);
    const targetChars = 320 * 4;
    for (const chunk of chunks.slice(0, -1)) {
      // Each non-final window stays at/under the target (snapped DOWN to a
      // sentence boundary, never grown past target by a whole sentence).
      expect(chunk.charEnd - chunk.charStart).toBeLessThanOrEqual(targetChars);
      // No mid-sentence cut: every chunk ends at a sentence terminator.
      expect(text[chunk.charEnd - 1]).toBe('.');
    }
  });

  it('overlaps adjacent windows (~15%): each window starts before the previous ended', () => {
    const text = buildText(120);
    const { chunks } = chunkSection(
      { href: 'h', title: 't', text },
      { targetTokens: 80, overlapPct: 0.15 },
    );
    expect(chunks.length).toBeGreaterThan(2);
    let sawOverlap = false;
    for (let i = 1; i < chunks.length; i++) {
      // Forward progress always holds.
      expect(chunks[i].charStart).toBeGreaterThan(chunks[i - 1].charStart);
      if (chunks[i].charStart < chunks[i - 1].charEnd) sawOverlap = true;
    }
    expect(sawOverlap).toBe(true);
  });

  it('keeps overlap when a single sentence exceeds the target window (oversized run)', () => {
    // A run of sentences each LONGER than the target window: every window is a
    // single oversized sentence (j===i). The sentence-snapped overlap is then
    // geometrically impossible (the next sentence starts at/after windowEnd), so
    // the chunker must continue the next window from a MID-sentence offset inside
    // the overlap zone — otherwise the overlap is silently lost (#7).
    const big = `Big ${'wordy '.repeat(120)}tail.`; // ~735 chars, one sentence
    const text = [big, big, big].join(' ');
    const targetChars = 80 * 4; // 320 — each `big` is well over the target
    const { chunks } = chunkSection(
      { href: 'h', title: 't', text },
      { targetTokens: 80, overlapPct: 0.15 },
    );
    expect(chunks.length).toBeGreaterThan(2);

    let sawOverlap = false;
    for (let i = 1; i < chunks.length; i++) {
      // Forward progress always holds even across the oversized sentences.
      expect(chunks[i].charStart).toBeGreaterThan(chunks[i - 1].charStart);
      // No GAP: every window starts at/before the previous window ended.
      expect(chunks[i].charStart).toBeLessThanOrEqual(chunks[i - 1].charEnd);
      if (chunks[i].charStart < chunks[i - 1].charEnd) sawOverlap = true;
    }
    // The overlap is NOT silently lost for the oversized single sentences.
    expect(sawOverlap).toBe(true);
    // Char offsets still round-trip the source exactly (mid-sentence start ok).
    for (const chunk of chunks) {
      expect(chunk.text).toBe(text.slice(chunk.charStart, chunk.charEnd));
    }
    // Full coverage: first chunk at 0, last ends at text length.
    expect(chunks[0].charStart).toBe(0);
    expect(chunks[chunks.length - 1].charEnd).toBe(text.length);
    // The oversized run is NOT re-chunked char-by-char into a flood of windows.
    expect(chunks.length).toBeLessThan(text.length / targetChars + 5);
  });

  it('covers the whole section: the first chunk starts at 0 and the last ends at text length', () => {
    const text = buildText(60);
    const { chunks } = chunkSection({ href: 'h', title: 't', text }, { targetTokens: 60 });
    expect(chunks[0].charStart).toBe(0);
    expect(chunks[chunks.length - 1].charEnd).toBe(text.length);
  });

  it('tokenCount tracks chunk length (~chars/4)', () => {
    const text = buildText(20);
    const { chunks } = chunkSection({ href: 'h', title: 't', text });
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBe(Math.ceil((chunk.charEnd - chunk.charStart) / 4));
    }
  });
});

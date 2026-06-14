/**
 * chunkSection unit suite (Increment C §2): window sizing, overlap continuity,
 * sentence-boundary snapping (no mid-sentence cuts), char-offset round-trip,
 * and the single-sentence / empty-text edge cases.
 */
import { describe, expect, it } from 'vitest';
// Reach the chunker via the published domain surface (the barrel), the same
// way an in-domain consumer would (Increment C §2 barrel export).
import { chunkSection } from './index';

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

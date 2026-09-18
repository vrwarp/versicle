/**
 * fuseRrf suite (Increment D §3): reciprocal-rank fusion ordering, dedup on
 * href+charOffset, and truncated propagation. Pure — no engine, no ports.
 */
import { describe, it, expect } from 'vitest';
import { fuseRrf } from './rrf';
import type { DetailedSearchResult } from '~types/search';

const hit = (href: string, charOffset: number, occurrence = 1): DetailedSearchResult => ({
  href,
  charOffset,
  matchLength: 5,
  occurrence,
  excerpt: `${href}@${charOffset}`,
});

describe('fuseRrf', () => {
  it('fuses by summed reciprocal rank (a result in both lists outranks either alone)', () => {
    // A is #1 regex AND #1 semantic → highest combined score.
    const regex = [hit('a', 0), hit('b', 10), hit('c', 20)];
    const semantic = [hit('a', 0), hit('d', 30), hit('b', 10)];

    const { results } = fuseRrf(regex, semantic, { k: 60 });

    // Reciprocal-rank scores (k=60):
    //   a: 1/61 + 1/61 = 0.03279
    //   b: 1/62 + 1/63 = 0.03200
    //   c: 1/63          = 0.01587
    //   d: 1/62          = 0.01613
    // → a, b, d, c
    expect(results.map((r) => `${r.href}|${r.charOffset}`)).toEqual([
      'a|0',
      'b|10',
      'd|30',
      'c|20',
    ]);
  });

  it('dedups on href + charOffset (same occurrence found by both fuses to one hit)', () => {
    const regex = [hit('ch1.xhtml', 100, 7)];
    const semantic = [hit('ch1.xhtml', 100, 3)];

    const { results } = fuseRrf(regex, semantic);

    expect(results).toHaveLength(1);
    // Regex is accumulated first → its richer occurrence wins the dedup tie.
    expect(results[0].occurrence).toBe(7);
  });

  it('keeps distinct occurrences in the same section separate (different charOffset)', () => {
    const regex = [hit('ch1.xhtml', 0), hit('ch1.xhtml', 50)];
    const semantic: DetailedSearchResult[] = [];

    const { results } = fuseRrf(regex, semantic);
    expect(results.map((r) => r.charOffset)).toEqual([0, 50]);
  });

  it('propagates truncated from the caller (regex scan cap)', () => {
    expect(fuseRrf([hit('a', 0)], [], { truncated: true }).truncated).toBe(true);
    expect(fuseRrf([hit('a', 0)], []).truncated).toBe(false);
  });

  it('returns the non-empty list when the other is empty', () => {
    const semantic = [hit('z', 5), hit('y', 9)];
    const { results } = fuseRrf([], semantic);
    expect(results.map((r) => r.href)).toEqual(['z', 'y']);
  });

  /**
   * The semantic side contributes up to 50 chunk rows PER SECTION, so a
   * 30-section book fused ~1500 hits into an uncapped list the search panel
   * rendered one `<li>` at a time. The fused page is now cut after the score
   * sort, and says so.
   */
  describe('regression: fused results are capped', () => {
    it('keeps the best-ranked page and flags the cut as truncated', () => {
      const semantic = Array.from({ length: 1500 }, (_unused, i) => hit('ch1.xhtml', i * 10));

      const { results, truncated } = fuseRrf([], semantic);

      expect(results).toHaveLength(100);
      expect(truncated).toBe(true);
      // The survivors are the top of the ranking, in order — nothing reshuffled.
      expect(results.map((r) => r.charOffset)).toEqual(
        semantic.slice(0, 100).map((r) => r.charOffset),
      );
    });

    it('every regex hit survives the cap (regex is never displaced by semantic)', () => {
      const regex = Array.from({ length: 50 }, (_unused, i) => hit('ch1.xhtml', i * 10, i + 1));
      const semantic = Array.from({ length: 1500 }, (_unused, i) => hit('ch2.xhtml', i * 10));

      const { results } = fuseRrf(regex, semantic);

      expect(results).toHaveLength(100);
      for (const r of regex) {
        expect(results.some((x) => x.href === r.href && x.charOffset === r.charOffset)).toBe(true);
      }
    });

    it('does not flag truncation when everything fits', () => {
      expect(fuseRrf([hit('a', 0)], [hit('b', 1)]).truncated).toBe(false);
    });

    it('honors an explicit limit', () => {
      const semantic = Array.from({ length: 10 }, (_unused, i) => hit('ch1.xhtml', i));
      const { results, truncated } = fuseRrf([], semantic, { limit: 3 });
      expect(results).toHaveLength(3);
      expect(truncated).toBe(true);
    });
  });
});

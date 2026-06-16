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
});

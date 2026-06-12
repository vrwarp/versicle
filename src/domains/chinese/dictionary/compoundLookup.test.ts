/**
 * compoundLookup suite (Phase 6 §7.4, PR-11): legacy getCompoundWord
 * semantics (4-left/4-right windows, longest hit wins, earliest start on
 * ties) plus the deliberate CH-1-consistent fix: windows are CODE-POINT
 * windows, so astral text never slices through surrogate pairs.
 */
import { describe, it, expect } from 'vitest';
import type { DictEntryTuple } from '@data/repos/dictionary';
import { compoundCandidates, findCompoundWord } from './compoundLookup';

const dictOf = (entries: Record<string, DictEntryTuple>) =>
  async (words: readonly string[]): Promise<Map<string, DictEntryTuple>> => {
    const result = new Map<string, DictEntryTuple>();
    for (const word of words) {
      if (entries[word]) result.set(word, entries[word]);
    }
    return result;
  };

describe('compoundCandidates', () => {
  it('emits multi-char windows reaching 4 left / 4 right of the focus', () => {
    const candidates = compoundCandidates('我们是朋友', 3); // 朋
    expect(candidates).toContain('朋友');
    expect(candidates).toContain('是朋');
    expect(candidates).toContain('我们是朋友');
    expect(candidates).not.toContain('朋'); // single chars excluded
    // Every candidate covers the focused character.
    for (const candidate of candidates) {
      expect(candidate.includes('朋')).toBe(true);
    }
  });

  it('clamps at text boundaries', () => {
    expect(compoundCandidates('你好', 0)).toEqual(['你好']);
    expect(compoundCandidates('好', 0)).toEqual([]);
  });

  it('windows are code-point windows (astral text never slices surrogates)', () => {
    const text = '\u{20000}朋友';
    const candidates = compoundCandidates(text, 1); // 朋 (code-point index)
    expect(candidates).toContain('朋友');
    expect(candidates).toContain('\u{20000}朋');
    for (const candidate of candidates) {
      // No lone surrogate halves anywhere.
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(candidate)).toBe(false);
    }
  });
});

describe('findCompoundWord', () => {
  const entries: Record<string, DictEntryTuple> = {
    朋友: ['péng you', 'friend; companion'],
    好朋友: ['hǎo péng you', 'good friend'],
    我们: ['wǒ men', 'we; us'],
  };

  it('returns the longest dictionary hit covering the focus', async () => {
    const hit = await findCompoundWord('好朋友', 1, dictOf(entries));
    expect(hit).toEqual({ word: '好朋友', pinyin: 'hǎo péng you', definition: 'good friend' });
  });

  it('falls back to shorter hits and returns null when nothing matches', async () => {
    expect(await findCompoundWord('些朋友', 1, dictOf(entries))).toMatchObject({ word: '朋友' });
    expect(await findCompoundWord('一二三', 1, dictOf(entries))).toBeNull();
  });

  it('issues ONE batched lookup over unique candidates', async () => {
    let calls = 0;
    const lookup = async (words: readonly string[]) => {
      calls += 1;
      expect(new Set(words).size).toBe(words.length);
      return dictOf(entries)(words);
    };
    await findCompoundWord('我们是朋友', 3, lookup);
    expect(calls).toBe(1);
  });

  it('legacy tie-break: the FIRST strictly-longer hit (earliest start) wins', async () => {
    const tied: Record<string, DictEntryTuple> = {
      是朋: ['shì péng', 'left window'],
      朋友: ['péng you', 'right window'],
    };
    const hit = await findCompoundWord('是朋友', 1, dictOf(tied));
    // Both are length 2; the scan order (start asc) keeps 是朋.
    expect(hit?.word).toBe('是朋');
  });
});

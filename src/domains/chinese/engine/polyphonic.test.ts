/**
 * polyphonic override suite — the curated 多音字 corrections layered on top
 * of pinyin-pro in getPinyin (see ./polyphonic.ts).
 *
 * Two layers of assertion:
 *  - applyPolyphonicOverrides() in isolation (pure, no pinyin-pro), pinning
 *    the context-word matching, first-occurrence position, longest-match
 *    precedence, and Simplified/Traditional symmetry;
 *  - getPinyin() end-to-end, proving the curated readings that pinyin-pro
 *    gets wrong on its own are corrected, and the ones it gets right survive.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { ensurePinyin, getPinyin } from './PinyinGeometryEngine';
import {
  POLYPHONIC_ENTRIES,
  applyPolyphonicOverrides,
} from './polyphonic';

/** Reading at the first occurrence of `char` in `word`, via getPinyin. */
function reading(word: string, char: string): string {
  const cps = Array.from(word);
  return getPinyin(word)[cps.indexOf(char)];
}

describe('applyPolyphonicOverrides (pure, pinyin-pro independent)', () => {
  it('forces the alternate reading when a context word is present', () => {
    // 乐 base "lè"; 圣乐 selects "yuè" at index 1.
    expect(applyPolyphonicOverrides('圣乐', ['shèng', 'lè'])).toEqual(['shèng', 'yuè']);
  });

  it('leaves text with no context word untouched (same array values)', () => {
    expect(applyPolyphonicOverrides('快乐', ['kuài', 'lè'])).toEqual(['kuài', 'lè']);
  });

  it('does not mutate the input array', () => {
    const input = ['shèng', 'lè'];
    applyPolyphonicOverrides('圣乐', input);
    expect(input).toEqual(['shèng', 'lè']);
  });

  it('overrides only the FIRST occurrence of the char (恶恶 = wù è)', () => {
    // 恶 → wù via 恶恶; the trailing 恶 keeps pinyin-pro's default (è here).
    expect(applyPolyphonicOverrides('恶恶', ['è', 'è'])).toEqual(['wù', 'è']);
  });

  it('merges entries that share a context word (参差 → cēn cī)', () => {
    expect(applyPolyphonicOverrides('参差', ['shēn', 'chà'])).toEqual(['cēn', 'cī']);
  });

  it('longest context word wins (目的地 keeps 地→dì at index 2)', () => {
    // Both 目的地 and (hypothetically) shorter windows resolve 地→dì here;
    // the precedence rule is what guarantees a longer, more specific word
    // is not clobbered by a shorter one.
    expect(applyPolyphonicOverrides('目的地', ['mù', 'dì', 'de'])).toEqual(['mù', 'dì', 'dì']);
  });

  it('aligns by code point — an astral char before the word does not shift it', () => {
    const text = '\u{20000}圣乐'; // code points: [𠀀, 圣, 乐]
    expect(applyPolyphonicOverrides(text, ['\u{20000}', 'shèng', 'lè'])).toEqual([
      '\u{20000}',
      'shèng',
      'yuè',
    ]);
  });

  it('every entry character actually appears in each of its context words', () => {
    for (const entry of POLYPHONIC_ENTRIES) {
      for (const alt of entry.alternates) {
        for (const word of alt.words) {
          expect(Array.from(word)).toContain(entry.char);
        }
      }
    }
  });
});

describe('getPinyin polyphonic correction (end-to-end with pinyin-pro)', () => {
  beforeAll(async () => {
    await ensurePinyin();
  });

  it('corrects readings pinyin-pro gets wrong on its own', () => {
    expect(reading('圣乐', '乐')).toBe('yuè');
    expect(reading('诗乐', '乐')).toBe('yuè');
    expect(reading('行传', '传')).toBe('zhuàn');
    expect(reading('受难', '难')).toBe('nàn');
    expect(reading('朝露', '朝')).toBe('zhāo');
    expect(reading('圣都', '都')).toBe('dū');
    expect(reading('受创', '创')).toBe('chuāng');
    expect(reading('和面', '和')).toBe('huó');
    expect(reading('教书', '教')).toBe('jiāo');
    expect(reading('夹杂', '夹')).toBe('jiá');
    expect(reading('你得', '得')).toBe('děi');
  });

  it('corrects the Traditional forms identically', () => {
    expect(reading('聖樂', '樂')).toBe('yuè');
    expect(reading('行傳', '傳')).toBe('zhuàn');
    expect(reading('受難', '難')).toBe('nàn');
  });

  it('does not regress the cases pinyin-pro already handles', () => {
    expect(reading('银行', '行')).toBe('háng');
    expect(reading('重生', '重')).toBe('chóng');
    expect(reading('音乐', '乐')).toBe('yuè');
    expect(reading('首都', '都')).toBe('dū');
    expect(reading('觉得', '得')).toBe('de');
    expect(reading('睡着', '着')).toBe('zháo');
  });

  it('does not over-fire on unrelated text', () => {
    expect(reading('快乐', '乐')).toBe('lè');
    expect(reading('你好世界', '好')).toBe('hǎo');
  });
});

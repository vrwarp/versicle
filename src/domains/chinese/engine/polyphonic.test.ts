/**
 * polyphonic override suite — the trimmed, safe 多音字 corrections layered on
 * top of pinyin-pro in getPinyin (see ./polyphonic.ts).
 *
 * Three layers of assertion:
 *  - applyPolyphonicOverrides() in isolation (pure, no pinyin-pro), pinning
 *    the context-word matching, first-occurrence position, shared-word merge,
 *    and code-point alignment;
 *  - getPinyin() end-to-end, proving the curated readings pinyin-pro gets
 *    wrong are corrected while the cases it already handles are untouched and
 *    the deliberately-dropped collision-prone characters do NOT over-fire;
 *  - an invariant that the curated set is non-redundant — every trigger word
 *    is one bare pinyin-pro actually reads differently.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pinyin } from 'pinyin-pro';
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

  it('overrides only the FIRST occurrence of the char (惡惡 = wù è)', () => {
    // 惡 → wù via 惡惡; the trailing 惡 keeps pinyin-pro's default (è here).
    expect(applyPolyphonicOverrides('惡惡', ['è', 'è'])).toEqual(['wù', 'è']);
  });

  it('merges entries that share a context word (參差 → cēn cī)', () => {
    // 參 contributes index 0 → cēn; 差 contributes index 1 → cī.
    expect(applyPolyphonicOverrides('參差', ['shēn', 'chà'])).toEqual(['cēn', 'cī']);
  });

  it('resolves overlapping windows consistently (受創傷 keeps 創→chuāng)', () => {
    // 受創 (start 0, 創 at index 1) and 創傷 (start 1, 創 at index 0) both
    // target the same 創 — the override lands once, deterministically.
    expect(applyPolyphonicOverrides('受創傷', ['shòu', 'chuàng', 'shāng'])).toEqual([
      'shòu',
      'chuāng',
      'shāng',
    ]);
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

  it('corrects the rare/domain Simplified words pinyin-pro lacks', () => {
    expect(reading('圣乐', '乐')).toBe('yuè');
    expect(reading('诗乐', '乐')).toBe('yuè');
    expect(reading('行传', '传')).toBe('zhuàn');
    expect(reading('受难', '难')).toBe('nàn');
    expect(reading('圣都', '都')).toBe('dū');
    expect(reading('受创', '创')).toBe('chuāng');
    expect(reading('夹杂', '夹')).toBe('jiá');
    expect(reading('朝露', '朝')).toBe('zhāo');
  });

  it('corrects the Traditional forms pinyin-pro mis-reads wholesale', () => {
    expect(reading('聖樂', '樂')).toBe('yuè');
    expect(reading('行傳', '傳')).toBe('zhuàn');
    expect(reading('受難', '難')).toBe('nàn');
    expect(reading('回應', '應')).toBe('yìng');
    expect(reading('睡覺', '覺')).toBe('jiào');
    expect(reading('重擔', '擔')).toBe('dàn');
    expect(reading('銀行', '行')).toBe('háng');
    expect(reading('重來', '重')).toBe('chóng');
    expect(reading('參差', '參')).toBe('cēn');
    expect(reading('參差', '差')).toBe('cī');
  });

  it('does not regress the cases pinyin-pro already handles (no override added)', () => {
    expect(reading('银行', '行')).toBe('háng');
    expect(reading('重生', '重')).toBe('chóng');
    expect(reading('音乐', '乐')).toBe('yuè');
    expect(reading('首都', '都')).toBe('dū');
    expect(reading('觉得', '得')).toBe('de');
    expect(reading('睡着', '着')).toBe('zháo');
  });

  it('does not over-fire on unrelated text or dropped collision-prone chars', () => {
    expect(reading('快乐', '乐')).toBe('lè');
    expect(reading('你好世界', '好')).toBe('hǎo');
    // 长/地 were intentionally dropped — pinyin-pro already reads them right,
    // and a blunt override would mis-fire on running text like 成长期.
    expect(reading('成长期', '长')).toBe('zhǎng');
    expect(reading('地上', '地')).toBe('dì');
  });
});

describe('curated set is non-redundant (trim invariant)', () => {
  beforeAll(async () => {
    await ensurePinyin();
  });

  it('every trigger word is one bare pinyin-pro reads differently', () => {
    for (const entry of POLYPHONIC_ENTRIES) {
      for (const alt of entry.alternates) {
        for (const word of alt.words) {
          const idx = Array.from(word).indexOf(entry.char);
          const bare = pinyin(word, { type: 'array', toneType: 'symbol' })[idx];
          // If bare pinyin-pro already produced the alternate, the entry would
          // be dead weight — keep the set honest by failing here.
          expect(bare, `${word} (${entry.char}) is redundant`).not.toBe(alt.reading);
        }
      }
    }
  });
});

/**
 * PinyinGeometryEngine unit suite (Phase 6 §7.1, prep doc PR-10).
 *
 * ABSORPTION NOTE: the alignment/geometry assertions here carry forward the
 * P6 entry-gate characterization that lived in
 * src/hooks/useEpubReader_Pinyin.characterization.test.tsx (deleted in the
 * same commit) — the pinyin pass left useEpubReader, so its owning suite
 * moved with it. Same synthetic-glyph fixture: 10 px per UTF-16 code unit,
 * geometry pinned as exact offset arithmetic.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  HAN_RE,
  collectNodePinyinPositions,
  ensurePinyin,
  findHanTextNodes,
  getPinyin,
} from './PinyinGeometryEngine';

/** Synthetic glyph advance: 10px per UTF-16 CODE UNIT (range offsets are code units). */
const UNIT_PX = 10;
const IFRAME_OFFSET = { top: 100, left: 50 };

/**
 * jsdom has no layout; createRange is replaced with a synthetic range whose
 * rect derives from the recorded code-unit offsets, so the assertions pin
 * the exact offset arithmetic of the production loop.
 */
function makeFixtureDoc(text: string): { doc: Document; textNode: Text } {
  const doc = document.implementation.createHTMLDocument('fixture');
  const p = doc.createElement('p');
  p.textContent = text;
  doc.body.appendChild(p);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (doc as any).createRange = () => {
    let start = 0;
    let end = 0;
    return {
      setStart: (_node: Node, offset: number) => {
        start = offset;
      },
      setEnd: (_node: Node, offset: number) => {
        end = offset;
      },
      getBoundingClientRect: () => ({
        top: 0,
        left: start * UNIT_PX,
        right: end * UNIT_PX,
        bottom: 20,
        width: (end - start) * UNIT_PX,
        height: 20,
      }),
    };
  };

  return { doc, textNode: p.firstChild as Text };
}

describe('PinyinGeometryEngine (characterization heritage: P6 entry gate)', () => {
  beforeAll(async () => {
    await ensurePinyin();
  });

  it('BMP text: one position per Han char, pinyin aligned, geometry = rect + iframe offsets', () => {
    const text = '你好世界';
    const { doc, textNode } = makeFixtureDoc(text);

    const positions = collectNodePinyinPositions(doc, textNode, IFRAME_OFFSET);
    expect(positions.length).toBe(4);
    const expectedPinyin = getPinyin(text);

    positions.forEach((pos, i) => {
      expect(pos.char).toBe(text[i]);
      expect(pos.pinyin).toBe(expectedPinyin[i]);
      // top = rect.top(0) + iframe.offsetTop; left = rect.left +
      // iframe.offsetLeft + rect.width / 2 (character center).
      expect(pos.top).toBe(IFRAME_OFFSET.top);
      expect(pos.left).toBe(i * UNIT_PX + IFRAME_OFFSET.left + UNIT_PX / 2);
      expect(pos.width).toBe(UNIT_PX);
      expect(pos.height).toBe(20);
    });
  });

  it('CH-1 fixed: astral Han keeps per-code-point pinyin at code-unit geometry', () => {
    const text = '\u{20000}中文好'; // code units: [D840, DC00, 中, 文, 好]
    const { doc, textNode } = makeFixtureDoc(text);

    const positions = collectNodePinyinPositions(doc, textNode, IFRAME_OFFSET);
    // 𠀀 is \p{Script=Han}; pinyin-pro returns the char itself for unknown
    // readings (the pre-existing BMP behavior, now uniform for Ext-B Han).
    expect(positions.length).toBe(4);
    const p = getPinyin(text); // per CODE POINT: [𠀀, zhōng, wén, hǎo]

    const expected = [
      { char: '\u{20000}', pinyin: p[0], unitStart: 0, unitLen: 2 },
      { char: '中', pinyin: p[1], unitStart: 2, unitLen: 1 },
      { char: '文', pinyin: p[2], unitStart: 3, unitLen: 1 },
      { char: '好', pinyin: p[3], unitStart: 4, unitLen: 1 },
    ];
    expected.forEach((exp, i) => {
      expect(positions[i].char).toBe(exp.char);
      expect(positions[i].pinyin).toBe(exp.pinyin);
      expect(positions[i].width).toBe(exp.unitLen * UNIT_PX);
      expect(positions[i].left).toBe(
        exp.unitStart * UNIT_PX + IFRAME_OFFSET.left + (exp.unitLen * UNIT_PX) / 2,
      );
    });
  });

  it('CH-1 fixed: an emoji neither starves nor shifts the Han chars after it', () => {
    const text = '考\u{1F600}试'; // code units: [考, D83D, DE00, 试]
    const { doc, textNode } = makeFixtureDoc(text);

    const positions = collectNodePinyinPositions(doc, textNode, IFRAME_OFFSET);
    expect(positions.length).toBe(2);
    const p = getPinyin(text); // per CODE POINT: [kǎo, 😀, shì]
    expect(positions[0].char).toBe('考');
    expect(positions[0].pinyin).toBe(p[0]);
    expect(positions[0].left).toBe(0 * UNIT_PX + IFRAME_OFFSET.left + UNIT_PX / 2);
    expect(positions[1].char).toBe('试');
    expect(positions[1].pinyin).toBe(p[2]);
    expect(positions[1].left).toBe(3 * UNIT_PX + IFRAME_OFFSET.left + UNIT_PX / 2);
  });

  it('HAN_RE covers Ext-B astral Han and rejects emoji/Latin', () => {
    expect(HAN_RE.test('\u{20000}')).toBe(true);
    expect(HAN_RE.test('中')).toBe(true);
    expect(HAN_RE.test('\u{1F600}')).toBe(false);
    expect(HAN_RE.test('a')).toBe(false);
  });

  it('reads pinyin from the source text but geometry from the displayed glyphs', () => {
    // Displayed Traditional 樂器, pinyin source Simplified 乐器 (1:1 aligned).
    const { doc, textNode } = makeFixtureDoc('樂器');
    const positions = collectNodePinyinPositions(doc, textNode, IFRAME_OFFSET, '乐器');

    expect(positions.map((p) => p.char)).toEqual(['樂', '器']); // displayed glyphs
    expect(positions.map((p) => p.pinyin)).toEqual(getPinyin('乐器')); // source readings
    expect(positions[0].pinyin).toBe('yuè'); // not lè (the Traditional-direct bug)
  });

  it('falls back to the displayed text when the source code-point count differs', () => {
    // A mismatched source must never misalign readings against the rects.
    const { doc, textNode } = makeFixtureDoc('樂');
    const positions = collectNodePinyinPositions(doc, textNode, IFRAME_OFFSET, '乐器');

    expect(positions).toHaveLength(1);
    expect(positions[0].char).toBe('樂');
    expect(positions[0].pinyin).toBe(getPinyin('樂')[0]); // computed from displayed
  });

  it('findHanTextNodes finds astral-only nodes and skips ruby annotations', () => {
    const doc = document.implementation.createHTMLDocument('fixture');
    doc.body.innerHTML =
      '<p id="astral"></p><p id="latin">hello</p><ruby>汉<rt>hàn</rt></ruby>';
    // Ext-B-only content — invisible to the legacy BMP block test.
    doc.getElementById('astral')!.textContent = '\u{20000}\u{20001}';

    const nodes = findHanTextNodes(doc);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].textContent).toBe('\u{20000}\u{20001}');
  });
});

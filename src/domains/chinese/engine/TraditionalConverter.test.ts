/**
 * TraditionalConverter unit suite (Phase 6 §7.3, prep doc PR-10): the
 * `_originalText` round-trip keeper semantics + the NEW CH-7 length guard.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  __resetOpenCCForTests,
  __setOpenCCForTests,
  applyDisplayScript,
  ensureOpenCC,
  toTraditional,
  traditionalGuardRecorder,
} from './TraditionalConverter';

const makeTextNode = (text: string): Text => {
  const doc = document.implementation.createHTMLDocument('fixture');
  const p = doc.createElement('p');
  p.textContent = text;
  doc.body.appendChild(p);
  return p.firstChild as Text;
};

describe('TraditionalConverter', () => {
  beforeEach(() => {
    __resetOpenCCForTests();
  });

  it('round-trips the text node via the _originalText cache (characterization heritage)', async () => {
    await ensureOpenCC();
    const text = '这是一本测试用的中文书';
    const node = makeTextNode(text);

    // Toggle ON: in-place nodeValue mutation to traditional.
    const displayed = applyDisplayScript(node, true);
    expect(displayed).toBe('這是一本測試用的中文書');
    expect(node.nodeValue).toBe('這是一本測試用的中文書');

    // Toggle OFF: restored byte-for-byte from _originalText.
    const restored = applyDisplayScript(node, false);
    expect(restored).toBe(text);
    expect(node.nodeValue).toBe(text);
  });

  it('toTraditional throws before ensureOpenCC (no implicit loads inside the DOM loop)', () => {
    expect(() => toTraditional('汉')).toThrow(/ensureOpenCC/);
  });

  it('CH-7 guard: a length-changing conversion skips the node and records a diagnostics event', () => {
    // Stub converter violating the single-char invariant.
    __setOpenCCForTests((text) => `${text}!`);
    const text = '汉字';
    const node = makeTextNode(text);
    const eventsBefore = traditionalGuardRecorder.export().length;

    const displayed = applyDisplayScript(node, true);

    // Node untouched — a length change would desync every code-unit offset
    // computed against the displayed text (ranges, CFIs, pinyin geometry).
    expect(displayed).toBe(text);
    expect(node.nodeValue).toBe(text);

    const events = traditionalGuardRecorder.export();
    expect(events.length).toBe(eventsBefore + 1);
    expect(events[events.length - 1].ev).toBe('traditional-length-mismatch');
    expect(events[events.length - 1].d).toMatchObject({
      originalLength: 2,
      translatedLength: 3,
    });
  });

  it('CH-7 guard: after a violation the node still restores to the original on toggle-off', () => {
    __setOpenCCForTests((text) => text.replace('汉', '漢漢'));
    const text = '汉字';
    const node = makeTextNode(text);

    applyDisplayScript(node, true);
    expect(node.nodeValue).toBe(text);
    const restored = applyDisplayScript(node, false);
    expect(restored).toBe(text);
    expect(node.nodeValue).toBe(text);
  });
});

/**
 * P6 ENTRY GATE — PinyinOverlay characterization (jsdom tier).
 *
 * Pins the overlay's CURRENT contract before the Phase 6 ReaderOverlay /
 * MeasuredOverlay consolidation (prep/phase6-reader-engine.md §4 overlay #6):
 *
 *  - geometry portal into the epub.js container node;
 *  - decorative contract: aria-hidden + pointer-events: none (PinyinOverlay
 *    already conforms — the ReaderOverlay cutover must keep this);
 *  - known-character suppression filters by the DISPLAYED character key
 *    (the verified CH-6 displayed-script behavior: a char known under its
 *    simplified key is still annotated when displayed as traditional —
 *    PR-13's canonicalization deliberately changes that, with this pin
 *    rewritten in the same commit).
 */
import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { PinyinOverlay, type PinyinPosition } from './PinyinOverlay';
import { usePreferencesStore } from '@store/usePreferencesStore';
import { useVocabularyStore } from '@store/useVocabularyStore';

const pos = (char: string, pinyin: string, left: number): PinyinPosition => ({
  char,
  pinyin,
  top: 100,
  left,
  width: 10,
  height: 20,
});

describe('characterization: PinyinOverlay (P6 entry gate)', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    usePreferencesStore.setState({ currentTheme: 'light' });
    useVocabularyStore.setState({ knownCharacters: {} });
  });

  it('portals one decorative span per position into the container node', () => {
    render(
      <PinyinOverlay
        positions={[pos('中', 'zhōng', 55), pos('文', 'wén', 65)]}
        pinyinSize={100}
        containerNode={container}
      />,
    );

    const wrapper = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(wrapper).toBeTruthy();
    // Decorative contract: hidden from the a11y tree AND click-transparent.
    expect(wrapper.className).toContain('pointer-events-none');

    const spans = wrapper.querySelectorAll('span');
    expect(spans.length).toBe(2);
    expect(spans[0].textContent).toBe('zhōng');
    expect(spans[1].textContent).toBe('wén');
    // Anchored just above the character center (top - 2, translate -50%/-100%).
    expect(spans[0].style.top).toBe('98px');
    expect(spans[0].style.left).toBe('55px');
  });

  it('suppresses pinyin for known characters by their DISPLAYED key (CH-6 pin)', () => {
    useVocabularyStore.setState({ knownCharacters: { 中: 1 } });

    render(
      <PinyinOverlay
        positions={[pos('中', 'zhōng', 55), pos('文', 'wén', 65)]}
        pinyinSize={100}
        containerNode={container}
      />,
    );

    const spans = container.querySelectorAll('span');
    expect(spans.length).toBe(1);
    expect(spans[0].textContent).toBe('wén');
  });

  it('CH-6 fixed (rewritten pin): a char known under its simplified key IS suppressed when displayed traditional', () => {
    // 书 (simplified) is known; the displayed glyph is 書 (traditional).
    // PR-13 (vocabulary canonicalization, CRDT v7): the filter
    // canonicalizes the DISPLAYED char before the lookup, so suppression
    // works in both display scripts. Rewritten in the PR-13 commit — an
    // enumerated characterization delta, per the pin's own instruction.
    useVocabularyStore.setState({ knownCharacters: { 书: 1 } });

    render(
      <PinyinOverlay
        positions={[pos('書', 'shū', 55), pos('文', 'wén', 65)]}
        pinyinSize={100}
        containerNode={container}
      />,
    );

    const spans = container.querySelectorAll('span');
    expect(spans.length).toBe(1);
    expect(spans[0].textContent).toBe('wén');
  });

  it('renders nothing without a container node or positions', () => {
    const { rerender } = render(
      <PinyinOverlay positions={[pos('中', 'zhōng', 55)]} pinyinSize={100} containerNode={null} />,
    );
    expect(document.querySelectorAll('span').length).toBe(0);

    rerender(<PinyinOverlay positions={[]} pinyinSize={100} containerNode={container} />);
    expect(container.querySelectorAll('span').length).toBe(0);
  });
});

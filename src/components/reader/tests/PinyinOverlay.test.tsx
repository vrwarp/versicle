/**
 * PinyinOverlay characterization (jsdom tier).
 *
 * Pins the overlay's contract:
 *
 *  - geometry portal into the epub.js container node;
 *  - decorative contract: aria-hidden + pointer-events: none;
 *  - known-character suppression canonicalizes the DISPLAYED character
 *    before the vocabulary lookup, so a char known under its simplified key
 *    is suppressed when displayed as traditional.
 */
import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { PinyinOverlay, type PinyinPosition } from '../PinyinOverlay';
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
    // The filter canonicalizes the DISPLAYED char (vocabulary
    // canonicalization) before the lookup, so suppression works in both
    // display scripts.
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

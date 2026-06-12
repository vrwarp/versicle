/**
 * P6 ENTRY GATE — pinyin geometry/alignment characterization (jsdom tier).
 *
 * Pins the CURRENT behavior of useEpubReader's `processChineseContent`
 * (useEpubReader.ts:599-699) before the Phase 6 chinese extraction touches
 * it (prep/phase6-reader-engine.md §Test plan, program rule 7), including
 * the verified CH-1 bug: the loop iterates CODE UNITS while pinyin-pro
 * returns one entry per CODE POINT, so
 *
 *   - astral-plane Han (U+20000 𠀀, surrogate pair) gets NO pinyin (the
 *     `[一-鿿]` test rejects each surrogate half), and
 *   - every BMP Han char AFTER an astral char reads its pinyin from a
 *     shifted index (off-by-one per preceding astral char).
 *
 * The CH-1 fix (prep doc PR-1 — a different work item) flips the
 * `it.fails` case below to a plain `it` and must REWRITE the two
 * misalignment pins in the same commit (an enumerated characterization
 * delta, not a silent edit).
 *
 * The E2E companion (verification/test_characterization_pinyin.spec.ts)
 * covers the same surface against the real renderer in the Docker lane.
 */
import React, { useRef, useState } from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { useEpubReader, type EpubReaderOptions } from './useEpubReader';
import { usePreferencesStore } from '@store/usePreferencesStore';
import { useBookStore } from '@store/useBookStore';
import { ensurePinyin, getPinyin } from '@lib/chinese/ChineseTextProcessor';
import type { PinyinPosition } from '@components/reader/PinyinOverlay';
import type { UserInventoryItem } from '~types/db';

vi.mock('@data/repos/bookContent', () => ({
  bookContent: {
    getBookFile: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    getLocations: vi.fn().mockResolvedValue(null),
    saveLocations: vi.fn().mockResolvedValue(undefined),
  },
}));

// Shared slot the hoisted epubjs mock reads at render time.
const slot = vi.hoisted(() => ({ contents: null as unknown }));

vi.mock('epubjs', () => ({
  default: vi.fn().mockImplementation(() => ({
    renderTo: vi.fn().mockImplementation((element: HTMLElement) => {
      const iframe = document.createElement('iframe');
      element.appendChild(iframe);
      return {
        themes: {
          register: vi.fn(),
          select: vi.fn(),
          fontSize: vi.fn(),
          font: vi.fn(),
          default: vi.fn(),
        },
        display: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        off: vi.fn(),
        hooks: { content: { register: vi.fn() } },
        spread: vi.fn(),
        flow: vi.fn(),
        resize: vi.fn(),
        getContents: vi.fn(() => (slot.contents ? [slot.contents] : [])),
        location: null,
      };
    }),
    loaded: { navigation: Promise.resolve({ toc: [] }) },
    ready: Promise.resolve(),
    destroy: vi.fn(),
    locations: {
      generate: vi.fn().mockResolvedValue(undefined),
      save: vi.fn(() => '[]'),
      load: vi.fn(),
      percentageFromCfi: vi.fn(),
    },
    spine: { get: vi.fn(), hooks: { serialize: { register: vi.fn() } } },
  })),
}));

const BOOK_ID = 'zh-book';
const IFRAME_OFFSET = { top: 100, left: 50 };
/** Synthetic glyph advance: 10px per UTF-16 CODE UNIT (range offsets are code units). */
const UNIT_PX = 10;

/**
 * Builds an epub.js `Contents`-shaped fixture around a real jsdom document.
 * jsdom ranges have no layout, so createRange is replaced with a synthetic
 * range whose rect derives from the recorded code-unit offsets — geometry
 * assertions then pin the exact offset arithmetic of the production loop.
 */
function makeFakeContents(text: string) {
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

  return {
    document: doc,
    window: {
      frameElement: { offsetTop: IFRAME_OFFSET.top, offsetLeft: IFRAME_OFFSET.left },
      getSelection: () => null,
    },
    cfiFromRange: () => 'epubcfi(/6/2!/4/2)',
    textNode: p.firstChild as Text,
  };
}

let latestPositions: PinyinPosition[] = [];

const TestHost: React.FC = () => {
  const viewerRef = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);
  const options: EpubReaderOptions = {
    viewMode: 'paginated',
    currentTheme: 'light',
    customTheme: { bg: '#fff', fg: '#000' },
    fontFamily: 'serif',
    fontSize: 100,
    lineHeight: 1.5,
    shouldForceFont: false,
    onPinyinPositionsUpdate: (positions) => {
      latestPositions = positions as PinyinPosition[];
      setTick((t) => t + 1);
    },
  };
  useEpubReader(BOOK_ID, viewerRef as unknown as React.RefObject<HTMLElement>, options);
  return <div ref={viewerRef} data-testid="viewer" />;
};

const seedZhBook = () => {
  const item: UserInventoryItem = {
    bookId: BOOK_ID,
    title: '测试',
    author: '测试',
    addedAt: 1,
    lastInteraction: 1,
    tags: [],
    status: 'reading',
    language: 'zh',
  } as UserInventoryItem;
  useBookStore.setState({ books: { [BOOK_ID]: item } });
};

describe('characterization: pinyin geometry pipeline (P6 entry gate)', () => {
  beforeAll(async () => {
    // The hook awaits ensurePinyin() itself; pre-warming keeps getPinyin
    // callable inside the test bodies for expected-value computation.
    await ensurePinyin();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    latestPositions = [];
    slot.contents = null;
    seedZhBook();
    usePreferencesStore.setState({
      showPinyin: true,
      forceTraditionalChinese: false,
      pinyinSize: 100,
      currentTheme: 'light',
      fontSize: 100,
      lineHeight: 1.5,
      fontProfiles: {},
      shouldForceFont: false,
      readerViewMode: 'paginated',
    });
  });

  it('BMP text: one position per Han char, pinyin aligned, geometry = rect + iframe offsets', async () => {
    const text = '你好世界';
    slot.contents = makeFakeContents(text);

    render(<TestHost />);

    await waitFor(() => expect(latestPositions.length).toBe(4));
    const expectedPinyin = getPinyin(text);

    latestPositions.forEach((pos, i) => {
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

  it('CH-1 pin: astral Han (U+20000) gets NO pinyin and shifts every following char by one', async () => {
    const text = '\u{20000}中文好'; // code units: [D840, DC00, 中, 文, 好]
    slot.contents = makeFakeContents(text);

    render(<TestHost />);

    await waitFor(() => expect(latestPositions.length).toBe(2));
    const p = getPinyin(text); // per CODE POINT: [𠀀, zhōng, wén, hǎo]

    // CURRENT (buggy) behavior, pinned: 𠀀 itself is invisible to the
    // [一-鿿] per-code-unit test; 中/文 read a +1-shifted index;
    // 好 indexes past the end and is dropped entirely.
    expect(latestPositions[0].char).toBe('中');
    expect(latestPositions[0].pinyin).toBe(p[2]); // 文's pinyin — WRONG, pinned
    expect(latestPositions[1].char).toBe('文');
    expect(latestPositions[1].pinyin).toBe(p[3]); // 好's pinyin — WRONG, pinned
    expect(latestPositions.find((pos) => pos.char === '好')).toBeUndefined();
    expect(latestPositions.find((pos) => pos.char === '\u{20000}')).toBeUndefined();
  });

  it('CH-1 pin: an emoji starves the Han chars after it of pinyin', async () => {
    const text = '考\u{1F600}试'; // code units: [考, D83D, DE00, 试]
    slot.contents = makeFakeContents(text);

    render(<TestHost />);

    await waitFor(() => expect(latestPositions.length).toBe(1));
    const p = getPinyin(text);
    expect(latestPositions[0].char).toBe('考');
    expect(latestPositions[0].pinyin).toBe(p[0]); // before the emoji: still aligned
    expect(latestPositions.find((pos) => pos.char === '试')).toBeUndefined(); // pinned loss
  });

  // The CH-1 fix (PR-1 of the prep doc) makes this pass — flip to `it` there
  // and rewrite the two pins above in the same commit.
  it.fails('CH-1 target: pinyin aligns per code point through astral chars (PR-1 flips this)', async () => {
    const text = '\u{20000}中文好';
    slot.contents = makeFakeContents(text);

    render(<TestHost />);

    await waitFor(() => expect(latestPositions.length).toBeGreaterThanOrEqual(3));
    const p = getPinyin(text);
    const byChar = new Map(latestPositions.map((pos) => [pos.char, pos.pinyin]));
    expect(byChar.get('中')).toBe(p[1]);
    expect(byChar.get('文')).toBe(p[2]);
    expect(byChar.get('好')).toBe(p[3]);
  });

  it('traditional toggle round-trips the text node via the _originalText cache', async () => {
    const text = '这是一本测试用的中文书';
    const contents = makeFakeContents(text);
    slot.contents = contents;

    render(<TestHost />);
    await waitFor(() => expect(latestPositions.length).toBeGreaterThan(0));
    expect(contents.textNode.nodeValue).toBe(text);

    // Toggle ON: in-place nodeValue mutation to traditional.
    act(() => {
      usePreferencesStore.setState({ forceTraditionalChinese: true });
    });
    await waitFor(() =>
      expect(contents.textNode.nodeValue).toBe('這是一本測試用的中文書'),
    );

    // Toggle OFF: restored byte-for-byte from _originalText.
    act(() => {
      usePreferencesStore.setState({ forceTraditionalChinese: false });
    });
    await waitFor(() => expect(contents.textNode.nodeValue).toBe(text));
  });

  it('non-zh books bypass the pipeline entirely (empty positions)', async () => {
    useBookStore.setState({
      books: {
        [BOOK_ID]: { ...useBookStore.getState().books[BOOK_ID], language: 'en' },
      },
    });
    const contents = makeFakeContents('中文内容');
    slot.contents = contents;

    render(<TestHost />);

    // The pipeline reports an explicit empty array for non-zh books.
    await waitFor(() => expect(latestPositions).toEqual([]));
    expect(contents.textNode.nodeValue).toBe('中文内容');
  });
});

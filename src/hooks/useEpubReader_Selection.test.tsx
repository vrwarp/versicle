/**
 * Selection single-fire (Phase 6 PR-4 / D3, prep/phase6-reader-engine.md
 * §2b "Selection semantics").
 *
 * The legacy hook reported one selection gesture through TWO parallel
 * pipelines — epub.js's `selected` rendition event AND the per-document
 * mouseup pipeline (which exists for WebKit reliability) — so `onSelection`
 * could fire twice per gesture (reader.md D3). The selectionBridge module
 * is now the SINGLE source: this suite dispatches a gesture through BOTH
 * legacy paths and pins exactly one `onSelection` call, plus zero calls for
 * an engine-only `selected` event.
 */
import React, { useRef } from 'react';
import { render, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useEpubReader, type EpubReaderOptions } from './useEpubReader';
import { useBookStore } from '@store/useBookStore';
import { usePreferencesStore } from '@store/usePreferencesStore';

vi.mock('@data/repos/bookContent', () => ({
  bookContent: {
    getBookFile: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    getLocations: vi.fn().mockResolvedValue(null),
    saveLocations: vi.fn().mockResolvedValue(undefined),
  },
}));

// Shared slots the hoisted epubjs mock fills at render time.
const slot = vi.hoisted(() => ({
  handlers: {} as Record<string, (...args: unknown[]) => void>,
  contentHooks: [] as Array<(contents: unknown) => unknown>,
  contents: null as unknown,
}));

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
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          slot.handlers[event] = handler;
        }),
        off: vi.fn(),
        hooks: {
          content: {
            register: vi.fn((fn: (contents: unknown) => unknown) => {
              slot.contentHooks.push(fn);
            }),
          },
        },
        spread: vi.fn(),
        flow: vi.fn(),
        resize: vi.fn(),
        // Truthy range so the engine's 'selected' wiring does not drop the
        // event before it reaches the hook's subscription.
        getRange: vi.fn(() => ({ collapsed: true })),
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
      length: vi.fn(() => 0),
    },
    spine: { get: vi.fn(), hooks: { serialize: { register: vi.fn() } } },
  })),
}));

const GESTURE_CFI = 'epubcfi(/6/2!/4/2,/1:0,/1:5)';

/** A Contents-shaped fixture whose document/window drive both pipelines. */
function makeFakeContents() {
  const doc = document.implementation.createHTMLDocument('fixture');
  const p = doc.createElement('p');
  p.textContent = 'selected text';
  doc.body.appendChild(p);

  const range = doc.createRange();
  range.selectNodeContents(p);

  const selection = {
    isCollapsed: false,
    rangeCount: 1,
    getRangeAt: () => range,
    removeAllRanges: vi.fn(),
  };

  return {
    document: doc,
    window: {
      frameElement: { offsetTop: 0, offsetLeft: 0 },
      getSelection: () => selection,
    },
    cfiFromRange: () => GESTURE_CFI,
  };
}

const onSelection = vi.fn();

const TestHost: React.FC = () => {
  const viewerRef = useRef<HTMLDivElement>(null);
  const options: EpubReaderOptions = {
    viewMode: 'paginated',
    currentTheme: 'light',
    customTheme: { bg: '#fff', fg: '#000' },
    fontFamily: 'serif',
    fontSize: 100,
    lineHeight: 1.5,
    shouldForceFont: false,
    onSelection,
  };
  useEpubReader('selection-book', viewerRef as unknown as React.RefObject<HTMLElement>, options);
  return <div ref={viewerRef} data-testid="viewer" />;
};

describe('regression: selection single-fire per gesture (D3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    slot.handlers = {};
    slot.contentHooks = [];
    slot.contents = null;
    useBookStore.setState({ books: {} });
    usePreferencesStore.setState({
      showPinyin: false,
      forceTraditionalChinese: false,
    });
  });

  const bootAndAttach = async () => {
    slot.contents = makeFakeContents();
    render(<TestHost />);

    // Three content hooks: the engine's own (titled iframe/contentRendered)
    // plus the lifecycle hook's two (extras → selection). The chinese pass
    // left the lifecycle with PR-10 — it rides the engine's contentRendered
    // seam, registered from app/ (domains/chinese).
    await waitFor(() => expect(slot.contentHooks.length).toBe(3));

    // Simulate epub.js firing the content pipeline for the rendered section.
    for (const hook of slot.contentHooks) {
      await hook(slot.contents);
    }
  };

  it('one gesture through BOTH legacy pipelines reports exactly ONE selection', async () => {
    await bootAndAttach();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contents = slot.contents as any;

    // Pipeline 1: the mouseup gesture (selectionBridge).
    contents.document.dispatchEvent(new window.Event('mouseup'));

    // Pipeline 2: epub.js 'selected' for the same gesture (the engine
    // forwards it; the hook must NOT consume it anymore).
    expect(slot.handlers['selected']).toBeTypeOf('function');
    slot.handlers['selected'](GESTURE_CFI, contents);

    // The bridge resolves after its 10ms race-guard delay.
    await waitFor(() => expect(onSelection).toHaveBeenCalledTimes(1));
    expect(onSelection).toHaveBeenCalledWith(GESTURE_CFI, expect.anything(), contents);

    // Settle: no late second fire from the dropped pipeline.
    await new Promise((r) => setTimeout(r, 30));
    expect(onSelection).toHaveBeenCalledTimes(1);
  });

  it('a touchend gesture (Android long-press) reports one selection', async () => {
    await bootAndAttach();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contents = slot.contents as any;

    // Android (Capacitor WebView) long-press selection is finalized on
    // touchend, not mouseup — the bridge must pick the gesture up there too.
    contents.document.dispatchEvent(new window.Event('touchend'));

    await waitFor(() => expect(onSelection).toHaveBeenCalledTimes(1));
    expect(onSelection).toHaveBeenCalledWith(GESTURE_CFI, expect.anything(), contents);
  });

  it('a selectionchange gesture (Android, mouseup/touchend swallowed) reports one selection', async () => {
    await bootAndAttach();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contents = slot.contents as any;

    // On Android the native long-press UI swallows mouseup/touchend, so the
    // bridge must resolve the selection off the debounced selectionchange.
    contents.document.dispatchEvent(new window.Event('selectionchange'));

    await waitFor(() => expect(onSelection).toHaveBeenCalledTimes(1));
    expect(onSelection).toHaveBeenCalledWith(GESTURE_CFI, expect.anything(), contents);
  });

  it('a single gesture surfacing on BOTH touchend and mouseup reports once', async () => {
    await bootAndAttach();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contents = slot.contents as any;

    // Some Android WebViews emit a synthesized mouseup after touchend for the
    // same long-press — the per-gesture CFI de-dupe must collapse it to one.
    contents.document.dispatchEvent(new window.Event('touchend'));
    contents.document.dispatchEvent(new window.Event('mouseup'));

    await waitFor(() => expect(onSelection).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(onSelection).toHaveBeenCalledTimes(1);
  });

  it('an engine-only selected event (no mouseup) reports nothing', async () => {
    await bootAndAttach();

    slot.handlers['selected'](GESTURE_CFI, slot.contents);

    await new Promise((r) => setTimeout(r, 30));
    expect(onSelection).not.toHaveBeenCalled();
  });

  it('a mouseup with a collapsed selection reports nothing', async () => {
    await bootAndAttach();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contents = slot.contents as any;
    contents.window.getSelection = () => ({ isCollapsed: true, rangeCount: 0 });

    contents.document.dispatchEvent(new window.Event('mouseup'));

    await new Promise((r) => setTimeout(r, 30));
    expect(onSelection).not.toHaveBeenCalled();
  });
});

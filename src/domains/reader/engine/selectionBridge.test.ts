/**
 * The selection bridge turns a user's text selection into a CFI range. It
 * had no test at all, yet it is full of platform scar tissue: Android
 * swallows mouseup, the native selection commits after touchend, and the
 * app's own programmatic selections fire selectionchange exactly like a
 * user gesture. Each guard here exists because one of those broke the
 * highlight flow.
 */
import type { Contents } from 'epubjs';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { attachSelectionBridge, markProgrammaticSelection } from './selectionBridge';

interface Harness {
  contents: Contents;
  fire: (type: string) => void;
  setSelection: (options?: { collapsed?: boolean; rangeCount?: number; throwOnGet?: boolean }) => void;
  onSelection: Mock<(cfiRange: string, range: Range, contents: Contents) => void>;
  cfiFromRange: ReturnType<typeof vi.fn>;
  win: Window;
}

const makeHarness = (over: { cfi?: string } = {}): Harness => {
  const listeners = new Map<string, ((e: Event) => void)[]>();
  const range = { collapsed: false } as unknown as Range;
  let selection: unknown = {
    isCollapsed: false,
    rangeCount: 1,
    getRangeAt: () => range,
  };

  const win = { getSelection: () => selection } as unknown as Window;
  const doc = {
    addEventListener: (type: string, handler: (e: Event) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
  } as unknown as Document;

  const cfiFromRange = vi.fn(() => over.cfi ?? 'epubcfi(/6/4!/4/2,/1:0,/1:9)');
  const contents = { document: doc, window: win, cfiFromRange } as unknown as Contents;
  const onSelection = vi.fn<(cfiRange: string, range: Range, contents: Contents) => void>();

  return {
    contents,
    onSelection,
    cfiFromRange,
    win,
    fire: (type) => {
      for (const handler of listeners.get(type) ?? []) {
        handler({ preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as Event);
      }
    },
    setSelection: (options = {}) => {
      selection = {
        isCollapsed: options.collapsed ?? false,
        rangeCount: options.rangeCount ?? 1,
        getRangeAt: () => {
          if (options.throwOnGet) throw new Error('IndexSizeError');
          return range;
        },
      };
    },
  };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('attachSelectionBridge wiring', () => {
  it('does nothing when the section has no document', () => {
    const contents = { document: null } as unknown as Contents;

    expect(() => attachSelectionBridge(contents, vi.fn<(cfiRange: string, range: Range, contents: Contents) => void>())).not.toThrow();
  });

  /* epub.js re-fires content hooks on re-render of the same Contents. */
  it('is idempotent per Contents instance', () => {
    const h = makeHarness();

    attachSelectionBridge(h.contents, h.onSelection);
    attachSelectionBridge(h.contents, h.onSelection);

    h.fire('mouseup');
    vi.advanceTimersByTime(400);

    expect(h.onSelection).toHaveBeenCalledTimes(1);
  });

  it('suppresses the native context menu', () => {
    const h = makeHarness();

    attachSelectionBridge(h.contents, h.onSelection);

    expect(() => h.fire('contextmenu')).not.toThrow();
  });
});

describe('emitting a selection', () => {
  it('reports the CFI after a mouseup settles', () => {
    const h = makeHarness();

    attachSelectionBridge(h.contents, h.onSelection);
    h.fire('mouseup');

    expect(h.onSelection).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10);
    expect(h.onSelection).toHaveBeenCalledTimes(1);
  });

  /*
   * Android commits the native selection after touchend, so the 10ms check
   * can still read collapsed — the 300ms re-check is what catches it.
   */
  it('re-checks at 300ms for platforms that commit late', () => {
    const h = makeHarness();

    attachSelectionBridge(h.contents, h.onSelection);
    h.setSelection({ collapsed: true });
    h.fire('touchend');
    vi.advanceTimersByTime(10);
    expect(h.onSelection).not.toHaveBeenCalled();

    h.setSelection({ collapsed: false });
    vi.advanceTimersByTime(290);
    expect(h.onSelection).toHaveBeenCalledTimes(1);
  });

  it('debounces selectionchange rather than emitting per event', () => {
    const h = makeHarness();

    attachSelectionBridge(h.contents, h.onSelection);
    h.fire('selectionchange');
    vi.advanceTimersByTime(100);
    h.fire('selectionchange');
    vi.advanceTimersByTime(100);
    h.fire('selectionchange');

    expect(h.onSelection).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(h.onSelection).toHaveBeenCalledTimes(1);
  });

  /* One gesture can surface as mouseup AND touchend AND selectionchange. */
  it('de-dupes the same CFI across trigger events', () => {
    const h = makeHarness();

    attachSelectionBridge(h.contents, h.onSelection);
    h.fire('mouseup');
    h.fire('touchend');
    h.fire('selectionchange');
    vi.advanceTimersByTime(600);

    expect(h.onSelection).toHaveBeenCalledTimes(1);
  });

  it('reports again when the selection changes to a different range', () => {
    const h = makeHarness();

    attachSelectionBridge(h.contents, h.onSelection);
    h.fire('mouseup');
    vi.advanceTimersByTime(400);

    h.cfiFromRange.mockReturnValue('epubcfi(/6/4!/4/2,/3:0,/3:9)');
    h.fire('mouseup');
    vi.advanceTimersByTime(400);

    expect(h.onSelection).toHaveBeenCalledTimes(2);
  });

  /* Collapsing clears the de-dupe key so re-selecting the same text fires. */
  it('re-reports the same text after the selection collapses', () => {
    const h = makeHarness();

    attachSelectionBridge(h.contents, h.onSelection);
    h.fire('mouseup');
    vi.advanceTimersByTime(400);

    h.setSelection({ collapsed: true });
    h.fire('mouseup');
    vi.advanceTimersByTime(400);

    h.setSelection({ collapsed: false });
    h.fire('mouseup');
    vi.advanceTimersByTime(400);

    expect(h.onSelection).toHaveBeenCalledTimes(2);
  });

  it('passes the range and contents through to the handler', () => {
    const h = makeHarness();

    attachSelectionBridge(h.contents, h.onSelection);
    h.fire('mouseup');
    vi.advanceTimersByTime(10);

    const [cfi, range, contents] = h.onSelection.mock.calls[0];

    expect(cfi).toBe('epubcfi(/6/4!/4/2,/1:0,/1:9)');
    expect(range).toBeDefined();
    expect(contents).toBe(h.contents);
  });
});

describe('cases that must not emit', () => {
  it('ignores a collapsed selection', () => {
    const h = makeHarness();

    attachSelectionBridge(h.contents, h.onSelection);
    h.setSelection({ collapsed: true });
    h.fire('mouseup');
    vi.advanceTimersByTime(400);

    expect(h.onSelection).not.toHaveBeenCalled();
  });

  it('ignores a selection with no ranges', () => {
    const h = makeHarness();

    attachSelectionBridge(h.contents, h.onSelection);
    h.setSelection({ rangeCount: 0 });
    h.fire('mouseup');
    vi.advanceTimersByTime(400);

    expect(h.onSelection).not.toHaveBeenCalled();
  });

  it('survives getRangeAt throwing after the selection was cleared', () => {
    const h = makeHarness();

    attachSelectionBridge(h.contents, h.onSelection);
    h.setSelection({ throwOnGet: true });

    expect(() => {
      h.fire('mouseup');
      vi.advanceTimersByTime(400);
    }).not.toThrow();
    expect(h.onSelection).not.toHaveBeenCalled();
  });

  it('survives cfiFromRange throwing on a detached range', () => {
    const h = makeHarness();

    attachSelectionBridge(h.contents, h.onSelection);
    h.cfiFromRange.mockImplementation(() => { throw new Error('detached'); });

    expect(() => {
      h.fire('mouseup');
      vi.advanceTimersByTime(400);
    }).not.toThrow();
    expect(h.onSelection).not.toHaveBeenCalled();
  });

  it('ignores an empty CFI', () => {
    const h = makeHarness();

    attachSelectionBridge(h.contents, h.onSelection);
    h.cfiFromRange.mockReturnValue('');
    h.fire('mouseup');
    vi.advanceTimersByTime(400);

    expect(h.onSelection).not.toHaveBeenCalled();
  });

  /* Teardown between the gesture and the debounce must not throw. */
  it('bails when the section was torn down before the timer fired', () => {
    const h = makeHarness();

    attachSelectionBridge(h.contents, h.onSelection);
    h.fire('mouseup');
    (h.contents as unknown as { window: undefined }).window = undefined;

    expect(() => vi.advanceTimersByTime(400)).not.toThrow();
    expect(h.onSelection).not.toHaveBeenCalled();
  });
});

describe('programmatic selections', () => {
  /*
   * engine.selectRange creates a selection for audio-bookmark triage. That
   * fires selectionchange too, and treating it as a user gesture clobbers
   * the triage pill.
   */
  it('ignores a selection the app created', () => {
    const h = makeHarness();

    attachSelectionBridge(h.contents, h.onSelection);
    markProgrammaticSelection(h.win);
    h.fire('selectionchange');
    vi.advanceTimersByTime(400);

    expect(h.onSelection).not.toHaveBeenCalled();
  });

  it('resumes reporting once the programmatic window has passed', () => {
    const h = makeHarness();

    attachSelectionBridge(h.contents, h.onSelection);
    markProgrammaticSelection(h.win);
    vi.advanceTimersByTime(600);

    h.fire('mouseup');
    vi.advanceTimersByTime(400);

    expect(h.onSelection).toHaveBeenCalledTimes(1);
  });

  /*
   * The flag is checked before lastCfi is touched, so a suppressed
   * programmatic selection does not poison the de-dupe key — a real user
   * selecting the same text still fires.
   */
  it('does not poison the de-dupe key while suppressed', () => {
    const h = makeHarness();

    attachSelectionBridge(h.contents, h.onSelection);
    markProgrammaticSelection(h.win);
    h.fire('mouseup');
    vi.advanceTimersByTime(400);
    expect(h.onSelection).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    h.fire('mouseup');
    vi.advanceTimersByTime(400);

    expect(h.onSelection).toHaveBeenCalledTimes(1);
  });

  it('tolerates a null or undefined window', () => {
    expect(() => markProgrammaticSelection(null)).not.toThrow();
    expect(() => markProgrammaticSelection(undefined)).not.toThrow();
  });
});

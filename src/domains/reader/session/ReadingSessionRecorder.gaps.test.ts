/**
 * `ReadingSessionRecorder` — the guards and error arms.
 *
 * The owning suite pins the write shapes and the §6 serialization fix.
 * This one walks the decisions around them: disposal, the no-op CFI guard,
 * the scroll-vs-page dwell rule, the 'Chapter' placeholder filter at both
 * of its call sites, the panic save's 2s floor, and every catch — a
 * recording that throws must not stall the FIFO or lose the current
 * location.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateCfiRange } from '@kernel/cfi';
import type { EngineLocation } from '@domains/reader/engine/ReaderEngine';
import {
  ReadingSessionRecorder,
  type ReadingSessionRecorderDeps,
  type SessionResolver,
} from './ReadingSessionRecorder';

const loc = (n: number): EngineLocation => ({
  startCfi: `epubcfi(/6/4!/4/${n * 2}/1:0)`,
  endCfi: `epubcfi(/6/4!/4/${n * 2}/1:9)`,
  sectionHref: 'ch1.xhtml',
  percentage: n / 10,
  atStart: false,
  atEnd: false,
});

const nullResolver: SessionResolver = {
  getRange: async () => null,
  getLanguage: () => 'en',
};

const flush = () => new Promise((r) => setTimeout(r, 0));

let errorLogs: unknown[][];

function makeRecorder(overrides: Partial<ReadingSessionRecorderDeps> = {}) {
  const store = {
    getCurrentCfi: vi.fn<() => string | undefined>(() => undefined),
    updateReadingSession: vi.fn(),
    addCompletedRange: vi.fn(),
  };
  const onHistoryRecorded = vi.fn();
  let nowValue = 100_000;
  const advance = (ms: number) => {
    nowValue += ms;
  };
  const context = {
    title: 'Chapter One' as string | null,
    viewMode: 'paginated' as 'paginated' | 'scrolled',
  };
  const recorder = new ReadingSessionRecorder({
    bookId: 'book-1',
    getResolver: () => nullResolver,
    store,
    getContext: () => context,
    onHistoryRecorded,
    now: () => nowValue,
    ...overrides,
  });
  return { recorder, store, onHistoryRecorded, advance, context };
}

beforeEach(() => {
  errorLogs = [];
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => errorLogs.push(a));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ReadingSessionRecorder — disposal', () => {
  it('a disposed recorder ignores prime and relocations', async () => {
    const { recorder, store } = makeRecorder();

    recorder.dispose();
    recorder.prime(loc(1), 1000);
    expect(recorder.onRelocated({ location: loc(2), at: 2000, percentage: 0.2, viewMode: 'paginated', title: 'T' })).toBe(
      false
    );
    await flush();

    expect(store.updateReadingSession).not.toHaveBeenCalled();
  });

  it('dispose drops everything still queued', async () => {
    const { recorder, store, advance } = makeRecorder();
    recorder.prime(loc(1), 100_000);
    advance(5000);
    recorder.onRelocated({ location: loc(2), at: 105_000, percentage: 0.2, viewMode: 'paginated', title: 'T' });

    recorder.dispose();
    await flush();

    expect(store.updateReadingSession).not.toHaveBeenCalled();
  });

  it('flushSync after dispose writes nothing', () => {
    const { recorder, store, advance } = makeRecorder();
    recorder.prime(loc(1), 100_000);
    advance(5000);

    recorder.dispose();
    recorder.flushSync();

    expect(store.updateReadingSession).not.toHaveBeenCalled();
  });
});

describe('ReadingSessionRecorder — prime', () => {
  it('is idempotent: the FIRST location wins', async () => {
    const { recorder, store, advance } = makeRecorder();

    recorder.prime(loc(1), 100_000);
    recorder.prime(loc(5), 100_000); // ignored
    advance(5000);
    recorder.onRelocated({ location: loc(2), at: 105_000, percentage: 0.2, viewMode: 'paginated', title: 'T' });
    await flush();

    const updates = store.updateReadingSession.mock.calls[0][3];
    expect(updates[0].range).toBe(generateCfiRange(loc(1).startCfi, loc(1).endCfi));
  });
});

describe('ReadingSessionRecorder — the no-op guard', () => {
  it('skips a relocation to the ALREADY-SAVED cfi', async () => {
    const { recorder, store } = makeRecorder();
    store.getCurrentCfi.mockReturnValue(loc(2).startCfi);

    const recorded = recorder.onRelocated({
      location: loc(2),
      at: 1000,
      percentage: 0.2,
      viewMode: 'paginated',
      title: 'T',
    });
    await flush();

    expect(recorded).toBe(false);
    expect(store.updateReadingSession).not.toHaveBeenCalled();
  });

  it('records when the store has no saved cfi at all', async () => {
    const { recorder, store } = makeRecorder();
    store.getCurrentCfi.mockReturnValue(undefined);

    expect(
      recorder.onRelocated({ location: loc(2), at: 1000, percentage: 0.2, viewMode: 'paginated', title: 'T' })
    ).toBe(true);
    await flush();

    expect(store.updateReadingSession).toHaveBeenCalledTimes(1);
  });

  it('still PRIMES the tracker on a skipped event', async () => {
    const { recorder, store, advance } = makeRecorder();
    store.getCurrentCfi.mockReturnValue(loc(1).startCfi);

    recorder.onRelocated({ location: loc(1), at: 100_000, percentage: 0.1, viewMode: 'paginated', title: 'T' });
    store.getCurrentCfi.mockReturnValue(undefined);
    advance(5000);
    recorder.onRelocated({ location: loc(2), at: 105_000, percentage: 0.2, viewMode: 'paginated', title: 'T' });
    await flush();

    const updates = store.updateReadingSession.mock.calls[0][3];
    expect(updates[0].range).toBe(generateCfiRange(loc(1).startCfi, loc(1).endCfi));
  });
});

describe('ReadingSessionRecorder — does the previous segment qualify?', () => {
  const relocate = (
    recorder: ReadingSessionRecorder,
    n: number,
    viewMode: 'paginated' | 'scrolled',
    title = 'T'
  ) =>
    recorder.onRelocated({
      location: loc(n),
      at: 0,
      percentage: n / 10,
      viewMode,
      title,
    });

  it('a PAGINATED move always qualifies, however brief', async () => {
    const { recorder, store, advance } = makeRecorder();
    recorder.prime(loc(1), 100_000);
    advance(10); // far under the scroll dwell floor

    relocate(recorder, 2, 'paginated');
    await flush();

    expect(store.updateReadingSession.mock.calls[0][3]).toHaveLength(2);
  });

  it('a SCROLLED move needs more than 2s of dwell', async () => {
    const brief = makeRecorder();
    brief.recorder.prime(loc(1), 100_000);
    brief.advance(2000); // exactly the floor — not "more than"
    relocate(brief.recorder, 2, 'scrolled');
    await flush();
    expect(brief.store.updateReadingSession.mock.calls[0][3]).toHaveLength(1);

    const dwelt = makeRecorder();
    dwelt.recorder.prime(loc(1), 100_000);
    dwelt.advance(2001);
    relocate(dwelt.recorder, 2, 'scrolled');
    await flush();
    expect(dwelt.store.updateReadingSession.mock.calls[0][3]).toHaveLength(2);
  });

  it('does not record a previous segment on the very first relocation', async () => {
    const { recorder, store } = makeRecorder();

    relocate(recorder, 1, 'paginated');
    await flush();

    expect(store.updateReadingSession.mock.calls[0][3]).toHaveLength(1);
  });

  it('does not record a previous segment that did not actually move', async () => {
    const { recorder, store, advance } = makeRecorder();
    recorder.prime(loc(2), 100_000);
    advance(5000);

    // previous.start === the incoming start: no segment was traversed.
    relocate(recorder, 2, 'paginated');
    await flush();

    expect(store.updateReadingSession.mock.calls[0][3]).toHaveLength(1);
  });

  it('records nothing extra when there is no resolver', async () => {
    const { recorder, store, advance } = makeRecorder({ getResolver: () => null });
    recorder.prime(loc(1), 100_000);
    advance(5000);

    relocate(recorder, 2, 'paginated');
    await flush();

    expect(store.updateReadingSession.mock.calls[0][3]).toHaveLength(1);
  });

  it("stamps the entry type from the view mode", async () => {
    const { recorder, store, advance } = makeRecorder();
    recorder.prime(loc(1), 100_000);
    advance(5000);

    relocate(recorder, 2, 'scrolled');
    await flush();

    const updates = store.updateReadingSession.mock.calls[0][3];
    expect(updates.map((u: { type: string }) => u.type)).toEqual(['scroll', 'scroll']);
  });
});

describe("ReadingSessionRecorder — the 'Chapter' placeholder filter", () => {
  it('drops the PREVIOUS entry when its captured title is the placeholder', async () => {
    const { recorder, store, advance, context } = makeRecorder();
    recorder.prime(loc(1), 100_000);
    context.title = 'Chapter';
    advance(5000);

    recorder.onRelocated({ location: loc(2), at: 0, percentage: 0.2, viewMode: 'paginated', title: 'Real' });
    await flush();

    const updates = store.updateReadingSession.mock.calls[0][3];
    expect(updates).toHaveLength(1);
    expect(updates[0].label).toBe('Real');
  });

  it('keeps a title that merely CONTAINS the placeholder word', async () => {
    const { recorder, store, advance, context } = makeRecorder();
    recorder.prime(loc(1), 100_000);
    context.title = 'Chapter 3';
    advance(5000);

    recorder.onRelocated({ location: loc(2), at: 0, percentage: 0.2, viewMode: 'paginated', title: 'Real' });
    await flush();

    expect(store.updateReadingSession.mock.calls[0][3]).toHaveLength(2);
  });

  it('does NOT announce a history entry when the placeholder dropped it', async () => {
    const { recorder, onHistoryRecorded, advance, context } = makeRecorder();
    recorder.prime(loc(1), 100_000);
    context.title = 'Chapter';
    advance(5000);

    recorder.onRelocated({ location: loc(2), at: 0, percentage: 0.2, viewMode: 'paginated', title: 'Real' });
    await flush();

    expect(onHistoryRecorded).not.toHaveBeenCalled();
  });

  it('carries a NULL captured title through as an unlabeled entry', async () => {
    const { recorder, store, advance, context } = makeRecorder();
    recorder.prime(loc(1), 100_000);
    context.title = null;
    advance(5000);

    recorder.onRelocated({ location: loc(2), at: 0, percentage: 0.2, viewMode: 'paginated', title: 'Real' });
    await flush();

    const updates = store.updateReadingSession.mock.calls[0][3];
    expect(updates).toHaveLength(2);
    expect(updates[0].label).toBeUndefined();
  });
});

describe('ReadingSessionRecorder — failure arms', () => {
  it('a snap failure still saves the CURRENT location', async () => {
    const resolver: SessionResolver = {
      getRange: async () => null,
      getLanguage: () => {
        throw new Error('language read failed');
      },
    };
    const { recorder, store, advance } = makeRecorder({ getResolver: () => resolver });
    recorder.prime(loc(1), 100_000);
    advance(5000);

    recorder.onRelocated({ location: loc(2), at: 0, percentage: 0.2, viewMode: 'paginated', title: 'T' });
    await flush();

    expect(store.updateReadingSession).toHaveBeenCalledTimes(1);
    expect(store.updateReadingSession.mock.calls[0][3]).toHaveLength(1);
    expect(errorLogs.some((a) => a.some((x) => String(x).includes('History processing failed')))).toBe(
      true
    );
  });

  it('a store write that throws is logged and does not stall the FIFO', async () => {
    const { recorder, store, advance } = makeRecorder();
    store.updateReadingSession.mockImplementationOnce(() => {
      throw new Error('store exploded');
    });
    recorder.prime(loc(1), 100_000);
    advance(5000);

    recorder.onRelocated({ location: loc(2), at: 0, percentage: 0.2, viewMode: 'paginated', title: 'T' });
    await flush();
    advance(5000);
    recorder.onRelocated({ location: loc(3), at: 0, percentage: 0.3, viewMode: 'paginated', title: 'T' });
    await flush();

    expect(errorLogs.some((a) => a.some((x) => String(x).includes('Failed to update reading session')))).toBe(
      true
    );
    expect(store.updateReadingSession).toHaveBeenCalledTimes(2);
  });
});

describe('ReadingSessionRecorder.flushSync — the panic save', () => {
  it('does nothing at all when nothing was ever primed', () => {
    const { recorder, store } = makeRecorder();

    recorder.flushSync();

    expect(store.updateReadingSession).not.toHaveBeenCalled();
    expect(store.addCompletedRange).not.toHaveBeenCalled();
  });

  it('needs MORE than 2s of dwell on the final segment', () => {
    const brief = makeRecorder();
    brief.recorder.prime(loc(1), 100_000);
    brief.advance(2000);
    brief.recorder.flushSync();
    expect(brief.store.addCompletedRange).not.toHaveBeenCalled();

    const dwelt = makeRecorder();
    dwelt.recorder.prime(loc(1), 100_000);
    dwelt.advance(2001);
    dwelt.recorder.flushSync();
    expect(dwelt.store.addCompletedRange).toHaveBeenCalledTimes(1);
  });

  it('writes the final range with the live title and view mode', () => {
    const { recorder, store, advance, context } = makeRecorder();
    context.viewMode = 'scrolled';
    context.title = 'Final Chapter';
    recorder.prime(loc(1), 100_000);
    advance(9000);

    recorder.flushSync();

    expect(store.addCompletedRange).toHaveBeenCalledWith(
      'book-1',
      generateCfiRange(loc(1).startCfi, loc(1).endCfi),
      'scroll',
      'Final Chapter'
    );
  });

  it('writes an UNLABELED final range when the title is blank', () => {
    const { recorder, store, advance, context } = makeRecorder();
    context.title = '';
    recorder.prime(loc(1), 100_000);
    advance(9000);

    recorder.flushSync();

    expect(store.addCompletedRange).toHaveBeenCalledWith(
      'book-1',
      expect.any(String),
      'page',
      undefined
    );
  });

  it("skips the final range entirely when the title is the 'Chapter' placeholder", () => {
    const { recorder, store, advance, context } = makeRecorder();
    context.title = 'Chapter';
    recorder.prime(loc(1), 100_000);
    advance(9000);

    recorder.flushSync();

    expect(store.addCompletedRange).not.toHaveBeenCalled();
  });

  it('logs — and survives — a panic save the store rejects', () => {
    const { recorder, store, advance } = makeRecorder();
    store.addCompletedRange.mockImplementation(() => {
      throw new Error('idb closed');
    });
    recorder.prime(loc(1), 100_000);
    advance(9000);

    expect(() => recorder.flushSync()).not.toThrow();

    expect(errorLogs.some((a) => a.some((x) => String(x).includes('History panic save failed')))).toBe(
      true
    );
  });

  it('drains the queue synchronously and the late async completion DROPS', async () => {
    const { recorder, store, advance } = makeRecorder();
    recorder.prime(loc(1), 100_000);
    advance(5000);
    recorder.onRelocated({ location: loc(2), at: 0, percentage: 0.2, viewMode: 'paginated', title: 'T' });

    recorder.flushSync();
    const afterFlush = store.updateReadingSession.mock.calls.length;
    await flush();

    expect(afterFlush).toBe(1);
    expect(store.updateReadingSession).toHaveBeenCalledTimes(1);
  });

  it('logs a drain entry that throws and still writes the final segment', () => {
    const { recorder, store, advance } = makeRecorder();
    store.updateReadingSession.mockImplementationOnce(() => {
      throw new Error('drain failed');
    });
    recorder.prime(loc(1), 100_000);
    advance(5000);
    recorder.onRelocated({ location: loc(2), at: 0, percentage: 0.2, viewMode: 'paginated', title: 'T' });
    advance(5000);

    recorder.flushSync();

    expect(errorLogs.some((a) => a.some((x) => String(x).includes('Session flush failed')))).toBe(
      true
    );
    expect(store.addCompletedRange).toHaveBeenCalledTimes(1);
  });

  it('is safe to call twice — the second drains nothing', () => {
    const { recorder, store, advance } = makeRecorder();
    recorder.prime(loc(1), 100_000);
    advance(5000);
    recorder.onRelocated({ location: loc(2), at: 0, percentage: 0.2, viewMode: 'paginated', title: 'T' });

    recorder.flushSync();
    const after = store.updateReadingSession.mock.calls.length;
    recorder.flushSync();

    expect(store.updateReadingSession).toHaveBeenCalledTimes(after);
  });
});

/**
 * ReadingSessionRecorder — the owning suite (Phase 6 §6 / PR-6,
 * prep/phase6-reader-engine.md).
 *
 * The first describes pin the EXTRACTED legacy behavior (write shapes,
 * guards, panic-save semantics — characterization tier). The serialization
 * describe pins the §6 fix: per-book FIFO so a delayed snap for relocation
 * N can never commit after N+1 (the legacy out-of-order `currentCfi` bug,
 * reader.md D6).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

/** Resolver whose getRange resolves null → snapping returns the raw CFI. */
const nullResolver: SessionResolver = {
  getRange: async () => null,
  getLanguage: () => 'en',
};

function makeRecorder(overrides: Partial<ReadingSessionRecorderDeps> = {}) {
  const store = {
    getCurrentCfi: vi.fn<() => string | undefined>(() => undefined),
    updateReadingSession: vi.fn(),
    addCompletedRange: vi.fn(),
  };
  const onHistoryRecorded = vi.fn();
  let nowValue = 100_000;
  const now = vi.fn(() => nowValue);
  const advance = (ms: number) => {
    nowValue += ms;
  };
  const context = { title: 'Chapter One' as string | null, viewMode: 'paginated' as 'paginated' | 'scrolled' };
  const recorder = new ReadingSessionRecorder({
    bookId: 'book-1',
    getResolver: () => nullResolver,
    store,
    getContext: () => context,
    onHistoryRecorded,
    now,
    ...overrides,
  });
  return { recorder, store, onHistoryRecorded, advance, context, now: () => nowValue };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('ReadingSessionRecorder (extracted legacy write behavior)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('first relocation writes only the current range, labeled with the event title', async () => {
    const { recorder, store, onHistoryRecorded } = makeRecorder();

    recorder.onRelocated({
      location: loc(1),
      percentage: 0.1,
      title: 'Chapter One',
      viewMode: 'paginated',
      at: 100_000,
    });
    await flush();

    expect(store.updateReadingSession).toHaveBeenCalledTimes(1);
    const [bookId, cfi, pct, updates] = store.updateReadingSession.mock.calls[0];
    expect(bookId).toBe('book-1');
    expect(cfi).toBe(loc(1).startCfi);
    expect(pct).toBe(0.1);
    expect(updates).toEqual([
      {
        range: generateCfiRange(loc(1).startCfi, loc(1).endCfi),
        type: 'page',
        label: 'Chapter One',
      },
    ]);
    // The current range never counts as a history append (legacy: the tick
    // fired only for the previous-range entry).
    expect(onHistoryRecorded).not.toHaveBeenCalled();
  });

  it('subsequent relocation appends the previous (snapped) range and ticks history', async () => {
    const { recorder, store, onHistoryRecorded, advance } = makeRecorder();

    recorder.onRelocated({ location: loc(1), percentage: 0.1, title: 'A', viewMode: 'paginated', at: 100_000 });
    advance(5_000);
    recorder.onRelocated({ location: loc(2), percentage: 0.2, title: 'B', viewMode: 'paginated', at: 105_000 });
    await flush();

    expect(store.updateReadingSession).toHaveBeenCalledTimes(2);
    const updates = store.updateReadingSession.mock.calls[1][3];
    expect(updates).toEqual([
      {
        // null-range resolver → snap returns the raw CFIs (legacy fallback)
        range: generateCfiRange(loc(1).startCfi, loc(1).endCfi),
        type: 'page',
        label: 'Chapter One',
      },
      {
        range: generateCfiRange(loc(2).startCfi, loc(2).endCfi),
        type: 'page',
        label: 'B',
      },
    ]);
    expect(onHistoryRecorded).toHaveBeenCalledTimes(1);
  });

  it("filters the 'Chapter' placeholder from the previous-range label (single-sourced)", async () => {
    const { recorder, store, onHistoryRecorded, advance, context } = makeRecorder();
    context.title = 'Chapter';

    recorder.onRelocated({ location: loc(1), percentage: 0.1, title: 'Chapter', viewMode: 'paginated', at: 100_000 });
    advance(5_000);
    recorder.onRelocated({ location: loc(2), percentage: 0.2, title: 'Chapter', viewMode: 'paginated', at: 105_000 });
    await flush();

    const updates = store.updateReadingSession.mock.calls[1][3];
    // Previous range dropped; current range keeps its (unfiltered) label —
    // legacy behavior, verbatim.
    expect(updates).toHaveLength(1);
    expect(updates[0].label).toBe('Chapter');
    expect(onHistoryRecorded).not.toHaveBeenCalled();
  });

  it('no-op guard: relocation to the saved CFI returns false and writes nothing', async () => {
    const { recorder, store } = makeRecorder();
    store.getCurrentCfi.mockReturnValue(loc(1).startCfi);

    const recorded = recorder.onRelocated({
      location: loc(1),
      percentage: 0.1,
      title: 'A',
      viewMode: 'paginated',
      at: 100_000,
    });
    await flush();

    expect(recorded).toBe(false);
    expect(store.updateReadingSession).not.toHaveBeenCalled();
  });

  it('scrolled mode: previous range saved only after >2s dwell', async () => {
    const { recorder, store, advance } = makeRecorder();

    recorder.onRelocated({ location: loc(1), percentage: 0.1, title: 'A', viewMode: 'scrolled', at: 100_000 });
    advance(500); // fast scroll
    recorder.onRelocated({ location: loc(2), percentage: 0.2, title: 'B', viewMode: 'scrolled', at: 100_500 });
    await flush();

    // Second write has ONLY the current range (dwell too short).
    expect(store.updateReadingSession.mock.calls[1][3]).toHaveLength(1);

    advance(3_000); // slow read
    recorder.onRelocated({ location: loc(3), percentage: 0.3, title: 'C', viewMode: 'scrolled', at: 103_500 });
    await flush();

    const updates = store.updateReadingSession.mock.calls[2][3];
    expect(updates).toHaveLength(2);
    expect(updates[0].type).toBe('scroll');
  });

  it('flushSync (panic save): raw unsnapped range via addCompletedRange after >2s', () => {
    const { recorder, store, advance } = makeRecorder();

    recorder.onRelocated({ location: loc(1), percentage: 0.1, title: 'A', viewMode: 'paginated', at: 100_000 });
    advance(5_000);
    recorder.flushSync();

    expect(store.addCompletedRange).toHaveBeenCalledWith(
      'book-1',
      generateCfiRange(loc(1).startCfi, loc(1).endCfi),
      'page',
      'Chapter One',
    );
  });

  it('flushSync skips short dwells and the Chapter placeholder', () => {
    const { recorder, store, advance, context } = makeRecorder();

    recorder.onRelocated({ location: loc(1), percentage: 0.1, title: 'A', viewMode: 'paginated', at: 100_000 });
    advance(1_000);
    recorder.flushSync();
    expect(store.addCompletedRange).not.toHaveBeenCalled();

    advance(5_000);
    context.title = 'Chapter';
    recorder.flushSync();
    expect(store.addCompletedRange).not.toHaveBeenCalled();
  });

  it('prime() initializes the tracker without recording (import-jump path)', async () => {
    const { recorder, store, advance } = makeRecorder();

    recorder.prime(loc(1), 100_000);
    await flush();
    expect(store.updateReadingSession).not.toHaveBeenCalled();

    advance(5_000);
    recorder.onRelocated({ location: loc(2), percentage: 0.2, title: 'B', viewMode: 'paginated', at: 105_000 });
    await flush();

    // The primed location became the previous range.
    const updates = store.updateReadingSession.mock.calls[0][3];
    expect(updates).toHaveLength(2);
    expect(updates[0].range).toBe(generateCfiRange(loc(1).startCfi, loc(1).endCfi));
  });

  it('dispose() stops recording', async () => {
    const { recorder, store } = makeRecorder();
    recorder.dispose();
    recorder.onRelocated({ location: loc(1), percentage: 0.1, title: 'A', viewMode: 'paginated', at: 100_000 });
    await flush();
    expect(store.updateReadingSession).not.toHaveBeenCalled();
  });
});

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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateCfiRange } from '@kernel/cfi';
import type { EngineLocation } from '@domains/reader/engine/ReaderEngine';
import {
  ReadingSessionRecorder,
  setActiveReadingSessionRecorder,
  flushActiveReadingSession,
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
    // These describes pin the per-commit WRITE SHAPES, so they run with the
    // CRDT coalescing window disabled; the window itself is pinned by the
    // 'regression: coalesced CRDT commits' block in the owning suite.
    commitWindowMs: 0,
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

describe('regression: serialized per-book writes (D6 fix, §6)', () => {
  beforeEach(() => vi.clearAllMocks());

  /** Resolver whose getRange resolution order is test-controlled. */
  const makeDelayedResolver = () => {
    const gates = new Map<string, (range: Range | null) => void>();
    const resolver: SessionResolver = {
      getRange: (cfi: string) =>
        new Promise<Range | null>((resolve) => {
          gates.set(cfi, resolve);
        }),
      getLanguage: () => 'en',
    };
    const release = (cfi: string) => {
      gates.get(cfi)?.(null); // null → snap falls back to the raw CFI
      gates.delete(cfi);
    };
    return { resolver, release, gates };
  };

  it('a delayed snap for N never commits after N+1 (FIFO; final currentCfi is N+1)', async () => {
    const { resolver, release } = makeDelayedResolver();
    const { recorder, store, advance } = makeRecorder({ getResolver: () => resolver });

    recorder.onRelocated({ location: loc(1), percentage: 0.1, title: 'A', viewMode: 'paginated', at: 100_000 });
    await flush(); // first event: no previous range → committed without snapping
    expect(store.updateReadingSession).toHaveBeenCalledTimes(1);

    advance(5_000);
    // N: its previous-range snap will hang on the resolver gate.
    recorder.onRelocated({ location: loc(2), percentage: 0.2, title: 'B', viewMode: 'paginated', at: 105_000 });
    advance(5_000);
    // N+1 enqueued while N's snap is still pending.
    recorder.onRelocated({ location: loc(3), percentage: 0.3, title: 'C', viewMode: 'paginated', at: 110_000 });
    await flush();

    // FIFO: N+1 must NOT have committed ahead of N.
    expect(store.updateReadingSession).toHaveBeenCalledTimes(1);

    // Resolve N's snap (after N+1 was enqueued — the legacy out-of-order
    // scenario), then N+1's.
    release(loc(1).startCfi);
    release(loc(1).endCfi);
    await flush();
    release(loc(2).startCfi);
    release(loc(2).endCfi);
    await flush();
    await flush();

    expect(store.updateReadingSession).toHaveBeenCalledTimes(3);
    // Commit order is event order…
    expect(store.updateReadingSession.mock.calls[1][1]).toBe(loc(2).startCfi);
    expect(store.updateReadingSession.mock.calls[2][1]).toBe(loc(3).startCfi);
    // …so the FINAL currentCfi is N+1's.
    const last = store.updateReadingSession.mock.calls.at(-1)!;
    expect(last[1]).toBe(loc(3).startCfi);
    expect(last[2]).toBe(0.3);
  });

  it('flushSync drains queued + in-flight recordings unsnapped; the late async completion drops', async () => {
    const { resolver, release, gates } = makeDelayedResolver();
    const { recorder, store, advance } = makeRecorder({ getResolver: () => resolver });

    recorder.onRelocated({ location: loc(1), percentage: 0.1, title: 'A', viewMode: 'paginated', at: 100_000 });
    await flush();
    store.updateReadingSession.mockClear();

    advance(5_000);
    recorder.onRelocated({ location: loc(2), percentage: 0.2, title: 'B', viewMode: 'paginated', at: 105_000 });
    advance(5_000);
    recorder.onRelocated({ location: loc(3), percentage: 0.3, title: 'C', viewMode: 'paginated', at: 110_000 });
    await flush();
    expect(store.updateReadingSession).not.toHaveBeenCalled(); // both pending on the gate

    advance(5_000);
    recorder.flushSync();

    // Both recordings committed synchronously (raw, unsnapped ranges) in
    // event order, plus the legacy final panic segment.
    expect(store.updateReadingSession).toHaveBeenCalledTimes(2);
    expect(store.updateReadingSession.mock.calls[0][1]).toBe(loc(2).startCfi);
    expect(store.updateReadingSession.mock.calls[0][3][0].range).toBe(
      generateCfiRange(loc(1).startCfi, loc(1).endCfi),
    );
    expect(store.updateReadingSession.mock.calls[1][1]).toBe(loc(3).startCfi);
    expect(store.addCompletedRange).toHaveBeenCalledTimes(1);

    // The in-flight snap resolving late must NOT produce a duplicate write.
    for (const cfi of [...gates.keys()]) release(cfi);
    await flush();
    await flush();
    expect(store.updateReadingSession).toHaveBeenCalledTimes(2);
  });

  it('rapid flips: every write commits in event order (no interleaving)', async () => {
    const { recorder, store, advance } = makeRecorder();

    for (let n = 1; n <= 5; n++) {
      recorder.onRelocated({
        location: loc(n),
        percentage: n / 10,
        title: `T${n}`,
        viewMode: 'paginated',
        at: 100_000 + n * 3_000,
      });
      advance(3_000);
    }
    await flush();
    await flush();

    const cfis = store.updateReadingSession.mock.calls.map((c) => c[1]);
    expect(cfis).toEqual([1, 2, 3, 4, 5].map((n) => loc(n).startCfi));
  });
});

/**
 * perf/durability: the progress store is a CRDT, and Yjs is append-only, so
 * every relocation's own `updateReadingSession` left ~65 bytes of PERMANENT
 * Y.Doc growth (tombstones and delete-set ranges survive `encodeStateAsUpdate`)
 * — 22ms of cold-boot `Y.applyUpdate` at 500 turns against 283ms at 40k, and a
 * document the user carries and syncs forever. Commits are merged into a time
 * window and issued as ONE write; the durability contract is what these pin.
 */
describe('regression: coalesced CRDT commits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A recorder with a live 5s window (the production default). */
  const windowed = (overrides: Partial<ReadingSessionRecorderDeps> = {}) =>
    makeRecorder({ commitWindowMs: 5_000, ...overrides });

  const relocate = (
    recorder: ReadingSessionRecorder,
    n: number,
    at: number,
  ): boolean | undefined =>
    recorder.onRelocated({
      location: loc(n),
      percentage: n / 10,
      title: `T${n}`,
      viewMode: 'paginated',
      at,
    });

  it('merges a window of relocations into ONE store write, newest position last', async () => {
    const { recorder, store, advance } = windowed();

    for (let n = 1; n <= 3; n++) {
      relocate(recorder, n, 100_000 + n * 1_000);
      advance(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
    }

    // Still inside the window: nothing has reached the CRDT yet.
    expect(store.updateReadingSession).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);

    expect(store.updateReadingSession).toHaveBeenCalledTimes(1);
    const [bookId, cfi, pct, updates] = store.updateReadingSession.mock.calls[0];
    expect(bookId).toBe('book-1');
    // The LAST event owns the position…
    expect(cfi).toBe(loc(3).startCfi);
    expect(pct).toBe(0.3);
    // …and no range is lost: 3 current ranges + the 2 qualifying previous ones.
    expect(updates.map((u: { range: string }) => u.range)).toEqual([
      generateCfiRange(loc(1).startCfi, loc(1).endCfi),
      generateCfiRange(loc(1).startCfi, loc(1).endCfi),
      generateCfiRange(loc(2).startCfi, loc(2).endCfi),
      generateCfiRange(loc(2).startCfi, loc(2).endCfi),
      generateCfiRange(loc(3).startCfi, loc(3).endCfi),
    ]);
  });

  it('flushSync still drains the window immediately, before the panic segment', async () => {
    const { recorder, store, advance } = windowed();

    relocate(recorder, 1, 100_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.updateReadingSession).not.toHaveBeenCalled();

    advance(5_000);
    recorder.flushSync();

    expect(store.updateReadingSession).toHaveBeenCalledTimes(1);
    expect(store.updateReadingSession.mock.calls[0][1]).toBe(loc(1).startCfi);
    expect(store.addCompletedRange).toHaveBeenCalledTimes(1);
    // Ordering: the session write lands before the final completed range.
    expect(store.updateReadingSession.mock.invocationCallOrder[0]).toBeLessThan(
      store.addCompletedRange.mock.invocationCallOrder[0],
    );
  });

  it('flushPending drains the queue AND the window without a panic segment', async () => {
    const { recorder, store, advance } = windowed();

    relocate(recorder, 1, 100_000);
    advance(3_000);
    await vi.advanceTimersByTimeAsync(0);
    relocate(recorder, 2, 103_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.updateReadingSession).not.toHaveBeenCalled();

    // What the owner wires to visibilitychange → hidden / pagehide.
    recorder.flushPending();

    expect(store.updateReadingSession).toHaveBeenCalledTimes(1);
    expect(store.updateReadingSession.mock.calls[0][1]).toBe(loc(2).startCfi);
    expect(store.addCompletedRange).not.toHaveBeenCalled();

    // Drained: the window timer has nothing left to write.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.updateReadingSession).toHaveBeenCalledTimes(1);
  });

  it('the no-op guard reads the OPEN window, not the (still stale) store', async () => {
    const { recorder, store } = windowed();

    relocate(recorder, 1, 100_000);
    await vi.advanceTimersByTimeAsync(0);
    // The store has not been written yet, but the position is committed:
    // a repeat relocation to it must still be a no-op.
    expect(relocate(recorder, 1, 101_000)).toBe(false);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(store.updateReadingSession).toHaveBeenCalledTimes(1);
  });

  it('the active-recorder registry drains the window (the E2E persistence flush)', async () => {
    const { recorder, store } = windowed();
    setActiveReadingSessionRecorder(recorder);
    try {
      relocate(recorder, 1, 100_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(store.updateReadingSession).not.toHaveBeenCalled();

      flushActiveReadingSession();
      expect(store.updateReadingSession).toHaveBeenCalledTimes(1);
      expect(store.updateReadingSession.mock.calls[0][1]).toBe(loc(1).startCfi);
    } finally {
      setActiveReadingSessionRecorder(null);
    }
    // Cleared: a stale registry entry must not write for a torn-down reader.
    expect(() => flushActiveReadingSession()).not.toThrow();
  });

  it('dispose issues the window and leaves no timer behind', async () => {
    const { recorder, store } = windowed();

    relocate(recorder, 1, 100_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.updateReadingSession).not.toHaveBeenCalled();

    recorder.dispose();

    expect(store.updateReadingSession).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.updateReadingSession).toHaveBeenCalledTimes(1);
  });
});

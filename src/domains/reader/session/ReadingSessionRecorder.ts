/**
 * ReadingSessionRecorder — reading-history + progress recording, extracted
 * from the shell's inline onLocationChange/panic-save logic (Phase 6 §6,
 * prep/phase6-reader-engine.md PR-6).
 *
 * SERIALIZED (the D6 fix, its own commit after the verbatim extraction):
 * recordings run on a per-book FIFO — one in flight, the rest queued as
 * plain data — with a monotonic sequence number. The legacy code launched
 * one async pass per relocation (two `snapCfiToSentence` awaits, then the
 * store write), so a slow snap for relocation N could commit AFTER N+1 and
 * leave `currentCfi` pointing backwards. Now:
 *
 *  - commits happen strictly in event order (FIFO pump),
 *  - `flushSync()` drains everything still queued/in flight synchronously
 *    WITHOUT snapping (raw ranges — the book may be tearing down) before
 *    the final panic segment, and
 *  - a write whose seq is already covered when its async pass completes is
 *    DROPPED (it was committed by flushSync; the late duplicate dies).
 *
 * Dwell durations and the previous-range label are captured AT EVENT TIME
 * (the legacy async body read them synchronously before its first await),
 * so queueing never inflates a dwell or mislabels a range.
 *
 * COALESCED (perf, P-mem): every commit used to issue its own
 * `store.updateReadingSession`, and the progress store is a CRDT — Yjs is
 * append-only, so each write leaves permanent Y.Doc growth (tombstones and
 * delete-set ranges survive `encodeStateAsUpdate`). Measured against the real
 * vendored middleware that is ~65 bytes per page turn, which compounds into
 * cold-boot `Y.applyUpdate` hydration of 22ms at 500 turns → 283ms at 40k, a
 * per-write scoped-diff cost of 0.57ms → 2.49ms, and a document the user
 * carries and syncs forever. Commits now land in a {@link COMMIT_WINDOW_MS}
 * window and issue ONE store write per window: the updates concatenate in
 * event order and the LAST event's `currentCfi`/`percentage` win, which is
 * exactly what the store would have ended up with.
 *
 * Durability is the constraint, not the cadence. The window is drained:
 *  - by {@link ReadingSessionRecorder.flushSync} (unmount panic save), whose
 *    semantics are otherwise unchanged;
 *  - by {@link ReadingSessionRecorder.flushPending}, which the owner wires to
 *    `visibilitychange` → hidden and `pagehide` — the only signals a mobile
 *    background kill reliably delivers — and which drains the FIFO too, so it
 *    is strictly more durable than the un-coalesced code was at that instant;
 *  - by `dispose()`, before the recorder goes quiet.
 * The window's own timer never outlives disposal, and while a window is open
 * the no-op CFI guard compares against ITS position rather than the store's,
 * so the guard behaves exactly as it did when every commit wrote through.
 *
 * Single-sourced per §6: the `'Chapter'` placeholder filter and the ONE
 * `buildUpdates({snap})` pass both the live path and flushSync use.
 *
 * Store access is injected (deps.store) so this module satisfies the
 * domains-no-store boundary; the shell wires the real
 * useReadingStateStore actions.
 */
import { generateCfiRange, snapCfiToSentence, type CfiRangeResolver } from '@kernel/cfi';
import { createLogger } from '@lib/logger';
import type { EngineLocation } from '@domains/reader/engine/ReaderEngine';
import type { ReadingEventType } from '~types/user-data';

const logger = createLogger('ReadingSessionRecorder');

/** One reading-history update (mirrors the store's SessionUpdate shape). */
export interface SessionUpdateEntry {
  range: string;
  type?: ReadingEventType;
  label?: string;
}

/** The recorder's resolver: kernel range resolution + the OPF language. */
export interface SessionResolver extends CfiRangeResolver {
  getLanguage(): string | undefined;
}

export interface SessionEvent {
  location: EngineLocation;
  /** Pre-computed progress percentage (EngineLocation.percentage). */
  percentage: number;
  /** Section title reported with this relocation (labels the CURRENT range). */
  title: string | null;
  viewMode: 'paginated' | 'scrolled';
  /** Event timestamp (Date.now() at relocation). */
  at: number;
}

export interface ReadingSessionRecorderDeps {
  bookId: string;
  /**
   * The live resolver (the ReaderEngine), read per event — it is null
   * until the book renders and may be torn down before the recorder.
   */
  getResolver: () => SessionResolver | null;
  store: {
    /** The book's current saved CFI (the no-op relocation guard). */
    getCurrentCfi(): string | undefined;
    updateReadingSession(
      bookId: string,
      currentCfi: string,
      percentage: number,
      updates: SessionUpdateEntry[],
    ): void;
    addCompletedRange(
      bookId: string,
      range: string,
      type?: ReadingEventType,
      label?: string,
    ): void;
  };
  /**
   * Panic-save context (the legacy `panicSaveState` ref, injected): the
   * store-synced section title + view mode, read at recording/flush time —
   * the title can drift after the last relocation via the TOC-preference
   * sync effect, so it is read live rather than remembered per event.
   */
  getContext: () => { title: string | null; viewMode: 'paginated' | 'scrolled' };
  /** Fires when a previous-range history entry was recorded (history tick). */
  onHistoryRecorded?: () => void;
  now?: () => number;
  /**
   * How long committed recordings are merged before ONE store write is
   * issued (default {@link COMMIT_WINDOW_MS}). Injected so tests can drive it
   * with fake timers; `0` disables coalescing and writes through per commit.
   */
  commitWindowMs?: number;
}

/**
 * Default coalescing window. Long enough to merge a burst (scrolled mode, TTS
 * sentence relocations, fast flipping) into one CRDT write; short enough that
 * nothing but a hard crash between the flush signals can outrun it.
 */
const COMMIT_WINDOW_MS = 5_000;

/**
 * The `'Chapter'` placeholder filter — single-sourced (§6: it was
 * string-matched independently in the live path and the panic save).
 */
function isPlaceholderLabel(label: string | undefined): boolean {
  return label === 'Chapter';
}

/** One queued recording, captured as plain data at event time. */
interface QueuedRecording {
  seq: number;
  e: SessionEvent;
  /** Previous segment snapshot (before the tracker advanced). */
  previous: { start: string; end: string } | null;
  /** Dwell on the previous segment, measured AT EVENT TIME. */
  previousDurationMs: number;
  /** Title for the previous range, captured AT EVENT TIME (legacy timing). */
  previousTitle: string | null;
  /** Resolver captured at event time (legacy read engineRef synchronously). */
  resolver: SessionResolver | null;
}

export class ReadingSessionRecorder {
  private previous: { start: string; end: string; timestamp: number } | null = null;
  private disposed = false;

  /** FIFO of recordings not yet started. */
  private pending: QueuedRecording[] = [];
  /** The recording whose async snap pass is currently running. */
  private inFlight: QueuedRecording | null = null;
  private pumping = false;
  private seqCounter = 0;
  /** Highest seq whose write has been committed (stale completions drop). */
  private committedSeq = 0;

  /** The merged store write waiting on the current window, if any. */
  private pendingCommit: {
    currentCfi: string;
    percentage: number;
    updates: SessionUpdateEntry[];
    historyAppended: boolean;
  } | null = null;
  /** The open window's timer. Never survives {@link dispose}. */
  private pendingCommitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: ReadingSessionRecorderDeps) {}

  /**
   * Initializes the previous-location tracker without recording (legacy
   * step 1 of onLocationChange — it ran even when the import-jump check
   * subsequently skipped the save). Idempotent.
   */
  prime(location: EngineLocation, at: number): void {
    if (this.disposed) return;
    if (!this.previous) {
      this.previous = {
        start: location.startCfi,
        end: location.endCfi,
        timestamp: at,
      };
    }
  }

  /**
   * Records one relocation. Mirrors the legacy onLocationChange body:
   * initialize-previous, no-op guard against the saved CFI, async
   * previous-range snapping + atomic session update, then the synchronous
   * previous-location advance.
   *
   * @returns false when the no-op guard skipped the event (the legacy code
   * also skipped the section-title update in that case — the shell mirrors
   * that on a false return).
   */
  onRelocated(e: SessionEvent): boolean {
    if (this.disposed) return false;
    const now = this.deps.now ?? Date.now;

    // Initialize previousLocation if it's null (e.g. initial load), so we
    // can track subsequent moves
    this.prime(e.location, e.at);

    // Prevent infinite loop if CFI hasn't changed (handled in store
    // usually, but double check). An open window holds a position that HAS
    // been committed but not yet written through, so it answers this instead
    // of the store — which keeps the guard identical to the write-through
    // behavior it replaced.
    const savedCfi = this.pendingCommit ? this.pendingCommit.currentCfi : this.deps.store.getCurrentCfi() || '';
    if (e.location.startCfi === savedCfi) return false;

    // Capture everything the recording needs AT EVENT TIME (the legacy
    // async body read all of this synchronously before its first await):
    // previous segment, its dwell, its label, the live resolver.
    const previous = this.previous
      ? { start: this.previous.start, end: this.previous.end }
      : null;
    const previousDurationMs = this.previous ? now() - this.previous.timestamp : 0;
    this.pending.push({
      seq: ++this.seqCounter,
      e,
      previous,
      previousDurationMs,
      previousTitle: this.deps.getContext().title,
      resolver: this.deps.getResolver(),
    });
    void this.pump();

    // Update refs immediately (independent of store storage)
    this.previous = {
      start: e.location.startCfi,
      end: e.location.endCfi,
      timestamp: now(),
    };
    return true;
  }

  /** The per-book FIFO: exactly one recording's snap pass in flight. */
  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.pending.length > 0) {
        const item = this.pending.shift()!;
        this.inFlight = item;
        try {
          const { updates, historyAppended } = await this.buildUpdates(item, { snap: true });
          this.commit(item, updates, historyAppended);
        } catch (err) {
          logger.error('Failed to update reading session', err);
        } finally {
          this.inFlight = null;
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  /**
   * Commits one recording — strictly once per seq: a completion whose seq
   * was already covered (flushSync drained it synchronously) drops.
   */
  private commit(item: QueuedRecording, updates: SessionUpdateEntry[], historyAppended: boolean): void {
    if (item.seq <= this.committedSeq) return; // stale: already committed
    this.committedSeq = item.seq;

    const windowMs = this.deps.commitWindowMs ?? COMMIT_WINDOW_MS;
    if (windowMs <= 0) {
      // Coalescing disabled: write through exactly as the legacy path did.
      if (historyAppended) this.deps.onHistoryRecorded?.();
      this.deps.store.updateReadingSession(
        this.deps.bookId,
        item.e.location.startCfi,
        item.e.percentage,
        updates,
      );
      return;
    }

    if (!this.pendingCommit) {
      this.pendingCommit = {
        currentCfi: item.e.location.startCfi,
        percentage: item.e.percentage,
        updates: [...updates],
        historyAppended,
      };
    } else {
      // Updates concatenate in event order; the LAST event owns the position
      // (the store applies currentCfi/percentage after merging the ranges, so
      // the merged write lands exactly where the per-commit writes would have).
      this.pendingCommit.updates.push(...updates);
      this.pendingCommit.currentCfi = item.e.location.startCfi;
      this.pendingCommit.percentage = item.e.percentage;
      this.pendingCommit.historyAppended = this.pendingCommit.historyAppended || historyAppended;
    }

    if (this.pendingCommitTimer === null) {
      this.pendingCommitTimer = setTimeout(() => {
        this.pendingCommitTimer = null;
        this.flushWindow();
      }, windowMs);
    }
  }

  /** Issue the merged window's single store write (no-op when none is open). */
  private flushWindow(): void {
    if (this.pendingCommitTimer !== null) {
      clearTimeout(this.pendingCommitTimer);
      this.pendingCommitTimer = null;
    }
    const pending = this.pendingCommit;
    this.pendingCommit = null;
    if (!pending) return;
    if (pending.historyAppended) this.deps.onHistoryRecorded?.();
    try {
      this.deps.store.updateReadingSession(
        this.deps.bookId,
        pending.currentCfi,
        pending.percentage,
        pending.updates,
      );
    } catch (err) {
      logger.error('Failed to update reading session', err);
    }
  }

  /**
   * Drain the FIFO synchronously WITHOUT snapping (raw ranges — this runs
   * when the page may be about to go away). Shared by {@link flushPending}
   * and {@link flushSync}.
   */
  private drainQueue(): void {
    const toDrain: QueuedRecording[] = [];
    if (this.inFlight && this.inFlight.seq > this.committedSeq) {
      toDrain.push(this.inFlight);
    }
    toDrain.push(...this.pending.splice(0));
    for (const item of toDrain) {
      try {
        const { updates, historyAppended } = this.buildUpdatesSync(item);
        this.commit(item, updates, historyAppended);
      } catch (err) {
        logger.error('Session flush failed', err);
      }
    }
  }

  /**
   * Durability drain WITHOUT the panic-save final segment: everything still
   * queued or in flight is committed unsnapped and the coalescing window is
   * issued immediately. The owner wires this to `visibilitychange` → hidden
   * and `pagehide`, so a backgrounded (and possibly killed) tab can never lose
   * the user's place to an unflushed window.
   */
  flushPending(): void {
    this.drainQueue();
    this.flushWindow();
  }

  /**
   * Unmount panic save: drains every recording still queued or in flight
   * SYNCHRONOUSLY without snapping (raw ranges — the book may already be
   * torn down mid-unmount; the late async completion of the in-flight item
   * is dropped by the seq guard), then writes the legacy final segment.
   */
  flushSync(): void {
    // 1. Drain the queue (snap=false). The in-flight recording (if any)
    //    has not committed yet — commit it here; its async completion will
    //    be stale and drop. Then issue the coalescing window, so the store
    //    write lands BEFORE the final panic segment, exactly as the
    //    write-through commits did.
    this.drainQueue();
    this.flushWindow();

    // 2. Legacy final-segment panic save (verbatim semantics).
    if (!this.previous) return;
    const now = this.deps.now ?? Date.now;

    const prevStart = this.previous.start;
    const prevEnd = this.previous.end;
    const duration = now() - this.previous.timestamp;

    // Only save if duration > 2s (avoid strict mode double-mounts and accidental nav)
    if (prevStart && prevEnd && duration > 2000) {
      const context = this.deps.getContext();
      const range = generateCfiRange(prevStart, prevEnd);
      const type: ReadingEventType = context.viewMode === 'scrolled' ? 'scroll' : 'page';
      const label = context.title || undefined;

      if (!isPlaceholderLabel(label)) {
        try {
          this.deps.store.addCompletedRange(this.deps.bookId, range, type, label);
        } catch (err) {
          logger.error('History panic save failed', err);
        }
      }
    }
  }

  dispose(): void {
    // A window holds positions that ALREADY committed and have simply not
    // been written through yet — dropping them would lose the user's place,
    // so it is issued before the recorder goes quiet. (The shell calls
    // flushSync first, so this is normally a no-op.)
    this.flushWindow();
    this.disposed = true;
    // Anything still queued or in flight must not write post-dispose
    // (flushSync, called first by the shell, already drained it).
    this.pending = [];
    this.committedSeq = this.seqCounter;
  }

  /** Does the previous segment qualify for a history entry? (verbatim) */
  private previousQualifies(item: QueuedRecording): boolean {
    if (!item.previous) return false;
    const isScroll = item.e.viewMode === 'scrolled';
    const shouldSave = isScroll ? item.previousDurationMs > 2000 : true;
    return Boolean(
      item.previous.start &&
        item.previous.end &&
        item.previous.start !== item.e.location.startCfi &&
        shouldSave,
    );
  }

  /** The previous-range entry from already-resolved CFIs. */
  private previousEntry(
    item: QueuedRecording,
    start: string,
    end: string,
  ): SessionUpdateEntry | null {
    const type: ReadingEventType = item.e.viewMode === 'scrolled' ? 'scroll' : 'page';
    const label = item.previousTitle || undefined;
    // Ignore generic "Chapter" placeholder
    if (isPlaceholderLabel(label)) return null;
    return { range: generateCfiRange(start, end), type, label };
  }

  /** The current-range entry (always appended; legacy keeps its raw label). */
  private currentEntry(item: QueuedRecording): SessionUpdateEntry {
    const currentRange = generateCfiRange(item.e.location.startCfi, item.e.location.endCfi);
    const currentType: ReadingEventType = item.e.viewMode === 'scrolled' ? 'scroll' : 'page';
    return { range: currentRange, type: currentType, label: item.e.title ?? undefined };
  }

  /**
   * ONE recording pass (§6 `recordSession({snap})`): previous range when it
   * qualifies (sentence-snapped on the live path), then the current range.
   */
  private async buildUpdates(
    item: QueuedRecording,
    opts: { snap: boolean },
  ): Promise<{ updates: SessionUpdateEntry[]; historyAppended: boolean }> {
    if (!opts.snap) return this.buildUpdatesSync(item);

    const updates: SessionUpdateEntry[] = [];
    let historyAppended = false;

    if (this.previousQualifies(item) && item.resolver) {
      const { start, end } = item.previous!;
      try {
        // Resolver = kernel CfiRangeResolver; the OPF language keeps
        // snapping locale-aware.
        const language = item.resolver.getLanguage();
        const [snappedStart, snappedEnd] = await Promise.all([
          snapCfiToSentence(item.resolver, start, language),
          snapCfiToSentence(item.resolver, end, language),
        ]);
        const entry = this.previousEntry(item, snappedStart, snappedEnd);
        if (entry) {
          updates.push(entry);
          historyAppended = true;
        }
      } catch (err) {
        logger.error('History processing failed', err);
        // Continue even if history fails, to save current location
      }
    }

    updates.push(this.currentEntry(item));
    return { updates, historyAppended };
  }

  /** The snap=false pass (flushSync drain): raw previous range, sync. */
  private buildUpdatesSync(item: QueuedRecording): {
    updates: SessionUpdateEntry[];
    historyAppended: boolean;
  } {
    const updates: SessionUpdateEntry[] = [];
    let historyAppended = false;

    if (this.previousQualifies(item) && item.resolver) {
      const entry = this.previousEntry(item, item.previous!.start, item.previous!.end);
      if (entry) {
        updates.push(entry);
        historyAppended = true;
      }
    }

    updates.push(this.currentEntry(item));
    return { updates, historyAppended };
  }
}

// ── Active-recorder registry ──────────────────────────────────────────────
//
// The coalescing window means the Y.Doc trails the reader by up to
// COMMIT_WINDOW_MS, so anything that has to observe the CURRENT position from
// outside the reader tree must be able to drain it. Same prod-safe shape as
// domains/reader/engine/activeEngineRegistry: one module-scope variable, no
// side effects, and no import of its consumers.
//
// Its consumer today is the E2E persistence flush
// (`window.__versicleTest.flushPersistence`, src/test-api.ts): specs turn a
// page and then flush, so the window has to be issued BEFORE y-idb drains or
// the spec would persist a position the reader has already left.

let activeRecorder: ReadingSessionRecorder | null = null;

/** The reader lifecycle registers its live recorder here, and clears it. */
export function setActiveReadingSessionRecorder(recorder: ReadingSessionRecorder | null): void {
  activeRecorder = recorder;
}

/** Issue the live recorder's merged window right now (no-op when none). */
export function flushActiveReadingSession(): void {
  activeRecorder?.flushPending();
}

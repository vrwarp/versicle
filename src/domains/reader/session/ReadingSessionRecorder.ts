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
}

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
    // usually, but double check)
    if (e.location.startCfi === (this.deps.store.getCurrentCfi() || '')) return false;

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
    if (historyAppended) {
      this.deps.onHistoryRecorded?.();
    }
    this.deps.store.updateReadingSession(
      this.deps.bookId,
      item.e.location.startCfi,
      item.e.percentage,
      updates,
    );
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
    //    be stale and drop.
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

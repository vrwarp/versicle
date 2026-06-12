/**
 * ReadingSessionRecorder — reading-history + progress recording, extracted
 * from the shell's inline onLocationChange/panic-save logic (Phase 6 §6,
 * prep/phase6-reader-engine.md PR-6).
 *
 * EXTRACTION COMMIT: write behavior is byte-identical to the legacy inline
 * code (ReaderView's onLocationChange `prepareUpdates` + the unmount panic
 * save), including the D6 bug this extraction deliberately PRESERVES:
 * per-relocation async `recordSession` calls run concurrently (two
 * `snapCfiToSentence` awaits then a store write), so in-flight calls can
 * commit out of order. The per-book FIFO serialization is the next commit,
 * with its interleaving unit test — never silently here.
 *
 * What IS single-sourced already (per §6): the `'Chapter'` placeholder
 * filter, previously string-matched in two places.
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

export class ReadingSessionRecorder {
  private previous: { start: string; end: string; timestamp: number } | null = null;
  private disposed = false;

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

    // Snapshot the previous segment for the async pass BEFORE advancing it.
    const previous = this.previous;

    // EXTRACTION COMMIT (D6 preserved): fire-and-forget — concurrent
    // in-flight recordings can commit out of order, exactly like the
    // legacy inline prepareUpdates. Serialization is the next commit.
    this.recordSession(e, previous).catch((err) => {
      logger.error('Failed to update reading session', err);
    });

    // Update refs immediately (independent of store storage)
    this.previous = {
      start: e.location.startCfi,
      end: e.location.endCfi,
      timestamp: now(),
    };
    return true;
  }

  /**
   * Unmount panic save (legacy semantics, verbatim): synchronous, raw
   * capture of the last segment — no snapping, because the book/resolver
   * may already be torn down mid-unmount.
   */
  flushSync(): void {
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
  }

  /**
   * One recording pass ({snap} unified per §6): snap + append the previous
   * range (when it qualifies), always append the current range, commit as
   * ONE atomic store update.
   */
  private async recordSession(
    e: SessionEvent,
    previous: { start: string; end: string; timestamp: number } | null,
  ): Promise<void> {
    const now = this.deps.now ?? Date.now;
    const updates: SessionUpdateEntry[] = [];

    // 1. Calculate Previous Range (Async)
    if (previous) {
      const prevStart = previous.start;
      const prevEnd = previous.end;
      const duration = now() - previous.timestamp;
      const isScroll = e.viewMode === 'scrolled';
      const shouldSave = isScroll ? duration > 2000 : true;

      if (prevStart && prevEnd && prevStart !== e.location.startCfi && shouldSave) {
        const resolver = this.deps.getResolver();
        // Capture title synchronously before async op to avoid race
        // condition with the shell's section update.
        const previousSectionTitle = this.deps.getContext().title;

        if (resolver) {
          try {
            // Resolver = kernel CfiRangeResolver; the OPF language keeps
            // snapping locale-aware.
            const language = resolver.getLanguage();
            const [snappedStart, snappedEnd] = await Promise.all([
              snapCfiToSentence(resolver, prevStart, language),
              snapCfiToSentence(resolver, prevEnd, language),
            ]);

            const range = generateCfiRange(snappedStart, snappedEnd);
            const type: ReadingEventType = isScroll ? 'scroll' : 'page';
            const label = previousSectionTitle || undefined;

            // Ignore generic "Chapter" placeholder
            if (!isPlaceholderLabel(label)) {
              updates.push({ range, type, label });
              this.deps.onHistoryRecorded?.();
            }
          } catch (err) {
            logger.error('History processing failed', err);
            // Continue even if history fails, to save current location
          }
        }
      }
    }

    // 2. Calculate Current Range (Sync)
    // Ensure current segment is in history so it appears at top of list
    const currentRange = generateCfiRange(e.location.startCfi, e.location.endCfi);
    const currentType: ReadingEventType = e.viewMode === 'scrolled' ? 'scroll' : 'page';
    updates.push({ range: currentRange, type: currentType, label: e.title ?? undefined });

    // 3. Single Atomic Update
    this.deps.store.updateReadingSession(
      this.deps.bookId,
      e.location.startCfi,
      e.percentage,
      updates,
    );
  }
}

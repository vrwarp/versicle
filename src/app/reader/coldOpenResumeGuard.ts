/**
 * ColdOpenResumeGuard — protects the saved reading position from a "cold
 * open": an open whose display-time resolution found no saved CFI. Two
 * situations produce one:
 *
 *  1. The book has genuinely never been read (nothing to protect).
 *  2. The Yjs IndexedDB load hasn't delivered the progress store yet.
 *     Boot's `whenHydrated` phase is warn-and-proceed, so a direct
 *     /read/:id entry (mid-read refresh, tab restore) on a slow load can
 *     open at the book's start while the real position is still in
 *     transit. Un-guarded, the very first relocation then OVERWRITES the
 *     saved CFI with "chapter 1, ~0%": the recorder's no-op guard compares
 *     against the live store, sees a mismatch, and commits — the
 *     mislanding becomes durable and every later resume replays it.
 *
 * The guard cannot tell 1 from 2 until the store is trustworthy, so:
 *  - While armed and the IDB load is un-settled, every recorder write is
 *    withheld (`writesBlocked`) — nothing may commit over a position that
 *    may still be loading. (History for these relocations is dropped too:
 *    it would describe pages of a mislanding.)
 *  - The first relocation after the load settles runs a ONE-SHOT
 *    reconciliation: a valid saved CFI now visible, with the reader still
 *    effectively at the start, means the open mislanded → re-display to it
 *    and skip recording the mislanded event. Nothing valid means case 1 —
 *    disarm and let writes flow. A reader NOT at the start means the user
 *    navigated deliberately while quarantined — their position wins.
 *
 * Deps are injected (settledness, store read, engine display) so the guard
 * unit-tests without a live engine — same pattern as ReadingSessionRecorder.
 */
import type { UserProgress } from '~types/user-data';
import { isValidProgress } from '@store/useReadingStateStore';
import { createLogger } from '@lib/logger';

const logger = createLogger('ColdOpenResumeGuard');

/**
 * "Effectively at the start": the same threshold the import-jump prompt
 * uses for "the user hasn't really gone anywhere yet".
 */
const AT_START_THRESHOLD = 0.01;

export interface ColdOpenResumeGuardDeps {
  /** Has the Yjs IndexedDB load actually completed? (isYjsSyncSettled) */
  isSyncSettled(): boolean;
  /** Live saved progress for THIS book (useReadingStateStore.getProgress). */
  getSavedProgress(): UserProgress | null;
  /** Jump the reader (engine.display). */
  display(cfi: string): Promise<void>;
  /** Fired once when a mislanded open was restored (toast hook). */
  onRestored?(): void;
}

export type ColdOpenRelocationVerdict =
  /** Record normally. */
  | 'pass'
  /** Store not yet trustworthy — update cosmetic UI, record nothing. */
  | 'blocked'
  /** Mislanding detected and re-displayed — skip this event entirely. */
  | 'restored';

export class ColdOpenResumeGuard {
  private armed = false;

  constructor(private readonly deps: ColdOpenResumeGuardDeps) {}

  /**
   * Latch from the display-time resolver: an open that resolved a location
   * is warm (the guard stays idle); one that resolved none arms it.
   */
  noteResolvedInitialLocation(location: string | undefined): void {
    this.armed = !location;
  }

  /**
   * While true, no recorder write may reach the store — the shell chokes
   * the recorder's store deps on this. Covers the unmount panic save too:
   * `flushSync` during quarantine must not commit the mislanded segment.
   */
  get writesBlocked(): boolean {
    return this.armed;
  }

  /**
   * Run on every relocation BEFORE the import-jump check and the recorder.
   */
  onRelocated(percentage: number): ColdOpenRelocationVerdict {
    if (!this.armed) return 'pass';
    if (!this.deps.isSyncSettled()) return 'blocked';

    // One-shot: the store is now trustworthy, whatever we decide.
    this.armed = false;

    const saved = this.deps.getSavedProgress();
    const savedCfi = saved?.currentCfi;
    if (
      savedCfi &&
      isValidProgress(saved) &&
      percentage < AT_START_THRESHOLD
    ) {
      this.deps.display(savedCfi).catch((err: unknown) => {
        // A stale CFI (book re-imported since) can fail to resolve; the
        // user stays at the start and the NEXT relocation records normally.
        logger.warn('Cold-open restore failed; continuing from start', err);
      });
      this.deps.onRestored?.();
      return 'restored';
    }
    // No valid saved CFI (genuinely new book, or import-with-percentage-
    // only — the ImportJumpPrompt owns that flow), or the user has already
    // navigated away from the start: record normally from here on.
    return 'pass';
  }
}

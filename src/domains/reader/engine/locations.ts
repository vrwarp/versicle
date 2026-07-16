/**
 * locations — the CFI↔percentage registry cache, extracted verbatim from
 * useEpubReader's load generator (Phase 6 §5 table, prep doc PR-4).
 *
 * Load-or-generate semantics: a saved registry (IDB, per book) loads
 * synchronously; otherwise epub.js generates one in the background
 * (1000-char granularity) and persists it. D7 hardening is preserved from
 * the engine-port commit: the generate promise re-checks `isCurrent()`
 * before every step (the legacy code wrote after destroy) and failures log
 * loudly instead of vanishing into an unhandled rejection.
 */
import type { Book } from 'epubjs';
import { bookContent } from '@data/repos/bookContent';
import { createLogger } from '@lib/logger';
import { measureSince } from '@lib/perf';

const logger = createLogger('reader-locations');

export interface InitLocationsDeps {
  book: Book;
  bookId: string;
  /** False once the load was cancelled or a newer book replaced this one. */
  isCurrent: () => boolean;
  /** Fires when the registry is usable (loaded or generated+saved). */
  onReady: () => void;
}

/**
 * Initializes the location registry for a freshly-rendered book. Resolves
 * once the *decision* is made (saved registry loaded, or background
 * generation kicked off) — generation itself never blocks first paint.
 */
export async function initializeLocations(deps: InitLocationsDeps): Promise<void> {
  const { book, bookId, isCurrent, onReady } = deps;

  const savedLocations = await bookContent.getLocations(bookId);
  if (!isCurrent()) return;

  if (savedLocations) {
    const loadStart = performance.now();
    book.locations.load(savedLocations.locations);
    measureSince('reader:locations-load', loadStart);
    onReady();
    return;
  }

  // Generate in background. D7 (prep/phase6-reader-engine.md §2b): the
  // generate promise used to write after destroy and had no rejection
  // handler — guard on the live book + catch loudly.
  //
  // epub.js sleeps `pause` ms (default 100) between sections during
  // generation — on a long book that alone is many seconds of sleep before
  // percentage/scrubber features work (and before the registry is persisted
  // for future opens). The per-section work still runs one macrotask at a
  // time, so a small pause keeps the main thread responsive while finishing
  // an order of magnitude sooner. `pause` is an undeclared internal.
  (book.locations as unknown as { pause: number }).pause = 10;
  const generateStart = performance.now();
  book.locations.generate(1000).then(async () => {
    measureSince('reader:locations-generate', generateStart);
    if (!isCurrent()) return; // cancelled/destroyed
    const locationStr = book.locations.save();
    await bookContent.saveLocations(bookId, locationStr);
    if (!isCurrent()) return;
    onReady();
  }).catch((e) => {
    logger.warn('Location generation failed', e);
  });
}

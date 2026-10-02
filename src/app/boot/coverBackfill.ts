/**
 * `coverBackfillTask` — one-time recovery of covers for books imported
 * before the malformed-EPUB hardening (plan/epub-toc-cover-hardening.md §5,
 * decision §9.3: automatic, once, after the update).
 *
 * Import used to find a cover only through epub.js's two OPF markers, so a
 * book whose cover lived in a cover page (or was declared any other
 * non-standard way) was stored with NO cover and shows the "Aa" placeholder
 * forever — reprocessing never rewrites the cover. This pass re-runs just
 * the cover step of the import preamble for every local book without one,
 * on idle, once per device (localStorage flag). The Data settings panel's
 * "Re-scan covers" button runs the same pass on demand.
 *
 * {@link runCoverBackfill} is pure/injectable (the suite drives it with
 * fakes); the boot task and {@link rescanCovers} bind the real repos/stores.
 */
import type { BootTask } from '../bootstrap';
import type { PerceptualPalette } from '~types/book';
import type { StaticManifestRow } from '@data/rows/static';
import { bookContent } from '@data/repos/bookContent';
import { bookRepository } from '@app/repositories/BookRepository';
import { useBookStore } from '@store/useBookStore';
import { useLibraryStore } from '@store/useLibraryStore';
import { createLogger } from '@lib/logger';

const logger = createLogger('CoverBackfill');

/** Bump to re-run the automatic pass on every device (e.g. after resolver improvements). */
export const COVER_BACKFILL_FLAG = 'versicle.coverBackfill.v1';

export interface ExtractedCover {
  coverBlob?: Blob;
  coverPalette?: number[];
  perceptualPalette?: PerceptualPalette;
}

export interface CoverBackfillDeps {
  listManifests(): Promise<StaticManifestRow[]>;
  /** The book's EPUB bytes, or undefined when offloaded/missing. */
  getBookFile(bookId: string): Promise<Blob | ArrayBuffer | undefined>;
  extractCover(file: Blob): Promise<ExtractedCover>;
  saveCover(row: StaticManifestRow, cover: ExtractedCover & { coverBlob: Blob }): Promise<void>;
  shouldContinue(): boolean;
  /** Breathing room between books (idle callback in the app). */
  pause?(): Promise<void>;
}

export interface CoverBackfillResult {
  /** Local books without a cover that were examined. */
  scanned: number;
  /** Of those, books that now have a cover. */
  found: number;
  failed: number;
}

function hasStoredCover(row: StaticManifestRow): boolean {
  const cover: unknown = row.coverBlob;
  if (cover instanceof Blob) return cover.size > 0;
  if (cover instanceof ArrayBuffer) return cover.byteLength > 0;
  return false;
}

export async function runCoverBackfill(deps: CoverBackfillDeps): Promise<CoverBackfillResult> {
  const result: CoverBackfillResult = { scanned: 0, found: 0, failed: 0 };
  const missing = (await deps.listManifests()).filter((row) => !hasStoredCover(row));
  for (const row of missing) {
    if (!deps.shouldContinue()) break;
    const file = await deps.getBookFile(row.bookId);
    if (!file) continue; // offloaded: the next import/restore extracts it
    result.scanned++;
    try {
      const cover = await deps.extractCover(file instanceof Blob ? file : new Blob([file]));
      if (cover.coverBlob) {
        await deps.saveCover(row, { ...cover, coverBlob: cover.coverBlob });
        result.found++;
      }
    } catch (error) {
      result.failed++;
      logger.warn(`Cover backfill failed for ${row.bookId}:`, error);
    }
    await deps.pause?.();
  }
  return result;
}

function nextIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve());
    else setTimeout(resolve, 0);
  });
}

/** The real seams: repos, the import preamble's cover step, the stores. */
function liveDeps(shouldContinue: () => boolean): CoverBackfillDeps {
  return {
    listManifests: () => bookContent.listManifests(),
    getBookFile: (bookId) => bookContent.getBookFile(bookId),
    extractCover: async (file) => {
      // Lazy: the preamble pulls in epub.js; keep it off the boot graph.
      const { extractPreamble } = await import('@domains/library/import/extract');
      const { coverBlob, coverPalette, perceptualPalette } = await extractPreamble(file, { cover: 'thumbnail' });
      return { coverBlob, coverPalette, perceptualPalette };
    },
    saveCover: async (row, cover) => {
      await bookContent.putManifests([
        {
          ...row,
          coverBlob: await cover.coverBlob.arrayBuffer(),
          coverPalette: cover.coverPalette ?? row.coverPalette,
          perceptualPalette: cover.perceptualPalette ?? row.perceptualPalette,
        },
      ]);
      // The palette is synced inventory (same write reprocess makes).
      if ((cover.coverPalette || cover.perceptualPalette) && useBookStore.getState().books[row.bookId]) {
        useBookStore.getState().updateBook(row.bookId, {
          coverPalette: cover.coverPalette,
          perceptualPalette: cover.perceptualPalette,
        });
      }
      // Refresh the library projection so the card switches to the cover.
      const fresh = await bookRepository.getBookMetadata(row.bookId);
      if (fresh) useLibraryStore.getState().setStaticMetadata(row.bookId, fresh);
    },
    shouldContinue,
    pause: nextIdle,
  };
}

/** Manual "Re-scan covers" (Data settings): runs regardless of the flag. */
export function rescanCovers(): Promise<CoverBackfillResult> {
  return runCoverBackfill(liveDeps(() => true));
}

function readFlag(): boolean {
  try {
    return localStorage.getItem(COVER_BACKFILL_FLAG) === '1';
  } catch {
    return false;
  }
}

function writeFlag(): void {
  try {
    localStorage.setItem(COVER_BACKFILL_FLAG, '1');
  } catch {
    // Unavailable storage: the pass re-runs next boot, and finds nothing new.
  }
}

export const coverBackfillTask: BootTask = {
  name: 'library/cover-backfill',
  run: (ctx) => {
    if (readFlag()) return;
    let cancelled = false;
    const start = () => {
      if (cancelled) return;
      runCoverBackfill(liveDeps(() => !cancelled))
        .then((result) => {
          // A cancelled pass (teardown mid-run) stays unflagged and resumes next boot.
          if (cancelled) return;
          writeFlag();
          if (result.found > 0) logger.info(`Recovered ${result.found} cover(s) of ${result.scanned} scanned`);
        })
        .catch((error) => logger.warn('Cover backfill failed; will retry next boot:', error));
    };
    let cancelIdle: () => void;
    if (typeof requestIdleCallback === 'function') {
      const handle = requestIdleCallback(start);
      cancelIdle = () => cancelIdleCallback(handle);
    } else {
      const timer = setTimeout(start, 0);
      cancelIdle = () => clearTimeout(timer);
    }
    ctx.addCleanup(() => {
      cancelled = true;
      cancelIdle();
    });
  },
};

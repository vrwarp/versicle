/**
 * `metadataBackfillTask` — one-time retry of the copyright-page title/author
 * fallback for books imported before it existed.
 *
 * Books whose OPF has no `dc:creator` (or only a file-name `dc:title`) were
 * stored as "Unknown Author" / `Reasonable Faith.501159.int`. Reprocessing
 * never rewrites title/author, so this pass re-runs the import preamble for
 * every local book still carrying a placeholder, on idle, once per device
 * (localStorage flag), and writes back only what the fallback recovered.
 *
 * {@link runMetadataBackfill} is pure/injectable (the suite drives it with
 * fakes); the boot task binds the real repos/stores.
 */
import type { BootTask } from '../bootstrap';
import type { StaticManifestRow } from '@data/rows/static';
import { bookContent } from '@data/repos/bookContent';
import { bookRepository } from '@app/repositories/BookRepository';
import { useBookStore } from '@store/useBookStore';
import { useLibraryStore } from '@store/useLibraryStore';
import { isPlaceholderTitle } from '@lib/epub/structure/copyrightPage';
import { sanitizeString } from '@domains/library/import/metadata';
import { createLogger } from '@lib/logger';

const logger = createLogger('MetadataBackfill');

/** Bump to re-run the automatic pass on every device (e.g. after resolver improvements). */
export const METADATA_BACKFILL_FLAG = 'versicle.metadataBackfill.v1';

const UNKNOWN_AUTHOR = 'Unknown Author';

export interface RecoveredMetadata {
  title?: string;
  author?: string;
}

export interface MetadataBackfillDeps {
  listManifests(): Promise<StaticManifestRow[]>;
  /** The book's EPUB bytes, or undefined when offloaded/missing. */
  getBookFile(bookId: string): Promise<Blob | ArrayBuffer | undefined>;
  extractMetadata(file: Blob): Promise<{ title: string; author: string }>;
  saveMetadata(row: StaticManifestRow, recovered: RecoveredMetadata): Promise<void>;
  shouldContinue(): boolean;
  /** Breathing room between books (idle callback in the app). */
  pause?(): Promise<void>;
}

export interface MetadataBackfillResult {
  /** Local books with a placeholder title or author that were examined. */
  scanned: number;
  /** Of those, books that got a real title and/or author. */
  fixed: number;
  failed: number;
}

export function isPlaceholderAuthor(author: string | undefined): boolean {
  const a = author?.trim() ?? '';
  return !a || a === UNKNOWN_AUTHOR;
}

export async function runMetadataBackfill(deps: MetadataBackfillDeps): Promise<MetadataBackfillResult> {
  const result: MetadataBackfillResult = { scanned: 0, fixed: 0, failed: 0 };
  const candidates = (await deps.listManifests()).filter(
    (row) => isPlaceholderAuthor(row.author) || isPlaceholderTitle(row.title),
  );
  for (const row of candidates) {
    if (!deps.shouldContinue()) break;
    const file = await deps.getBookFile(row.bookId);
    if (!file) continue; // offloaded: a restore re-imports through the new fallback
    result.scanned++;
    try {
      const extracted = await deps.extractMetadata(file instanceof Blob ? file : new Blob([file]));
      const recovered: RecoveredMetadata = {};
      if (isPlaceholderTitle(row.title) && !isPlaceholderTitle(extracted.title)) {
        recovered.title = sanitizeString(extracted.title, 500);
      }
      if (isPlaceholderAuthor(row.author) && !isPlaceholderAuthor(extracted.author)) {
        recovered.author = sanitizeString(extracted.author, 255);
      }
      if (recovered.title || recovered.author) {
        await deps.saveMetadata(row, recovered);
        result.fixed++;
      }
    } catch (error) {
      result.failed++;
      logger.warn(`Metadata backfill failed for ${row.bookId}:`, error);
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

/** The real seams: repos, the import preamble, the stores. */
function liveDeps(shouldContinue: () => boolean): MetadataBackfillDeps {
  return {
    listManifests: () => bookContent.listManifests(),
    getBookFile: (bookId) => bookContent.getBookFile(bookId),
    extractMetadata: async (file) => {
      // Lazy: the preamble pulls in epub.js; keep it off the boot graph.
      const { extractPreamble } = await import('@domains/library/import/extract');
      const { title, author } = await extractPreamble(file, { cover: 'raw' });
      return { title, author };
    },
    saveMetadata: async (row, recovered) => {
      await bookContent.putManifests([{ ...row, ...recovered }]);
      // The inventory snapshot is synced (ghost-book display on other
      // devices); only replace fields that still hold the placeholder.
      const inventory = useBookStore.getState().books[row.bookId];
      if (inventory) {
        const updates: RecoveredMetadata = {};
        if (recovered.title && isPlaceholderTitle(inventory.title)) updates.title = recovered.title;
        if (recovered.author && isPlaceholderAuthor(inventory.author)) updates.author = recovered.author;
        if (updates.title || updates.author) useBookStore.getState().updateBook(row.bookId, updates);
      }
      // Refresh the library projection so the card shows the new metadata.
      const fresh = await bookRepository.getBookMetadata(row.bookId);
      if (fresh) useLibraryStore.getState().setStaticMetadata(row.bookId, fresh);
    },
    shouldContinue,
    pause: nextIdle,
  };
}

function readFlag(): boolean {
  try {
    return localStorage.getItem(METADATA_BACKFILL_FLAG) === '1';
  } catch {
    return false;
  }
}

function writeFlag(): void {
  try {
    localStorage.setItem(METADATA_BACKFILL_FLAG, '1');
  } catch {
    // Unavailable storage: the pass re-runs next boot, and finds nothing new.
  }
}

export const metadataBackfillTask: BootTask = {
  name: 'library/metadata-backfill',
  run: (ctx) => {
    if (readFlag()) return;
    let cancelled = false;
    const start = () => {
      if (cancelled) return;
      runMetadataBackfill(liveDeps(() => !cancelled))
        .then((result) => {
          // A cancelled pass (teardown mid-run) stays unflagged and resumes next boot.
          if (cancelled) return;
          writeFlag();
          if (result.fixed > 0) logger.info(`Recovered metadata for ${result.fixed} of ${result.scanned} book(s)`);
        })
        .catch((error) => logger.warn('Metadata backfill failed; will retry next boot:', error));
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

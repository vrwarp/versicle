/**
 * The shared import/library controller (Phase 7 §D / PR-L5): EVERY
 * non-reader entry point — FileUploader, LibraryView input/drop, settings,
 * EmptyLibrary, the Drive dialog adapter, dialogs — drives workflows through
 * this surface; `useLibraryStore` is a read-only projection for them.
 *
 * Compatibility contract: `importFile` THROWS `DuplicateBookError` for the
 * 'ask' outcome — the pre-P7 `addBook` signal every Replace-dialog flow is
 * built around — and failed jobs rethrow their typed error after the
 * orchestrator has already projected the user-facing message.
 */
import { DuplicateBookError } from '~types/errors';
import type { BatchImportSummary, ImportJobResult } from '@domains/library';
import type { UserInventoryItem } from '~types/user-data';
import { getLibrary } from './createLibrary';

async function unwrap(result: ImportJobResult, filename: string): Promise<ImportJobResult> {
  if (result.status === 'duplicate') throw new DuplicateBookError(filename);
  if (result.status === 'failed') throw result.error;
  return result;
}

export const libraryController = {
  /** Single import; duplicates surface as DuplicateBookError (Replace dialog flow). */
  async importFile(file: File): Promise<ImportJobResult> {
    return unwrap(await getLibrary().orchestrator.importFile(file), file.name);
  },

  /** The Replace-dialog confirmation: overwrite the existing book, preserving user data. */
  async replaceFile(file: File): Promise<ImportJobResult> {
    return unwrap(
      await getLibrary().orchestrator.importFile(file, { onDuplicate: 'replace' }),
      file.name,
    );
  },

  /** Batch import (files and/or ZIPs); per-file outcomes land in the summary. */
  importFiles(files: File[]): Promise<BatchImportSummary> {
    return getLibrary().orchestrator.importFiles(files);
  },

  restoreBook: (bookId: string, file: File) => getLibrary().service.restore(bookId, file),
  removeBook: (bookId: string) => getLibrary().service.remove(bookId),
  offloadBook: (bookId: string) => getLibrary().service.offload(bookId),
  reprocessBook: (bookId: string) => getLibrary().orchestrator.reprocess(bookId),
  updateBook: (bookId: string, updates: Partial<UserInventoryItem>) =>
    getLibrary().service.updateBook(bookId, updates),
  hydrate: (forceBookIds?: string[]) => getLibrary().service.hydrate(forceBookIds),
};

export type LibraryController = typeof libraryController;

/** Hook-shaped accessor for components (stable identity). */
export function useImportController(): LibraryController {
  return libraryController;
}

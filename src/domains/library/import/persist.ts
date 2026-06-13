/**
 * The real LibraryPersistence (Phase 7 §B "persist"): one gated transaction
 * per ingest via the bookContent repo, plus the searchText corpus row.
 *
 * WEBKIT INVARIANTS (bug history — do not weaken): Blob → ArrayBuffer
 * conversion happens BEFORE the transaction and reads are hoisted out of
 * readwrite transactions. Both disciplines live in the data layer
 * (`bookContent.ingest` / `replaceDerivedContent`, absorbed there in Phase 3
 * D5.3 after drifting between the ingestion copies caused D4) — this module
 * deliberately adds NO transaction logic of its own.
 *
 * The two yjs-merged reads (BookRepository-backed) are INJECTED: domains
 * never import app/ (depcruise domains-no-store at error) — the composition
 * root (`src/app/library/createLibrary.ts`) passes them in.
 */
import { bookContent } from '@data/repos/bookContent';
import { searchTextRepo } from '@data/repos/searchText';
import { createLogger } from '@lib/logger';
import type { BookMetadata } from '~types/book';
import type { LibraryPersistence } from '../ports';
import type { FullBookExtraction } from './extract';
import { reprocessBookContent } from './reprocess';

const logger = createLogger('LibraryPersist');

/**
 * Retarget an extraction onto an EXISTING bookId (ghost adoption, replace,
 * synced-book restore). Absorbs `BookImportService.importBookWithId`'s id
 * rewrite: every bookId-bearing row — manifest, resource, structure, spine
 * ids, TTS prep ids, table ids, inventory, progress, overrides — is
 * rewritten consistently (ledger row 10).
 */
export function retargetExtraction(extraction: FullBookExtraction, bookId: string): FullBookExtraction {
  const originalBookId = extraction.bookId;
  if (originalBookId === bookId) return extraction;

  return {
    ...extraction,
    bookId,
    manifest: { ...extraction.manifest, bookId },
    resource: { ...extraction.resource, bookId },
    structure: {
      ...extraction.structure,
      bookId,
      spineItems: extraction.structure.spineItems.map((item) => ({
        ...item,
        id: item.id.replace(originalBookId, bookId),
      })),
    },
    sections: extraction.sections.map((s) => ({
      ...s,
      bookId,
      id: s.id.replace(originalBookId, bookId),
    })),
    inventory: { ...extraction.inventory, bookId },
    progress: { ...extraction.progress, bookId },
    overrides: { ...extraction.overrides, bookId },
    ttsContentBatches: extraction.ttsContentBatches.map((batch) => ({
      ...batch,
      id: batch.id.replace(originalBookId, bookId),
      bookId,
    })),
    tableBatches: extraction.tableBatches.map((table) => ({
      ...table,
      id: table.id.replace(originalBookId, bookId),
      bookId,
    })),
  };
}

/** The yjs-merged reads the composition root injects (BookRepository-backed). */
export interface MergedReadDeps {
  getBookMetadata(bookId: string): Promise<BookMetadata | undefined>;
  getBookMetadataBulk?(bookIds: string[]): Promise<(BookMetadata | undefined)[]>;
  getBookIdByFilename(filename: string): string | undefined;
}

export function createLibraryPersistence(merged: MergedReadDeps): LibraryPersistence {
  return {
    async ingest(extraction, opts) {
      await bookContent.ingest(
        {
          bookId: extraction.bookId,
          manifest: extraction.manifest,
          resource: extraction.resource,
          structure: extraction.structure,
          ttsContentBatches: extraction.ttsContentBatches,
          tableBatches: extraction.tableBatches,
        },
        opts.mode,
      );
      // The search corpus rides every ingest (Phase 7 §F). Failure is
      // non-fatal: the row is rebuildable on first search.
      try {
        await searchTextRepo.put({
          bookId: extraction.bookId,
          extractionVersion: extraction.searchText.extractionVersion,
          sections: extraction.searchText.sections,
        });
      } catch (e) {
        logger.warn('searchText write failed (corpus will rebuild lazily):', e);
      }
    },

    deleteBook: (bookId) => bookContent.deleteBook(bookId),
    offloadBook: (bookId) => bookContent.offloadBook(bookId),

    async restoreResource(bookId, file) {
      await bookContent.restoreResource(bookId, await file.arrayBuffer());
    },

    getManifest: (bookId) => bookContent.getManifest(bookId),

    async writeContentHash(bookId, contentHash) {
      const manifest = await bookContent.getManifest(bookId);
      if (!manifest || manifest.contentHash === contentHash) return;
      await bookContent.putManifests([{ ...manifest, contentHash }]);
    },

    getBookMetadata: (bookId) => merged.getBookMetadata(bookId),
    getBookMetadataBulk: merged.getBookMetadataBulk
      ? (bookIds) => merged.getBookMetadataBulk!(bookIds)
      : undefined,
    getOffloadedStatus: (bookIds) => bookContent.getOffloadedStatus(bookIds),
    getAvailableResourceIds: () => bookContent.getAvailableResourceIds(),
    getBookIdByFilename: (filename) => merged.getBookIdByFilename(filename),

    async reprocess(bookId, opts) {
      const result = await reprocessBookContent(bookId, opts);
      try {
        await searchTextRepo.put({
          bookId,
          extractionVersion: result.searchText.extractionVersion,
          sections: result.searchText.sections,
        });
      } catch (e) {
        logger.warn('searchText refresh failed (corpus will rebuild lazily):', e);
      }
      return result;
    },
  };
}

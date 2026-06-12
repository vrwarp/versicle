/**
 * Legacy ingestion façade (Phase 7 PR-L1).
 *
 * The three extraction copies that lived here (`extractBookData`,
 * `extractBookMetadata`, `reprocessBook` — see the deletion table in
 * `domains/library/import/extract.ts`) are DELETED; this module keeps their
 * exported names as one-line delegates over the unified
 * `extractBook()` / `reprocessBookContent()` pipeline while the remaining
 * consumers migrate:
 *
 *  - `extractBookData` / `generateFileFingerprint` → `lib/BookImportService`
 *    (dies at PR-L2 when the ImportOrchestrator absorbs it),
 *  - `extractBookMetadata` → `useLibraryStore`'s ghost probe (moves into the
 *    orchestrator's policy stage at PR-L2),
 *  - `reprocessBook` → `ReprocessingInterstitial` + the reader-side
 *    `ContentAnalysisLegend` (reader files are frozen until the P6 chain
 *    merges; this delegate keeps their import path stable).
 *
 * Deletion deadline for the delegates: Phase 7 exit (alias rule, master
 * plan §4 rule 2) — except `reprocessBook`, which the post-merge reader
 * follow-up re-points before deletion.
 */
import type { NavigationItem, PerceptualPalette } from '~types/db';
import type { CacheTtsPreparation, StaticBookManifest, StaticResource, UserInventoryItem, UserProgress, UserOverrides, TableImage, ReadingListEntry } from '~types/db';
import type { ExtractionOptions } from './ingestion/sentence-extraction';
import { extractBook } from '@domains/library/import/extract';
import { reprocessBookContent } from '@domains/library/import/reprocess';
import { computeLegacyFingerprint } from '@domains/library/import/identity';

// Sanitize-at-ingest helpers moved VERBATIM to domains/library/import/metadata.ts
// (they had already moved here verbatim from src/db/validators.ts in P3 D4).
export {
  validateBookMetadata,
  sanitizeString,
  getSanitizedBookMetadata,
  type SanitizationResult,
} from '@domains/library/import/metadata';

export { validateZipSignature } from '@domains/library/import/validate';

export { extractCoverPalette } from './cover-palette';

/** Legacy fingerprint writer — see domains/library/import/identity.ts. */
export async function generateFileFingerprint(
  file: Blob,
  metadata: { title: string; author: string; filename: string },
): Promise<string> {
  return computeLegacyFingerprint(file, metadata);
}

/**
 * Re-derives a book's content (TOC/sections/TTS prep/tables) from its stored
 * binary, then applies any re-extracted palette to the synced inventory.
 *
 * Kept here (not in domains/) because the inventory write requires the
 * store — the lib→store dynamic edge predates P7 and is on the ratchet
 * baseline. The ImportOrchestrator routes `reprocess` JOBS through
 * `reprocessBookContent` directly, under the book's mutex.
 */
export async function reprocessBook(bookId: string): Promise<void> {
  const result = await reprocessBookContent(bookId);

  // Update Yjs store (inventory) if palette changed
  if (result.coverPalette || result.perceptualPalette) {
    const { useBookStore } = await import('@store/useBookStore');
    const updateBook = useBookStore.getState().updateBook;
    if (updateBook) {
      updateBook(bookId, {
        coverPalette: result.coverPalette,
        perceptualPalette: result.perceptualPalette,
      });
    }
  }
}

export interface BookExtractionData {
  bookId: string;
  manifest: StaticBookManifest;
  resource: StaticResource;
  structure: {
    bookId: string;
    toc: NavigationItem[];
    spineItems: {
      id: string;
      characterCount: number;
      index: number;
    }[];
  };
  inventory: UserInventoryItem;
  progress: UserProgress;
  overrides: UserOverrides;
  readingListEntry: ReadingListEntry;
  ttsContentBatches: CacheTtsPreparation[];
  tableBatches: TableImage[];
}

/** @deprecated PR-L2 deletes this with BookImportService — use `extractBook(file, { depth: 'full' })`. */
export async function extractBookData(
  file: File,
  ttsOptions?: ExtractionOptions,
  onProgress?: (progress: number, message: string) => void,
): Promise<BookExtractionData> {
  const extraction = await extractBook(file, {
    depth: 'full',
    extraction: ttsOptions,
    onProgress,
  });
  return {
    bookId: extraction.bookId,
    manifest: extraction.manifest,
    resource: extraction.resource,
    structure: extraction.structure,
    inventory: extraction.inventory,
    progress: extraction.progress,
    overrides: extraction.overrides,
    readingListEntry: extraction.readingListEntry,
    ttsContentBatches: extraction.ttsContentBatches,
    tableBatches: extraction.tableBatches,
  };
}

/**
 * Lightweight metadata extraction for duplicate/ghost detection.
 * Does NOT perform full content extraction.
 *
 * @deprecated PR-L2 moves the ghost probe into the orchestrator's policy
 * stage — use `extractBook(file, { depth: 'metadata' })`.
 */
export async function extractBookMetadata(file: File): Promise<{
  title: string;
  author: string;
  description: string;
  fileHash: string;
  coverBlob?: Blob;
  coverPalette?: number[];
  perceptualPalette?: PerceptualPalette;
}> {
  const extraction = await extractBook(file, { depth: 'metadata' });
  return {
    title: extraction.title,
    author: extraction.author,
    description: extraction.description,
    fileHash: extraction.legacyFingerprint,
    coverBlob: extraction.coverBlob,
    coverPalette: extraction.coverPalette,
    perceptualPalette: extraction.perceptualPalette,
  };
}

import { useBookStore } from '@store/useBookStore';
import { bookContent } from '@data/repos/bookContent';
import { extractBook, retargetExtraction } from '@domains/library';
import { searchTextRepo } from '@data/repos/searchText';
import { useTTSSettingsStore } from '@store/useTTSSettingsStore';
import { createLogger } from './logger';

const logger = createLogger('MaintenanceService');

/** localStorage flag marking the one-time corrupt-coverBlob repair as complete. */
const COVER_BLOB_REPAIR_FLAG = 'versicle_cover_blob_repair_v1';

/**
 * Service to handle database maintenance and integrity checks.
 * 
 * Post-Yjs Migration: Only handles static_* and cache_* stores.
 * User data stores (user_inventory, user_progress, user_annotations, user_overrides)
 * are now in Yjs and managed by their respective stores.
 */
export class MaintenanceService {
  /**
   * One-time boot repair for cover images corrupted by pre-v3 backup restores
   * (JSON.stringify turned binary coverBlobs into `{}`, and restore blind-put
   * those rows over healthy local manifests).
   *
   * Guarded by a localStorage flag so the scan only runs once per device.
   * The underlying repair is idempotent, so re-running after a wipe is safe.
   */
  async repairCorruptCoverBlobsOnce(): Promise<void> {
    let alreadyDone = false;
    try {
      alreadyDone = localStorage.getItem(COVER_BLOB_REPAIR_FLAG) === '1';
    } catch {
      // localStorage unavailable; fall through and run the (idempotent) repair
    }
    if (alreadyDone) return;

    const repaired = await this.repairCorruptCoverBlobs();
    if (repaired > 0) {
      logger.info(`Repaired ${repaired} corrupt cover blob(s) left by past backup restores`);
    }

    try {
      localStorage.setItem(COVER_BLOB_REPAIR_FLAG, '1');
    } catch {
      // localStorage unavailable; repair will re-run (and no-op) next boot
    }
  }

  /**
   * Scans static_manifests for non-binary coverBlob values (the `{}` left
   * behind when pre-v3 backups serialized ArrayBuffers through JSON) and
   * removes them so covers regenerate from the EPUB. Idempotent.
   *
   * @returns The number of repaired manifest rows.
   */
  async repairCorruptCoverBlobs(): Promise<number> {
    const manifests = await bookContent.listManifests();

    const corrupt = manifests.filter(m => {
      const cover: unknown = m.coverBlob;
      return cover !== undefined && cover !== null
        && !(cover instanceof Blob) && !(cover instanceof ArrayBuffer);
    });

    if (corrupt.length === 0) {
      return 0;
    }

    for (const manifest of corrupt) {
      delete manifest.coverBlob;
    }
    await bookContent.putManifests(corrupt);

    return corrupt.length;
  }

  /**
   * Scans the database for orphaned records (files, cache data without a parent book).
   *
   * @returns A Promise resolving to an object containing the counts of orphaned records found.
   */
  async scanForOrphans(): Promise<{
    files: number;
    locations: number;
    tts_prep: number;
  }> {
    // Use Yjs store as source of truth for valid book IDs
    const books = useBookStore.getState().books;
    const bookIds = new Set(Object.keys(books));

    return bookContent.scanOrphans(bookIds);
  }

  /**
   * Deletes all identified orphaned records.
   *
   * @returns A Promise that resolves when the pruning process is complete.
   */
  async pruneOrphans(): Promise<void> {
    // Use Yjs store as source of truth
    const books = useBookStore.getState().books;
    const bookIds = new Set(Object.keys(books));

    await bookContent.pruneOrphans(bookIds);
  }

  /**
   * Regenerates metadata for all books using the stored EPUB files.
   *
   * @param onProgress - Callback to report progress.
   */
  async regenerateAllMetadata(
    onProgress: (current: number, total: number, message: string) => void
  ): Promise<void> {
    const books = useBookStore.getState().books;
    const bookIds = Object.keys(books);
    const total = bookIds.length;
    let current = 0;

    for (const bookId of bookIds) {
      try {
        const fileBlob = await bookContent.getBookFile(bookId);
        if (fileBlob) {
          // Extract filename from the stored File object if available
          const blobFilename = fileBlob instanceof File ? fileBlob.name : undefined;
          let knownFilename = blobFilename || books[bookId].sourceFilename || null;

          // Special case handling for 'book.epub' which is a placeholder name.
          if (knownFilename == 'book.epub') {
            knownFilename = null;
          }

          const file = new File([fileBlob], knownFilename || 'book.epub', { type: 'application/epub+zip' });

          // Get current settings for extraction
          const { sanitizationEnabled } = useTTSSettingsStore.getState();

          onProgress(current, total, `Regenerating ${books[bookId].title}...`);

          // Phase 7: BookImportService died with the orchestrator cutover —
          // regeneration is extract → retarget-onto-existing-id → overwrite
          // ingest (+ the search corpus that rides every ingest, §F).
          const extraction = retargetExtraction(
            await extractBook(file, { depth: 'full', extraction: { sanitizationEnabled } }),
            bookId,
          );
          await bookContent.ingest(
            {
              bookId,
              manifest: extraction.manifest,
              resource: extraction.resource,
              structure: extraction.structure,
              ttsContentBatches: extraction.ttsContentBatches,
              tableBatches: extraction.tableBatches,
            },
            'overwrite',
          );
          await searchTextRepo.put({
            bookId,
            extractionVersion: extraction.searchText.extractionVersion,
            sections: extraction.searchText.sections,
          });
          const manifest = extraction.manifest;

          // If no filename was found from the blob or inventory, construct one from metadata
          const sourceFilename = knownFilename || `${manifest.title} - ${manifest.author}.epub`;

          // Update Inventory
          // We only update fields that should be refreshed from source.
          // Note: updateBook will merge with existing fields.
          useBookStore.getState().updateBook(bookId, {
            title: manifest.title,
            author: manifest.author,
            coverPalette: manifest.coverPalette,
            sourceFilename,
            // We preserve addedAt, tags, status, etc.
          });

        } else {
          logger.warn(`No file found for book ${bookId}, skipping regeneration.`);
        }
      } catch (e) {
        logger.error(`Failed to regenerate metadata for ${bookId}`, e);
      }
      current++;
      onProgress(current, total, `Completed ${current} of ${total}`);
    }
  }
}

export const maintenanceService = new MaintenanceService();

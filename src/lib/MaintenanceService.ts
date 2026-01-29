import { getDB } from '../db/db';
import { useBookStore } from '../store/useBookStore';
import { dbService } from '../db/DBService';
import { useTTSStore } from '../store/useTTSStore';
import { createLogger } from './logger';

const logger = createLogger('MaintenanceService');

/**
 * Service to handle database maintenance and integrity checks.
 * 
 * Post-Yjs Migration: Only handles static_* and cache_* stores.
 * User data stores (user_inventory, user_progress, user_annotations, user_overrides)
 * are now in Yjs and managed by their respective stores.
 */
export class MaintenanceService {
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
    const db = await getDB();

    // Use Yjs store as source of truth for valid book IDs
    const books = useBookStore.getState().books;
    const bookIds = new Set(Object.keys(books));

    // Check files (static_resources)
    const resourceKeys = await db.getAllKeys('static_resources');
    const orphanedFiles = resourceKeys.filter((k) => !bookIds.has(k.toString()));

    // Check locations (cache_render_metrics)
    const metricKeys = await db.getAllKeys('cache_render_metrics');
    const orphanedLocations = metricKeys.filter((k) => !bookIds.has(k.toString()));

    // Check TTS Prep (cache_tts_preparation)
    let orphanedPrep = 0;
    const prepStore = db.transaction('cache_tts_preparation').objectStore('cache_tts_preparation');
    let prepCursor = await prepStore.openCursor();
    while (prepCursor) {
      if (!bookIds.has(prepCursor.value.bookId)) {
        orphanedPrep++;
      }
      prepCursor = await prepCursor.continue();
    }

    return {
      files: orphanedFiles.length,
      locations: orphanedLocations.length,
      tts_prep: orphanedPrep
    };
  }

  /**
   * Deletes all identified orphaned records.
   *
   * @returns A Promise that resolves when the pruning process is complete.
   */
  async pruneOrphans(): Promise<void> {
    const db = await getDB();

    // Use Yjs store as source of truth
    const books = useBookStore.getState().books;
    const bookIds = new Set(Object.keys(books));

    const tx = db.transaction(
      ['static_resources', 'cache_render_metrics', 'cache_tts_preparation'],
      'readwrite'
    );

    // Prune files (static_resources)
    const filesStore = tx.objectStore('static_resources');
    const fileKeys = await filesStore.getAllKeys();
    for (const key of fileKeys) {
      if (!bookIds.has(key.toString())) {
        await filesStore.delete(key);
      }
    }

    // Prune locations (cache_render_metrics)
    const locationsStore = tx.objectStore('cache_render_metrics');
    const locationKeys = await locationsStore.getAllKeys();
    for (const key of locationKeys) {
      if (!bookIds.has(key.toString())) {
        await locationsStore.delete(key);
      }
    }

    // Prune TTS Prep (cache_tts_preparation)
    const prepStore = tx.objectStore('cache_tts_preparation');
    let prepCursor = await prepStore.openCursor();
    while (prepCursor) {
      if (!bookIds.has(prepCursor.value.bookId)) {
        await prepCursor.delete();
      }
      prepCursor = await prepCursor.continue();
    }

    await tx.done;
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
        const fileBlob = await dbService.getBookFile(bookId);
        if (fileBlob) {
          const file = new File([fileBlob], books[bookId].sourceFilename || 'book.epub', { type: 'application/epub+zip' });

          // Get current settings for extraction
          const { sentenceStarters, sanitizationEnabled } = useTTSStore.getState();

          onProgress(current, total, `Regenerating ${books[bookId].title}...`);

          const manifest = await dbService.importBookWithId(bookId, file, {
            abbreviations: [],
            alwaysMerge: [],
            sentenceStarters,
            sanitizationEnabled
          });

          // Update Inventory
          // We only update fields that should be refreshed from source.
          // Note: updateBook will merge with existing fields.
          useBookStore.getState().updateBook(bookId, {
            title: manifest.title,
            author: manifest.author,
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

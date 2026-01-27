import { getDB } from '../db/db';
import { useBookStore } from '../store/useBookStore';

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
}

export const maintenanceService = new MaintenanceService();

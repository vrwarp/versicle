import { getDB } from '../db/db';

/**
 * Service to handle database maintenance and integrity checks.
 */
export class MaintenanceService {
  /**
   * Scans the database for orphaned records (files, annotations, etc. without a parent book).
   *
   * @returns A Promise resolving to an object containing the counts of orphaned records found.
   */
  async scanForOrphans(): Promise<{
    files: number;
    annotations: number;
    locations: number;
    lexicon: number;
    tts_position: number;
    tts_prep: number;
  }> {
    const db = await getDB();
    const books = await db.getAllKeys('static_manifests'); // Updated to use static_manifests
    const bookIds = new Set(books.map((k) => k.toString()));

    // Check files (static_resources)
    const resourceKeys = await db.getAllKeys('static_resources');
    const orphanedFiles = resourceKeys.filter((k) => !bookIds.has(k.toString()));

    // Check annotations (user_annotations)
    const annotations = await db.getAll('user_annotations');
    const orphanedAnnotations = annotations.filter((a) => !bookIds.has(a.bookId));

    // Check locations (cache_render_metrics)
    const metricKeys = await db.getAllKeys('cache_render_metrics');
    const orphanedLocations = metricKeys.filter((k) => !bookIds.has(k.toString()));

    // Check TTS positions (in user_progress, so not orphanable unless book deleted, but key is bookId)
    // Legacy tts_position store is gone, merged into user_progress.
    // So if user_progress entry exists without manifest?
    const progressKeys = await db.getAllKeys('user_progress');
    const orphanedProgress = progressKeys.filter((k) => !bookIds.has(k.toString()));

    // Check lexicon (user_overrides)
    const rules = await db.getAll('user_overrides');
    const orphanedLexicon = rules.filter(
      (r) => r.bookId !== 'global' && !bookIds.has(r.bookId)
    );

    // Check TTS Prep
    // Iterate using index or cursor
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
      annotations: orphanedAnnotations.length,
      locations: orphanedLocations.length,
      lexicon: orphanedLexicon.length,
      tts_position: orphanedProgress.length,
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
    const books = await db.getAllKeys('static_manifests');
    const bookIds = new Set(books.map((k) => k.toString()));

    const tx = db.transaction(
      ['static_resources', 'user_annotations', 'cache_render_metrics', 'user_overrides', 'user_progress', 'cache_tts_preparation'],
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

    // Prune annotations
    const annotationsStore = tx.objectStore('user_annotations');
    let annCursor = await annotationsStore.openCursor();
    while (annCursor) {
      if (!bookIds.has(annCursor.value.bookId)) {
        await annCursor.delete();
      }
      annCursor = await annCursor.continue();
    }

    // Prune locations (cache_render_metrics)
    const locationsStore = tx.objectStore('cache_render_metrics');
    const locationKeys = await locationsStore.getAllKeys();
    for (const key of locationKeys) {
      if (!bookIds.has(key.toString())) {
        await locationsStore.delete(key);
      }
    }

    // Prune TTS positions (user_progress)
    const progressStore = tx.objectStore('user_progress');
    const progressKeys = await progressStore.getAllKeys();
    for (const key of progressKeys) {
      if (!bookIds.has(key.toString())) {
        await progressStore.delete(key);
      }
    }

    // Prune lexicon
    const lexiconStore = tx.objectStore('user_overrides');
    let lexCursor = await lexiconStore.openCursor();
    while (lexCursor) {
      if (lexCursor.value.bookId !== 'global' && !bookIds.has(lexCursor.value.bookId)) {
        await lexCursor.delete();
      }
      lexCursor = await lexCursor.continue();
    }

    // Prune TTS Prep
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

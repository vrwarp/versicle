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
  }> {
    const db = await getDB();
    const books = await db.getAllKeys('books');
    const bookIds = new Set(books.map((k) => k.toString()));

    // Check files
    const fileKeys = await db.getAllKeys('files');
    const orphanedFiles = fileKeys.filter((k) => !bookIds.has(k.toString()));

    // Check annotations
    const annotations = await db.getAll('annotations');
    const orphanedAnnotations = annotations.filter((a) => !bookIds.has(a.bookId));

    // Check locations
    const locationKeys = await db.getAllKeys('locations');
    const orphanedLocations = locationKeys.filter((k) => !bookIds.has(k.toString()));

    // Check lexicon
    const rules = await db.getAll('lexicon');
    // Lexicon rules can be global (bookId is null/undefined), so only check if bookId is present
    const orphanedLexicon = rules.filter(
      (r) => r.bookId && !bookIds.has(r.bookId)
    );

    return {
      files: orphanedFiles.length,
      annotations: orphanedAnnotations.length,
      locations: orphanedLocations.length,
      lexicon: orphanedLexicon.length,
    };
  }

  /**
   * Deletes all identified orphaned records.
   *
   * @returns A Promise that resolves when the pruning process is complete.
   */
  async pruneOrphans(): Promise<void> {
    const db = await getDB();
    const books = await db.getAllKeys('books');
    const bookIds = new Set(books.map((k) => k.toString()));

    const tx = db.transaction(
      ['files', 'annotations', 'locations', 'lexicon'],
      'readwrite'
    );

    // Prune files
    const filesStore = tx.objectStore('files');
    const fileKeys = await filesStore.getAllKeys();
    for (const key of fileKeys) {
      if (!bookIds.has(key.toString())) {
        await filesStore.delete(key);
      }
    }

    // Prune annotations
    const annotationsStore = tx.objectStore('annotations');
    let annCursor = await annotationsStore.openCursor();
    while (annCursor) {
      if (!bookIds.has(annCursor.value.bookId)) {
        await annCursor.delete();
      }
      annCursor = await annCursor.continue();
    }

    // Prune locations
    const locationsStore = tx.objectStore('locations');
    const locationKeys = await locationsStore.getAllKeys();
    for (const key of locationKeys) {
      if (!bookIds.has(key.toString())) {
        await locationsStore.delete(key);
      }
    }

    // Prune lexicon
    const lexiconStore = tx.objectStore('lexicon');
    let lexCursor = await lexiconStore.openCursor();
    while (lexCursor) {
      if (lexCursor.value.bookId && !bookIds.has(lexCursor.value.bookId)) {
        await lexCursor.delete();
      }
      lexCursor = await lexCursor.continue();
    }

    await tx.done;
  }
}

export const maintenanceService = new MaintenanceService();

import { crdtService } from '../lib/crdt/CRDTService';
import { Logger } from '../lib/logger';
import * as Y from 'yjs';
import type { Annotation } from '../types/db';
import { getDB } from '../db/db';

export class MigrationService {
  /**
   * Performs the Phase 2C "Selective Hydration" of low-risk data.
   * This should be called during app initialization if migration hasn't happened yet.
   */
  static async hydrateIfNeeded(): Promise<void> {
    try {
      await crdtService.waitForReady();

      const settings = crdtService.settings;
      if (settings.get('migration_phase_2d_complete')) {
        return;
      }

      Logger.info('MigrationService', 'Starting Phase 2D: Final Cutover Migration...');

      // 0. Hydrate Books Metadata (Required for foreign keys in Annotations/Reading List)
      await this.hydrateBooksMetadata();

      // 1. Hydrate Lexicon
      await this.hydrateLexicon();

      // 2. Hydrate Reading List
      await this.hydrateReadingList();

      // 3. Hydrate Annotations
      await this.hydrateAnnotations();

      // 4. Hydrate Reading History (Phase 2D)
      await this.hydrateHistory();

      // Mark 2D as complete
      crdtService.doc.transact(() => {
          settings.set('migration_phase_2d_complete', true);
          // Also set 2c for backward compat if we skipped it
          settings.set('migration_phase_2c_complete', true);
      });

      Logger.info('MigrationService', 'Phase 2D Complete.');

    } catch (error) {
      Logger.error('MigrationService', 'Migration failed', error);
    }
  }

  private static async hydrateBooksMetadata(): Promise<void> {
    // Note: DBService.getLibrary() returns books from Legacy DB if mode is 'legacy' or 'shadow'.
    // We assume we are in a state where we can read from Legacy.
    // If we are already in CRDT mode, this might return CRDT books, which is fine (idempotent-ish).
    // But to be safe, we should access IDB directly to ensure we get legacy data.
    const db = await getDB();
    const books = await db.getAll('books');

    if (books.length === 0) return;

    Logger.info('MigrationService', `Hydrating ${books.length} books metadata...`);

    crdtService.doc.transact(() => {
        for (const book of books) {
            // Check if already exists in CRDT
            if (!crdtService.books.has(book.id)) {
                const bookMap = new Y.Map();
                for (const [key, value] of Object.entries(book)) {
                    if (value !== undefined) {
                        bookMap.set(key, value);
                    }
                }
                crdtService.books.set(book.id, bookMap);
            }
        }
    });
  }

  private static async hydrateLexicon(): Promise<void> {
    // Use low-level getDB because DBService might be in CRDT mode and return empty/CRDT data.
    const db = await getDB();
    const rules = await db.getAll('lexicon');
    if (rules.length === 0) return;

    crdtService.doc.transact(() => {
        if (crdtService.lexicon.length === 0) {
            const sorted = [...rules].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
            crdtService.lexicon.push(sorted);
        }
    });
    Logger.info('MigrationService', `Hydrated ${rules.length} lexicon rules.`);
  }

  private static async hydrateReadingList(): Promise<void> {
      // Use low-level getDB
      const db = await getDB();
      const entries = await db.getAll('reading_list');
      if (entries.length === 0) return;

      crdtService.doc.transact(() => {
          for (const entry of entries) {
              if (!crdtService.readingList.has(entry.filename)) {
                crdtService.readingList.set(entry.filename, entry);
              }
          }
      });
      Logger.info('MigrationService', `Hydrated ${entries.length} reading list entries.`);
  }

  private static async hydrateAnnotations(): Promise<void> {
      const db = await getDB();
      const books = await db.getAll('books');
      let count = 0;
      const allAnnotations: Annotation[] = [];

      for (const book of books) {
          const anns = await db.getAllFromIndex('annotations', 'by_bookId', book.id);
          if (anns.length > 0) {
              allAnnotations.push(...anns);
              count += anns.length;
          }
      }

      if (count > 0) {
          crdtService.doc.transact(() => {
               // Check if we need to clear or append. Ideally we merge.
               // For now, if empty, we push.
               if (crdtService.annotations.length === 0) {
                   crdtService.annotations.push(allAnnotations);
               }
          });
      }

      Logger.info('MigrationService', `Hydrated ${count} annotations.`);
  }

  private static async hydrateHistory(): Promise<void> {
      const db = await getDB();
      const historyEntries = await db.getAll('reading_history');

      if (historyEntries.length === 0) return;

      Logger.info('MigrationService', `Hydrating history for ${historyEntries.length} books...`);

      crdtService.doc.transact(() => {
          for (const entry of historyEntries) {
              if (entry.readRanges && entry.readRanges.length > 0) {
                  // Check if history already exists for this book
                  let hist = crdtService.history.get(entry.bookId);
                  if (!hist) {
                      hist = new Y.Array<string>();
                      crdtService.history.set(entry.bookId, hist);
                      hist.push(entry.readRanges);
                  } else {
                      // If exists, we might want to merge, but simpler to skip or append unique?
                      // Assuming one-way migration, if it exists, we assume it's newer or already migrated.
                      // So we do nothing if it exists.
                  }
              }
          }
      });
  }
}

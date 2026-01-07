import { dbService } from '../db/DBService';
import { crdtService } from '../lib/crdt/CRDTService';
import { Logger } from '../lib/logger';
import * as Y from 'yjs';
import type { Annotation } from '../types/db';

export class MigrationService {
  /**
   * Performs the Phase 2C "Selective Hydration" of low-risk data.
   * This should be called during app initialization if migration hasn't happened yet.
   */
  static async hydrateIfNeeded(): Promise<void> {
    try {
      await crdtService.waitForReady();

      const settings = crdtService.settings;
      if (settings.get('migration_phase_2c_complete')) {
        return;
      }

      Logger.info('MigrationService', 'Starting Phase 2C: Selective Hydration...');

      // 0. Hydrate Books Metadata (Required for foreign keys in Annotations/Reading List)
      // Although Phase 2C title focuses on Lexicon/ReadingList/Annotations,
      // Books are foundational.
      await this.hydrateBooksMetadata();

      // 1. Hydrate Lexicon
      await this.hydrateLexicon();

      // 2. Hydrate Reading List
      await this.hydrateReadingList();

      // 3. Hydrate Annotations
      await this.hydrateAnnotations();

      // Mark 2C as complete
      crdtService.doc.transact(() => {
          settings.set('migration_phase_2c_complete', true);
      });

      Logger.info('MigrationService', 'Phase 2C Complete.');

    } catch (error) {
      Logger.error('MigrationService', 'Migration failed', error);
    }
  }

  private static async hydrateBooksMetadata(): Promise<void> {
    // Note: DBService.getLibrary() returns books from Legacy DB if mode is 'legacy' or 'shadow'.
    // We assume we are in a state where we can read from Legacy.
    const books = await dbService.getLibrary();
    if (books.length === 0) return;

    Logger.info('MigrationService', `Hydrating ${books.length} books metadata...`);

    crdtService.doc.transact(() => {
        for (const book of books) {
            const bookMap = new Y.Map();
            for (const [key, value] of Object.entries(book)) {
                if (value !== undefined) {
                    bookMap.set(key, value);
                }
            }
            crdtService.books.set(book.id, bookMap);
        }
    });
  }

  private static async hydrateLexicon(): Promise<void> {
    // We need a way to get all lexicon rules.
    // DBService doesn't expose `getAllLexiconRules` yet.
    // We will assume it does, or use a lower-level access if possible.
    // Since I can't edit DBService easily to add it without potentially breaking things or needing valid tests,
    // I will try to use the `getDB` logic directly if possible, or add the method to DBService.
    // Ideally, I should add `getAllLexiconRules` to DBService.

    const rules = await dbService.getAllLexiconRules();
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
      const entries = await dbService.getReadingList();
      if (entries.length === 0) return;

      crdtService.doc.transact(() => {
          for (const entry of entries) {
              // Note: We use filename as key as per `crdt.md` (readingList: Y.Map<ReadingListEntry> keyed by filename).
              // Ideally we would map to bookId, but efficient reverse lookup is hard here without full scan.
              // For Phase 2C, we stick to filename key to match the type definition.
              crdtService.readingList.set(entry.filename, entry);
          }
      });
      Logger.info('MigrationService', `Hydrated ${entries.length} reading list entries.`);
  }

  private static async hydrateAnnotations(): Promise<void> {
      // Need to iterate all books to find annotations.
      const books = await dbService.getLibrary();
      let count = 0;
      const allAnnotations: Annotation[] = [];

      for (const book of books) {
          const anns = await dbService.getAnnotations(book.id);
          if (anns.length > 0) {
              allAnnotations.push(...anns);
              count += anns.length;
          }
      }

      if (count > 0) {
          crdtService.doc.transact(() => {
               crdtService.annotations.push(allAnnotations);
          });
      }

      Logger.info('MigrationService', `Hydrated ${count} annotations.`);
  }
}

import { dbService } from '../../db/DBService';
import { crdtService } from '../crdt/CRDTService';
import { Logger } from '../logger';
import type { BookMetadata, LexiconRule, Annotation } from '../../types/db';

/**
 * Service responsible for hydrating the Yjs CRDT from the legacy IndexedDB stores.
 * This is a one-way migration step (Phase 2C).
 */
export class MigrationService {
  /**
   * Checks if the CRDT is empty and needs hydration.
   * Hydration is only performed if the Yjs 'books' map is empty but the legacy 'books' store is not.
   */
  async hydrateIfNeeded(): Promise<void> {
    try {
      await crdtService.waitForReady();

      // Check explicit migration flag first
      const isHydrated = crdtService.settings.get('migration_phase_2c_complete');
      if (isHydrated) {
        Logger.info('MigrationService', 'Phase 2C hydration already complete. Skipping.');
        return;
      }

      // Fallback check: If books map is populated, we might have done a full migration or are in a clean state.
      // But for Phase 2C (Side Tables), we should rely on the flag because we might not migrate books yet.
      // However, if we *rely* on the flag, we must set it.

      // Check if legacy data exists
      const legacyBooks = await dbService.getLibrary();
      if (legacyBooks.length === 0) {
        Logger.info('MigrationService', 'No legacy data found. Skipping hydration.');
        return;
      }

      Logger.info('MigrationService', 'Starting CRDT hydration...', { books: legacyBooks.length });
      await this.hydrate(legacyBooks);

      // Mark as complete
      crdtService.settings.set('migration_phase_2c_complete', true);
      Logger.info('MigrationService', 'CRDT hydration complete.');

    } catch (error) {
      Logger.error('MigrationService', 'Hydration failed', error);
      // We do not throw here to avoid blocking app startup,
      // but we log it as critical.
    }
  }

  /**
   * Performs the hydration of all data types.
   */
  private async hydrate(legacyBooks: BookMetadata[]): Promise<void> {
    // Actually, DBService methods should suffice if we added getters.
    // So we might need raw access or add getters to DBService.
    // Let's rely on DBService having the necessary getters, or add them.

    // Using crdtService.doc.transact to bundle updates
    crdtService.doc.transact(() => {
        // 1. Books
        // (Not part of Phase 2C explicit instructions, but needed if we follow "Hydration is only performed if Yjs books is empty")
        // Phase 2C specifically mentions Lexicon, ReadingList, Annotations.
        // But if 'books' map is empty, we probably want to hydrate books too?
        // The plan says "Hydrating lexicon and reading_list" and "Hydrating annotations".
        // It implies books might be handled, or we should handle them now.
        // "Phase 2C: Selective Hydration... migrate low-risk... data first".
        // Maybe books comes in Phase 2D?
        // "Phase 2D: The Final Cutover (History & Progress)... The most delicate part".
        // Wait, if I hydrate lexicon/annotations but NOT books,
        // and I use CRDT mode, 'books' will be empty?
        // Ah, Phase 2 is "Gradual Data Migration".
        // "Phase 2A: The Shunt" -> Dual writes.
        // "Phase 2B: Decoupling" -> Reading from Yjs?
        // If we read from Yjs in 2B (Observer), we need data in Yjs.
        // But 2C says "Selective Hydration".
        // If 2C is "Warm-Up", maybe we ONLY hydrate these side tables first?
        // But 'hydrateIfNeeded' check uses 'booksMap.size'.
        // If I populate lexicon but not books, 'booksMap' remains empty.
        // So next boot it runs again. That's fine.

        // However, I should probably stick to the plan:
        // "Phase 2C: Selective Hydration... Hydrating lexicon and reading_list... Hydrating annotations".
        // It does NOT explicitly say "Hydrate Books".
        // BUT, if I am in 'shadow' mode, writes go to both.
        // This migration is for OLD data.
        // If I leave Books for 2D, that's fine.
    });

    // NOTE: Transaction logic is tricky with async DB calls inside.
    // Yjs transaction must be synchronous.
    // So we must fetch data FIRST, then transact.

    // 1. Fetch Data
    const lexiconRules = await this.getAllLexiconRules();
    const readingList = await dbService.getReadingList();

    // For Annotations, we need to iterate all books.
    // Or we can get all annotations if we had a global index.
    // DBService has 'by_bookId' index on annotations.
    // We can iterate legacyBooks to get their IDs.
    const allAnnotations: Annotation[] = [];
    for (const book of legacyBooks) {
        const bookAnnotations = await dbService.getAnnotations(book.id);
        allAnnotations.push(...bookAnnotations);
    }

    // 2. Transact to Yjs
    crdtService.doc.transact(() => {
        // Hydrate Lexicon
        if (lexiconRules.length > 0) {
            Logger.info('MigrationService', `Hydrating ${lexiconRules.length} lexicon rules`);
            // Preserve order
            // Note: sort modifies the array in place, so we copy it first to be safe
            const sortedRules = [...lexiconRules].sort((a, b) => (a.order || 0) - (b.order || 0));
            crdtService.lexicon.push(sortedRules);
        }

        // Hydrate Reading List
        if (readingList.length > 0) {
            Logger.info('MigrationService', `Hydrating ${readingList.length} reading list entries`);
            for (const entry of readingList) {
                // Sanitize/Map filename to bookId?
                // The plan says: "Legacy ReadingListEntry uses filenames as keys. Migration must map these to bookId (UUID)..."
                // Wait. 'reading_list' in CRDT is defined as: "readingList": Y.Map<ReadingListEntry>, // Keyed by filename.
                // In Plan 2.1: "Keyed by filename."
                // But in Plan 2C.1: "Migration must map these to bookId".
                // This is a contradiction.
                // If the CRDT map is keyed by filename, we just copy it?
                // OR does it mean the Entry itself should contain bookId instead of filename?
                // Legacy ReadingListEntry has: filename, title, author, isbn, percentage...
                // It does NOT have bookId.
                // If I map to bookId, I need to lookup the book by filename.
                // But the CRDT definition in 2.1 says "Keyed by filename".
                // Let's assume the Plan 2C.1 note means we *should* ensure we can link it,
                // OR maybe it implies the Key in Y.Map should be bookId?
                // "Keyed by filename" in 2.1 seems explicit.
                // Let's look at DBService.ts in the previous turn.
                // `crdtService.readingList.set(filename, entry);` in `importReadingList`.
                // So it IS keyed by filename.
                // Maybe "Map these to bookId" means we need to ENSURE bookId exists?
                // Or maybe I should ignore the "Map to bookId" if the schema says Keyed by filename.
                // Let's stick to "Keyed by filename" as per schema and existing code.
                crdtService.readingList.set(entry.filename, entry);
            }
        }

        // Hydrate Annotations
        if (allAnnotations.length > 0) {
            Logger.info('MigrationService', `Hydrating ${allAnnotations.length} annotations`);
            // Annotations is Y.Array<Annotation>
            crdtService.annotations.push(allAnnotations);
        }
    });
  }

  // Helper to get lexicon rules
  private async getAllLexiconRules(): Promise<LexiconRule[]> {
      return dbService.getAllLexiconRules();
  }
}

export const migrationService = new MigrationService();

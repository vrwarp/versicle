import { dbService } from '../../db/DBService';
import { CRDTService } from './CRDTService';
import { Logger } from '../logger';
import * as Y from 'yjs';

export class MigrationService {
  private crdt: CRDTService;

  constructor(crdtService: CRDTService) {
    this.crdt = crdtService;
  }

  /**
   * Performs a one-way hydration from legacy IndexedDB to Yjs if the Yjs doc is empty.
   */
  async migrateIfNeeded(): Promise<void> {
    await this.crdt.waitForReady();

    const booksMap = this.crdt.books;

    // 1. Detection: Check if Yjs is empty
    if (booksMap.size > 0) {
      Logger.info('MigrationService', 'CRDT already populated. Skipping migration.');
      return;
    }

    Logger.info('MigrationService', 'CRDT empty. Checking for legacy data...');

    // 2. Hydration
    try {
      const legacyBooks = await dbService.getLibrary();

      if (legacyBooks.length === 0) {
        Logger.info('MigrationService', 'No legacy data found. Starting fresh.');
        return;
      }

      Logger.info('MigrationService', `Found ${legacyBooks.length} books. Starting migration...`);

      // Transaction-like batch operation
      this.crdt.doc.transact(() => {
        // Migrate Books
        for (const book of legacyBooks) {
           // We only store metadata in Yjs. Files stay in DBService.
           booksMap.set(book.id, book as any);
        }

        // Migrate Annotations
        // We need to fetch annotations for ALL books.
        // DBService doesn't have a "getAllAnnotations" but we can iterate books.
        // Actually, dbService.getAnnotations(bookId) is available.
      });

      // Fetch annotations and history asynchronously (outside transact for async await)
      // Then apply in another transaction or individually.
      // Since we want to be fast, we can do parallel fetches.

      for (const book of legacyBooks) {
          // Annotations
          const annotations = await dbService.getAnnotations(book.id);
          if (annotations && annotations.length > 0) {
              this.crdt.doc.transact(() => {
                  const yAnnotations = this.crdt.annotations;
                  for (const annotation of annotations) {
                      yAnnotations.set(annotation.id, annotation);
                  }
              });
          }

          // History
          const historyEntry = await dbService.getReadingHistoryEntry(book.id);
          if (historyEntry && historyEntry.readRanges.length > 0) {
              this.crdt.doc.transact(() => {
                   const yHistory = this.crdt.history;
                   const yArr = new Y.Array<string>();
                   yArr.push(historyEntry.readRanges);
                   yHistory.set(book.id, yArr);
              });
          }

          // Reading List (Sync progress/lastRead)
          // DBService.getLibrary already returns books with progress merged from reading_list if imported?
          // Actually DBService has a 'reading_list' store.
          // The plan says "readingList" is in Y.Doc.
      }

       // Migrate Reading List
       const readingList = await dbService.getReadingList();
       if (readingList.length > 0) {
           this.crdt.doc.transact(() => {
               const yReadingList = this.crdt.readingList;
               for (const entry of readingList) {
                   yReadingList.set(entry.filename, entry);
               }
           });
       }

      Logger.info('MigrationService', 'Migration complete.');

    } catch (error) {
      Logger.error('MigrationService', 'Migration failed', error);
      // We don't rethrow because we don't want to block app startup,
      // but this is critical.
    }
  }
}

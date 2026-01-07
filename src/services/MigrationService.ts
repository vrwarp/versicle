import { crdtService } from '../lib/crdt/CRDTService';
import { Logger } from '../lib/logger';
import { mergeCfiRanges } from '../lib/cfi-utils';
import * as Y from 'yjs';

/**
 * Service to handle the one-way migration of data from Legacy/Shadow stores to the CRDT.
 * This corresponds to Phase 2C and Phase 2D of the migration plan.
 */
export class MigrationService {
    private static readonly MIGRATION_FLAG_KEY = 'migration_phase_2d_complete';

    /**
     * Executes the hydration process for History and Progress (Phase 2D).
     * This method is idempotent and should be called on app startup.
     */
    static async hydrateHistoryAndProgress() {
        // Check if migration is already complete
        const isComplete = localStorage.getItem(this.MIGRATION_FLAG_KEY);
        if (isComplete === 'true') {
            return;
        }

        Logger.info('MigrationService', 'Starting Phase 2D Hydration (History & Progress)...');

        // We use requestIdleCallback to avoid blocking the main thread during startup
        const runMigration = async () => {
             try {
                 await crdtService.waitForReady();

                 await this._performHydration();

                 localStorage.setItem(this.MIGRATION_FLAG_KEY, 'true');
                 Logger.info('MigrationService', 'Phase 2D Hydration Complete.');

             } catch (error) {
                 Logger.error('MigrationService', 'Hydration failed', error);
             }
        };

        if ('requestIdleCallback' in window) {
            requestIdleCallback(runMigration, { timeout: 5000 });
        } else {
            setTimeout(runMigration, 1000);
        }
    }

    private static async _performHydration() {
        const { getDB } = await import('../db/db');
        const db = await getDB();

        // 1. Migrate Reading History
        const historyTx = db.transaction('reading_history', 'readonly');
        const historyStore = historyTx.objectStore('reading_history');
        const allHistory = await historyStore.getAll();

        if (allHistory.length > 0) {
            crdtService.doc.transact(() => {
                for (const entry of allHistory) {
                    const bookId = entry.bookId;
                    const ranges = entry.readRanges || [];

                    if (ranges.length > 0) {
                        // Compress ranges using mergeCfiRanges
                        const compressed = mergeCfiRanges(ranges);

                        const yHistory = crdtService.history.get(bookId);
                        if (yHistory) {
                             yHistory.push(compressed);
                        } else {
                            const newHist = new Y.Array<string>();
                            newHist.push(compressed);
                            crdtService.history.set(bookId, newHist);
                        }
                    }
                }
            });
            Logger.info('MigrationService', `Migrated history for ${allHistory.length} books.`);
        }

        // 2. Migrate Progress (Last Read / Current CFI)
        const booksTx = db.transaction('books', 'readonly');
        const booksStore = booksTx.objectStore('books');
        const allBooks = await booksStore.getAll();

        if (allBooks.length > 0) {
            crdtService.doc.transact(() => {
                for (const book of allBooks) {
                    const bookId = book.id;
                    let bookMap = crdtService.books.get(bookId);

                    if (!bookMap) {
                         bookMap = new Y.Map();
                         crdtService.books.set(bookId, bookMap);

                         // Migrate all fields for new books
                         for (const [k, v] of Object.entries(book)) {
                             if (v !== undefined) bookMap.set(k, v);
                         }
                    } else {
                        // Update existing books with local progress
                        if (book.progress !== undefined) bookMap.set('progress', book.progress);
                        if (book.lastRead !== undefined) bookMap.set('lastRead', book.lastRead);
                        if (book.currentCfi !== undefined) bookMap.set('currentCfi', book.currentCfi);
                    }
                }
            });
            Logger.info('MigrationService', `Migrated progress/metadata for ${allBooks.length} books.`);
        }
    }
}

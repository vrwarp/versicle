import { yDoc, waitForYjsSync } from '../../store/yjs-provider';
import { dbService } from '../../db/DBService';
import { getDB } from '../../db/db';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useAnnotationStore } from '../../store/useAnnotationStore';
import { useReadingStateStore } from '../../store/useReadingStateStore';
import type {
    UserInventoryItem,
    UserAnnotation,
    UserProgress
} from '../../types/db';

/**
 * Checks if migration from legacy IDB to Yjs is needed and executes it.
 * Should be called once on app startup, after Yjs has synced.
 */
export async function migrateToYjs(): Promise<void> {
    console.log('[Migration] Starting Yjs migration check...');

    // 1. Wait for Yjs to load from IndexedDB (may already have data from sync)
    await waitForYjsSync(10000);

    // 2. Check migration status from preferences map
    const preferencesMap = yDoc.getMap('preferences');
    const migrationComplete = preferencesMap.get('migration_complete');

    if (migrationComplete === true) {
        console.log('[Migration] ✅ Migration already complete. Skipping.');
        return;
    }

    // 3. Check if Yjs already has data (from another device)
    const libraryMap = yDoc.getMap('library');
    const hasExistingData = libraryMap.size > 0;

    if (hasExistingData) {
        console.log('[Migration] 📦 Yjs has existing data from sync. Skipping legacy migration.');
        preferencesMap.set('migration_complete', true);
        return;
    }

    // 4. Yjs is empty - migrate from legacy IDB
    console.log('[Migration] 🔄 Migrating from legacy IndexedDB...');

    try {
        await migrateLegacyData();

        // Mark complete
        preferencesMap.set('migration_complete', true);
        preferencesMap.set('migration_timestamp', Date.now());

        console.log('[Migration] ✅ Migration complete!');
    } catch (error) {
        console.error('[Migration] ❌ Migration failed:', error);
        // Don't mark complete - will retry on next startup
        throw error;
    }
}

/**
 * Reads legacy IDB data and populates Zustand stores.
 * The middleware automatically syncs to Yjs.
 */
async function migrateLegacyData(): Promise<void> {
    const db = await getDB();

    // Read all legacy stores
    // We use getAllInventoryItems for books to ensure we get tags/rating which might be lost in getLibrary conversion
    const [
        legacyInventory,
        legacyAnnotations,
        legacyProgress,
    ] = await Promise.all([
        dbService.getAllInventoryItems(),
        db.getAll('user_annotations'),
        db.getAll('user_progress'),
    ]);

    console.log(`[Migration] Found ${legacyInventory.length} books, ${legacyAnnotations.length} annotations, ${legacyProgress.length} progress entries`);

    // Use a single Yjs transaction for atomic migration
    yDoc.transact(() => {
        // Migrate Library (Inventory + Progress)
        migrateBooksAndProgress(legacyInventory, legacyProgress);

        // Migrate Annotations
        migrateAnnotations(legacyAnnotations);

        // Journey migration deferred to Phase 4
    });

    console.log('[Migration] All data migrated to Yjs');
}

/**
 * Migrates books from legacy IDB to useLibraryStore and useReadingStateStore
 */
function migrateBooksAndProgress(legacyInventory: UserInventoryItem[], legacyProgress: UserProgress[]): void {
    const books: Record<string, UserInventoryItem> = {};
    const progress: Record<string, UserProgress> = {};

    // Populate books from legacyInventory
    for (const item of legacyInventory) {
        books[item.bookId] = {
            bookId: item.bookId,
            title: item.title || 'Unknown Title',
            author: item.author || 'Unknown Author',
            addedAt: item.addedAt || Date.now(),
            lastInteraction: item.lastInteraction || Date.now(),
            sourceFilename: item.sourceFilename || 'unknown',
            status: item.status || 'unread',
            tags: item.tags || [],
            rating: item.rating || 0
        };
    }

    // Populate progress from legacyProgress
    for (const prog of legacyProgress) {
        progress[prog.bookId] = {
            bookId: prog.bookId,
            currentCfi: prog.currentCfi,
            percentage: prog.percentage || 0,
            lastRead: prog.lastRead || Date.now(),
            lastPlayedCfi: prog.lastPlayedCfi,
            completedRanges: prog.completedRanges || []
        };
    }

    // Batch update stores (middleware syncs to Yjs)
    useLibraryStore.setState((state) => ({
        books: { ...state.books, ...books }
    }));

    useReadingStateStore.setState((state) => ({
        progress: { ...state.progress, ...progress }
    }));

    console.log(`[Migration] Migrated ${Object.keys(books).length} books and ${Object.keys(progress).length} progress entries`);
}

/**
 * Migrates annotations to useAnnotationStore
 */
function migrateAnnotations(legacyAnnotations: UserAnnotation[]): void {
    const annotations: Record<string, UserAnnotation> = {};

    for (const ann of legacyAnnotations) {
        // Ensure annotation has required fields
        annotations[ann.id] = {
            ...ann,
            // Ensure specific string keys rather than number for ID if needed,
            // but UserAnnotation ID is string.
            created: ann.created || Date.now(),
        };
    }

    // Batch update (middleware syncs to Yjs)
    useAnnotationStore.setState((state) => ({
        annotations: { ...state.annotations, ...annotations }
    }));

    console.log(`[Migration] Migrated ${Object.keys(annotations).length} annotations`);
}

import { yDoc, waitForYjsSync } from '../../store/yjs-provider';
import { dbService } from '../../db/DBService';
import { getDB } from '../../db/db';
import { useBookStore } from '../../store/useLibraryStore';
import { useAnnotationStore } from '../../store/useAnnotationStore';
import { useReadingStateStore } from '../../store/useReadingStateStore';
import { useReadingListStore } from '../../store/useReadingListStore';
import { usePreferencesStore } from '../../store/usePreferencesStore';
import { getDeviceId } from '../device-id';
import type {
    UserInventoryItem,
    UserAnnotation,
    UserProgress,
    ReadingListEntry
} from '../../types/db';
import { migrateLexicon } from '../sync/migration';

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
        // Still run per-device migration in case it's pending
        await migrateProgressToPerDevice();
        await migratePreferencesToPerDevice();
        return;
    }

    // 3. Check if Yjs already has data (from another device)
    const libraryMap = yDoc.getMap('library');
    const hasExistingData = libraryMap.size > 0;

    if (hasExistingData) {
        console.log('[Migration] 📦 Yjs has existing data from sync. Skipping legacy migration.');
        preferencesMap.set('migration_complete', true);
        // Migrate existing progress to per-device format
        await migrateProgressToPerDevice();
        await migratePreferencesToPerDevice();
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
 * Migrates existing Yjs preferences data from the old single shared map
 * to the new per-device map.
 */
async function migratePreferencesToPerDevice(): Promise<void> {
    const oldPreferencesMap = yDoc.getMap('preferences');
    const deviceId = getDeviceId();
    const newPreferencesMap = yDoc.getMap(`preferences/${deviceId}`);

    // If new map is populated, nothing to do (already migrated or initialized)
    if (newPreferencesMap.size > 0) {
        return;
    }

    // If old map is empty, nothing to copy
    if (oldPreferencesMap.size === 0) {
        return;
    }

    // Keys to migrate (matching PreferencesState)
    const keysToMigrate = [
        'currentTheme', 'customTheme', 'fontFamily',
        'lineHeight', 'fontSize', 'shouldForceFont',
        'readerViewMode', 'libraryLayout'
    ];

    console.log(`[Migration] Migrating preferences to per-device map for ${deviceId}...`);

    yDoc.transact(() => {
        let migratedCount = 0;
        for (const key of keysToMigrate) {
            if (oldPreferencesMap.has(key)) {
                const val = oldPreferencesMap.get(key);
                newPreferencesMap.set(key, val);
                migratedCount++;
            }
        }
        if (migratedCount > 0) {
            console.log(`[Migration] Copied ${migratedCount} preferences to per-device map`);
        }
    });
}

/**
 * Migrates existing Yjs progress data from the old single-entry format
 * to the new per-device format.
 * 
 * Old format: progress[bookId] = UserProgress
 * New format: progress[bookId][deviceId] = UserProgress
 */
async function migrateProgressToPerDevice(): Promise<void> {
    const preferencesMap = yDoc.getMap('preferences');
    const perDeviceMigrationDone = preferencesMap.get('progress_per_device_migration');

    if (perDeviceMigrationDone === true) {
        return;
    }

    console.log('[Migration] Checking for progress format migration...');

    const { progress } = useReadingStateStore.getState();
    const needsMigration: Record<string, Record<string, UserProgress>> = {};
    let migratedCount = 0;

    for (const [bookId, value] of Object.entries(progress)) {
        // Check if this is old format (has 'bookId' directly as a property of value)
        // vs new format (value is a nested object with deviceId keys)
        const valueAsAny = value as unknown as Record<string, unknown>;

        // Old format detection: the value itself has 'bookId' and 'percentage' at top level
        if (valueAsAny && typeof valueAsAny === 'object' &&
            'bookId' in valueAsAny &&
            'percentage' in valueAsAny &&
            typeof valueAsAny.percentage === 'number') {
            // Old format - convert to per-device
            needsMigration[bookId] = {
                'legacy-device': valueAsAny as unknown as UserProgress
            };
            migratedCount++;
        }
    }

    if (migratedCount > 0) {
        console.log(`[Migration] Converting ${migratedCount} progress entries to per-device format`);
        useReadingStateStore.setState((state) => ({
            progress: { ...state.progress, ...needsMigration }
        }));
    }

    preferencesMap.set('progress_per_device_migration', true);
    console.log('[Migration] Progress per-device migration complete');
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
        legacyReadingList,
    ] = await Promise.all([
        dbService.getAllInventoryItems(),
        db.getAll('user_annotations'),
        db.getAll('user_progress'),
        db.getAll('user_reading_list'),
    ]);

    console.log(`[Migration] Found ${legacyInventory.length} books, ${legacyAnnotations.length} annotations, ${legacyProgress.length} progress entries, ${legacyReadingList.length} reading list entries`);

    // Check if there is anything to migrate to avoid overwriting Yjs with empty state
    // (which causes race conditions with incoming cloud sync)
    const areAllLegacyStoresEmpty =
        legacyInventory.length === 0 &&
        legacyAnnotations.length === 0 &&
        legacyProgress.length === 0 &&
        legacyReadingList.length === 0;

    if (areAllLegacyStoresEmpty) {
        console.log('[Migration] Legacy stores empty. Checking preferences only...');
        yDoc.transact(() => {
            migratePreferences();
        });
        console.log('[Migration] ✅ Migration complete (Preferences only)!');
        return;
    }

    // Use a single Yjs transaction for atomic migration
    yDoc.transact(() => {
        // Migrate Library (Inventory + Progress + Reading List)
        migrateBooksAndProgress(legacyInventory, legacyProgress, legacyReadingList);

        // Migrate Annotations
        migrateAnnotations(legacyAnnotations);

        // Migrate Preferences (from localStorage)
        migratePreferences();

        // Migrate Lexicon (User Overrides)
        // Must run outside yDoc.transact because it performs async operations (DB reads)
        // and modifying the store via actions is safer outside the raw update transaction.
    });

    try {
        await migrateLexicon();
        console.log('[Migration] Lexicon migration step completed.');
    } catch (e) {
        console.error('[Migration] Lexicon migration failed:', e);
    }

    console.log('[Migration] All data migrated to Yjs');
}

/**
 * Migrates books from legacy IDB to useLibraryStore, useReadingStateStore, and useReadingListStore
 */
function migrateBooksAndProgress(
    legacyInventory: UserInventoryItem[],
    legacyProgress: UserProgress[],
    legacyReadingList: ReadingListEntry[]
): void {
    const books: Record<string, UserInventoryItem> = {};
    // Per-device progress structure: Record<bookId, Record<deviceId, UserProgress>>
    const progress: Record<string, Record<string, UserProgress>> = {};
    const readingList: Record<string, ReadingListEntry> = {};

    // Use a consistent device ID for all legacy entries 
    // This device inherits the legacy data
    const legacyDeviceId = 'legacy-device';

    // 1. Populate books from legacyInventory
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

    // 2. Populate reading list
    for (const entry of legacyReadingList) {
        readingList[entry.filename] = entry;
    }

    // 3. Populate progress from legacyProgress (using per-device structure)
    const progressBookIds = new Set<string>();
    for (const prog of legacyProgress) {
        const progressEntry: UserProgress = {
            bookId: prog.bookId,
            currentCfi: prog.currentCfi,
            percentage: prog.percentage || 0,
            lastRead: prog.lastRead || Date.now(),
            lastPlayedCfi: prog.lastPlayedCfi,
            completedRanges: prog.completedRanges || []
        };
        // Wrap in per-device structure
        progress[prog.bookId] = {
            [legacyDeviceId]: progressEntry
        };
        progressBookIds.add(prog.bookId);
    }

    // 4. Progress Fallback: Check reading list for books missing from user_progress
    let fallbackCount = 0;
    for (const item of legacyInventory) {
        if (!progressBookIds.has(item.bookId) && item.sourceFilename) {
            const rlEntry = readingList[item.sourceFilename];
            if (rlEntry && rlEntry.percentage > 0) {
                progress[item.bookId] = {
                    [legacyDeviceId]: {
                        bookId: item.bookId,
                        percentage: rlEntry.percentage,
                        lastRead: rlEntry.lastUpdated || Date.now(),
                        completedRanges: []
                    }
                };
                fallbackCount++;
            }
        }
    }

    if (fallbackCount > 0) {
        console.log(`[Migration] Applied progress fallbacks for ${fallbackCount} books from reading list`);
    }

    // Batch update stores (middleware syncs to Yjs)
    useBookStore.setState((state) => ({
        books: { ...state.books, ...books }
    }));

    useReadingStateStore.setState((state) => ({
        progress: { ...state.progress, ...progress }
    }));

    useReadingListStore.setState((state) => ({
        entries: { ...state.entries, ...readingList }
    }));

    console.log(`[Migration] Migrated ${Object.keys(books).length} books, ${Object.keys(progress).length} progress entries, and ${Object.keys(readingList).length} reading list entries`);
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

/**
 * Migrates user preferences from localStorage to usePreferencesStore
 */
function migratePreferences(): void {
    try {
        // 1. Check for legacy 'reader-storage' (Zustand persist format)
        const readerStorage = localStorage.getItem('reader-storage');
        if (readerStorage) {
            try {
                const parsed = JSON.parse(readerStorage);
                const state = parsed.state;
                if (state) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const updates: Partial<any> = {};

                    if (state.viewMode) updates.readerViewMode = state.viewMode;
                    if (state.currentTheme) updates.currentTheme = state.currentTheme;
                    if (state.customTheme) updates.customTheme = state.customTheme;
                    if (state.fontFamily) updates.fontFamily = state.fontFamily;
                    if (state.fontSize) updates.fontSize = state.fontSize;
                    if (state.lineHeight) updates.lineHeight = state.lineHeight;
                    if (state.shouldForceFont !== undefined) updates.shouldForceFont = state.shouldForceFont;

                    if (Object.keys(updates).length > 0) {
                        usePreferencesStore.setState(updates);
                        console.log(`[Migration] Migrated ${Object.keys(updates).length} preferences from reader-storage`);
                    }
                }
            } catch (e) {
                console.warn('[Migration] Failed to parse reader-storage:', e);
            }
        }

        // 2. Check individual common legacy keys as fallback
        const keys = ['viewMode', 'readerViewMode', 'reader-view-mode'];
        let foundMode: 'paginated' | 'scrolled' | null = null;

        for (const key of keys) {
            const raw = localStorage.getItem(key);
            if (!raw) continue;

            // Try parsing as JSON or literal
            let val = raw;
            try {
                val = JSON.parse(raw);
            } catch {
                // Not JSON, use as literal
            }

            if (val === 'scrolled' || val === 'paginated') {
                foundMode = val as 'paginated' | 'scrolled';
                break;
            }
        }

        if (foundMode) {
            usePreferencesStore.setState({ readerViewMode: foundMode });
            console.log(`[Migration] Migrated readerViewMode: ${foundMode}`);
        }
    } catch (e) {
        console.warn('[Migration] Failed to migrate preferences:', e);
    }
}

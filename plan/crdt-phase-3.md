# Phase 3: The Great Migration & Cleanup

**Goal:** Migrate existing user data from Legacy IDB (`EpubLibraryDB`) to Yjs (`versicle-yjs`) and cleanup legacy stores.

## 1. Create Migration Service

**File:** `src/lib/migration/MigrationService.ts`

**Responsibilities:**
1.  Detect if migration is needed.
2.  Read legacy data.
3.  Transform to Yjs schema with validation.
4.  Write to Yjs with idempotency checks.
5.  Mark complete and verify.

**Detailed Logic:**

```typescript
import { yDoc, waitForYjsSync } from '../../store/yjs-provider';
import { dbService } from '../../db/DBService';
import { Logger } from '../logger';
import { 
    validateInventory, 
    validateProgress, 
    validateAnnotation, 
    validateReadingListEntry 
} from '../sync/validators'; // Planned in Phase 1

export const checkAndMigrate = async () => {
    // 0. Ensure Yjs is ready and hasn't already received this data from sync
    await waitForYjsSync();

    const settingsMap = yDoc.getMap('settings');
    if (settingsMap.get('migration_v19_yjs_complete')) {
        return; // Already done
    }

    // Check if map already has data (e.g., from another device's sync)
    const invMap = yDoc.getMap('inventory');
    const isFirstMigration = !settingsMap.get('migration_v19_yjs_started');
    
    if (invMap.size > 0 && isFirstMigration) {
        Logger.info('Migration', 'Yjs has existing data. Proceeding with MERGE strategy.');
    }

    if (settingsMap.get('migration_v19_yjs_complete')) {
         return; // Already done
    }

    Logger.info('Migration', '🚀 Starting Migration to Yjs...');
    settingsMap.set('migration_v19_yjs_started', true);

    try {
        // 1. Fetch Legacy Data
        const books = await dbService.getLibrary(); 
        const db = await dbService.getDB();
        const annotations = await db.getAll('user_annotations');
        const readingList = await db.getAll('user_reading_list');
        const journey = await db.getAll('user_journey');

        // 2. Transact with Y.Doc
        yDoc.transact(() => {
            const rlMap = yDoc.getMap('reading_list');
            const progMap = yDoc.getMap('progress');
            const annMap = yDoc.getMap('annotations');
            const journeyArray = yDoc.getArray('journey');

            // Migrate Reading List
            for (const entry of readingList) {
                if (validateReadingListEntry(entry)) {
                    rlMap.set(entry.filename, entry);
                }
            }

            // Migrate Books & Progress
            for (const book of books) {
                // Determine source filename for RL link
                const filename = book.filename || 'unknown_migration';

                const inventoryItem = {
                    bookId: book.id,
                    title: book.title,   // Snapshot for Ghost Books
                    author: book.author, // Snapshot for Ghost Books
                    addedAt: book.addedAt,
                    sourceFilename: filename,
                    status: book.progress > 0.98 ? 'completed' : (book.progress > 0 ? 'reading' : 'unread'),
                    tags: [], // Metadata might not have had tags in all versions
                    lastInteraction: book.lastRead || book.addedAt
                };

                const progressItem = {
                    bookId: book.id,
                    percentage: book.progress || 0,
                    currentCfi: book.currentCfi,
                    lastPlayedCfi: book.lastPlayedCfi,
                    lastRead: book.lastRead || 0,
                    completedRanges: [] // History handled below/separately
                };

                if (validateInventory(inventoryItem)) {
                    // MERGE STRATEGY:
                    // 1. If exists in Yjs, check 'lastInteraction'.
                    // 2. If Legacy is newer, overwrite.
                    // 3. If Yjs is newer, skip.
                    if (invMap.has(book.id)) {
                        const existing = invMap.get(book.id) as UserInventoryItem;
                        if (inventoryItem.lastInteraction > existing.lastInteraction) {
                             invMap.set(book.id, inventoryItem);
                        }
                    } else {
                        invMap.set(book.id, inventoryItem);
                    }
                }
                
                if (validateProgress(progressItem)) {
                     // MERGE STRATEGY: Max Progress / Last Read
                     if (progMap.has(book.id)) {
                         const existing = progMap.get(book.id) as UserProgress;
                         // If legacy has further progress OR is more recently read
                         if ((progressItem.percentage > existing.percentage) || 
                             (progressItem.lastRead > existing.lastRead)) {
                             progMap.set(book.id, progressItem);
                         }
                     } else {
                         progMap.set(book.id, progressItem);
                     }
                }
            }

            // Migrate Annotations
            for (const ann of annotations) {
                if (validateAnnotation(ann)) {
                    annMap.set(ann.id, ann);
                }
            }

            // Migrate Journey (Append-only, limited for perf)
            // Strategy: Migrate most recent 500 entries to Yjs, leave rest in Legacy/IDB
            const recentJourney = journey.slice(-500);
            for (const step of recentJourney) {
                journeyArray.push([step]);
            }

            // Mark Complete
            settingsMap.set('migration_v19_yjs_complete', true);
        });

        Logger.info('Migration', '✅ Migration Complete');
    } catch (e) {
        Logger.error('Migration', '❌ Migration Failed:', e);
        // We do NOT set complete, so it will retry next startup
    }
};
```

## 2. Application Entrypoint Integration

**File:** `src/main.tsx` (or top-level App component).

*   **Action:** Call `MigrationService.checkAndMigrate()` immediately after `ReactDOM.createRoot`.
*   **Blocking:** Show a `<LoadingSpinner text="Upgrading Database..." />` while the promise is pending.

## 3. Verification

**Manual Test Plan:**
1.  **Setup:** Use Legacy branch. Add 3 books, 5 highlights, 10 reading sessions.
2.  **Launch:** Open Migration branch.
3.  **Verify:**
    *   Books appear in Library?
    *   Reading progress preserved?
    *   Highlights appear?
    *   Check `user_journey` in Yjs DevTools (Verify it's limited or complete).
    *   Verify `migration_v19_yjs_complete: true` in `versicle-yjs` settings map.

## 4. Cleanup (Deferred)

**Phase 3.5:**
After 1-2 release cycles, we will remove the `user_*` stores from `src/db/db.ts` via an IDB version upgrade (v23+).

> [!WARNING]
> Do NOT delete legacy stores until the migration is proven stable in production.

**Action:**
*   In `src/db/db.ts` `upgrade` callback:
    *   `if (oldVersion < 23)`:
        *   `db.deleteObjectStore('user_inventory')`
        *   `db.deleteObjectStore('user_reading_list')`
        *   `db.deleteObjectStore('user_progress')`
        *   `db.deleteObjectStore('user_annotations')`
        *   `db.deleteObjectStore('user_overrides')`
        *   `db.deleteObjectStore('user_journey')`

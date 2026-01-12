# Phase 3: The Great Migration & Cleanup

**Goal:** Migrate existing user data from Legacy IDB (`EpubLibraryDB`) to Yjs (`versicle-yjs`) and cleanup legacy stores.

## 1. Create Migration Service

**File:** `src/lib/migration/MigrationService.ts`

**Responsibilities:**
1.  Detect if migration is needed.
2.  Read legacy data.
3.  Transform to Yjs schema.
4.  Write to Yjs.
5.  Mark complete.

**Detailed Logic:**

```typescript
import { yDoc, waitForYjsSync } from '../../store/yjs-provider';
import { dbService } from '../../db/DBService';

export const checkAndMigrate = async () => {
    await waitForYjsSync();

    const settingsMap = yDoc.getMap('settings');
    if (settingsMap.get('migration_v19_yjs_complete')) {
        return; // Already done
    }

    console.log('🚀 Starting Migration to Yjs...');

    // 1. Fetch Legacy Data
    const books = await dbService.getLibrary(); // Joins manifests + inventory + progress
    // Note: We need raw access to `user_annotations` since DBService.getAnnotations requires ID
    const db = await dbService.getDB();
    const annotations = await db.getAll('user_annotations');
    const readingList = await db.getAll('user_reading_list');

    // 2. Validate Data (Dry Run)
    const validationErrors = validateMigrationData(books, annotations, readingList);
    if (validationErrors.length > 0) {
        console.error('❌ Migration Aborted due to validation errors:', validationErrors);
        // Optionally upload error report
        return; 
    }

    // 3. Transact with Y.Doc (All or Nothing)
    try {
        yDoc.transact(() => {
            const invMap = yDoc.getMap('inventory');
            const rlMap = yDoc.getMap('reading_list');
            const progMap = yDoc.getMap('progress');
            const annMap = yDoc.getMap('annotations');

            // Migrate Reading List
            for (const entry of readingList) {
                rlMap.set(entry.filename, entry);
            }

            // Migrate Books & Progress
            for (const book of books) {
                // Inventory
                invMap.set(book.id, {
                    bookId: book.id,
                    addedAt: book.addedAt,
                    sourceFilename: book.filename,
                    status: book.progress > 0.98 ? 'completed' : 'reading', // simplified
                    title: book.title, // User custom title logic needs checking
                    author: book.author,
                    lastInteraction: book.lastRead || Date.now()
                });

                // Progress
                progMap.set(book.id, {
                    bookId: book.id,
                    percentage: book.progress || 0,
                    currentCfi: book.currentCfi,
                    lastRead: book.lastRead || 0,
                    // ... map other fields
                });
            }

            // Migrate Annotations
            for (const ann of annotations) {
                annMap.set(ann.id, ann);
            }

            // Mark Complete
            settingsMap.set('migration_v19_yjs_complete', true);
        });
        console.log('✅ Migration Complete');
    } catch (e) {
        console.error('❌ Migration Failed during transaction:', e);
        // Yjs transaction rollback is implicit if error thrown, but we must ensure we didn't set 'complete'
    }
};
```

## 2. Application Entrypoint Integration

**File:** `src/main.tsx` (or top-level App component).

*   **Action:** Call `MigrationService.checkAndMigrate()` immediately after `ReactDOM.createRoot`.
*   **Blocking:** Consider showing a `<LoadingSpinner text="Upgrading Database..." />` if the migration promise is pending.

## 3. Verification

**Manual Test Plan:**
1.  **Setup:** Load the app on the *current branch* (Legacy IDB). Add 3 books. Read one to 50%. Add 2 highlights.
2.  **Switch Branch:** Checkout the Yjs migration branch.
3.  **Launch:** Open the app.
4.  **Verify:**
    *   Books appear in Library? (Checks `inventory` migration).
    *   Reading progress preserved? (Checks `progress` migration).
    *   Highlights appear? (Checks `annotations` migration).
    *   DevTools > IndexedDB > `versicle-yjs` > Contains blobs?

## 4. Cleanup (Deferred)

**Phase 3.5:**
After 1-2 release cycles, we will remove the `user_*` stores from `src/db/db.ts` to reclaim space.

**Action:**
*   In `src/db/db.ts` `upgrade` callback:
    *   `if (oldVersion < 20)`:
        *   `db.deleteObjectStore('user_inventory')`
        *   `db.deleteObjectStore('user_reading_list')`
        *   `db.deleteObjectStore('user_progress')`
        *   `db.deleteObjectStore('user_annotations')`
        *   `db.deleteObjectStore('user_overrides')`
        *   `db.deleteObjectStore('user_journey')`

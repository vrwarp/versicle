# Phase 3: The Great Migration & Cleanup

**Goal:** Migrate existing user data from Legacy IDB (`EpubLibraryDB`) to Yjs (`versicle-yjs`), ensure data integrity, and cleanup legacy stores.

## 1. Create Migration Service

**File:** `src/lib/migration/MigrationService.ts`

**Responsibilities:**
1.  Detect if migration is needed.
2.  Read legacy data.
3.  **Validate** data against Zod schemas.
4.  Write to Yjs.
5.  Mark complete.

### Validation Logic (Zod)
We must ensure that we don't pollute the Yjs doc with corrupt legacy data.

```typescript
// src/lib/sync/validators.ts
import { z } from 'zod';

export const InventoryItemSchema = z.object({
  bookId: z.string(),
  title: z.string().default('Untitled'),
  // ...
});
```

### Detailed Migration Logic

```typescript
import { yDoc, waitForYjsSync } from '../../store/yjs-provider';
import { dbService } from '../../db/DBService';
import { InventoryItemSchema } from '../sync/validators';

export const checkAndMigrate = async () => {
    await waitForYjsSync();
    const settingsMap = yDoc.getMap('settings');
    if (settingsMap.get('migration_v19_yjs_complete')) return;

    console.log('🚀 Starting Migration to Yjs...');

    try {
        const books = await dbService.getLibrary();
        const db = await dbService.getDB();
        const annotations = await db.getAll('user_annotations');
        const readingList = await db.getAll('user_reading_list');

        yDoc.transact(() => {
             // ... loop and set ...
             // Validate each item
             const validBook = InventoryItemSchema.parse(book);
             invMap.set(book.id, validBook);
        });

        settingsMap.set('migration_v19_yjs_complete', true);
        console.log('✅ Migration Complete');

    } catch (e) {
        console.error('Migration Failed', e);
        // Do NOT set complete flag. Retry next time.
        // Ideally revert transaction if Yjs supports it, or manual rollback?
        // Y.transact is atomic for event emission but not necessarily "rollback-able" in the SQL sense
        // if an error is thrown midway, partial updates might apply.
        // BETTER STRATEGY: Prepare all updates in memory, validate ALL, then transact.
    }
};
```

## 2. Garbage Collection (Orphaned Blobs)

**Goal:** Clean up `static_resources` (IDB) that have no corresponding entry in `inventory` (Yjs).

**File:** `src/lib/cleanup/GarbageCollector.ts`

**Logic:**
1.  **Trigger:** App startup (after migration) or Background Task.
2.  **Steps:**
    *   `const yjsIds = new Set(yDoc.getMap('inventory').keys())`
    *   `const db = await dbService.getDB()`
    *   `const blobKeys = await db.getAllKeys('static_resources')`
    *   `const orphans = blobKeys.filter(k => !yjsIds.has(k))`
    *   If `orphans.length > 0`: `await Promise.all(orphans.map(k => dbService.deleteBook(k)))`
3.  **Safety:** Ensure sync is fully "synced" before running GC to avoid deleting books that just haven't arrived from the network yet.
    *   *Condition:* `persistence.synced` is true AND network is connected (or we assume "Local Inventory" is the master for deletions initiated on this device? No, deletes sync. So we must wait for sync).
    *   *Safe Mode:* Only run GC if `last_sync_timestamp` is recent.

## 3. Application Entrypoint Integration

**File:** `src/main.tsx`

*   Call `MigrationService.checkAndMigrate()`.
*   Call `GarbageCollector.run()` (delayed).

## 4. Cleanup (Deferred)

**Phase 3.5:**
After 1-2 release cycles, we will remove the `user_*` stores from `src/db/db.ts` to reclaim space.

# Phase 3: The Great Migration & Cleanup

**Goal:** Migrate existing user data from Legacy IDB to Yjs and clean up.

## 1. Migration Service
*   **File:** `src/lib/migration/MigrationService.ts`
*   **Logic:**
    1.  Check if Yjs `inventory` is empty.
    2.  If empty, check if Legacy IDB has books (`DBService.getLibrary()`).
    3.  **Execute Migration:**
        *   Iterate all books from Legacy IDB.
        *   Construct `InventoryItem` / `BookMetadata` for Yjs.
        *   Insert into `useLibraryStore` (or direct Y.Doc write).
        *   Fetch all annotations -> Insert into `useAnnotationStore`.
        *   Fetch all reading progress -> Insert into `useReaderSyncStore` (or `inventory` if progress is per-book).
    4.  **Mark Complete:** Set a flag `migration_v2_complete` in `app_metadata` (Yjs).

## 2. Startup Integration
*   **File:** `src/main.tsx` or `src/App.tsx`.
*   **Action:** Run `MigrationService.checkAndMigrate()` on app launch.
*   **UI:** Show a "Migrating Database..." spinner if migration is running (could take a few seconds for large libraries).

## 3. Verification
*   **Tests:** Add a test case that populates Legacy IDB, runs the migration, and asserts data exists in Yjs stores.
*   **Manual:** Verify Library, Progress, and Annotations persist after migration.

## 4. Cleanup (Optional/Deferred)
*   Once confident, add a step to delete `user_inventory`, `user_progress`, `user_annotations` object stores from `versicle-db` to reclaim space and avoid confusion.

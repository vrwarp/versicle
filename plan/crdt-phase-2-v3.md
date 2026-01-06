# Phase 2: CRDT Migration & Store Integration (v3)

**Goal:** Transition the application's "source of truth" for metadata from Legacy IndexedDB to the Yjs CRDT (`versicle-moral-doc`), while maintaining the legacy DB for binary assets ("Heavy Layer") and as a temporary backup.

## 1. Migration Strategy (The "Bridge")

We implemented a **One-Way Hydration** strategy in `MigrationService.ts`.

1.  **Detection:** On app startup, `useLibraryStore.init()` calls `MigrationService.migrateIfNeeded()`.
2.  **Check:** It verifies if the Yjs `books` map is empty.
    *   If **NOT empty**: Migration is skipped (CRDT is already active).
    *   If **empty**: It proceeds to check the Legacy DB.
3.  **Hydration:**
    *   Reads all books from `dbService.getLibrary()`.
    *   Reads annotations, reading history, and reading list.
    *   Writes all metadata into the `Y.Doc` (inside a `transact` block for atomicity where possible).
4.  **Result:** The Yjs document is now populated with the user's existing data. `y-indexeddb` persists this to `versicle-moral-doc` in IndexedDB.

## 2. Store Refactoring (The "Reactive Bridge")

We refactored `useLibraryStore` and `useAnnotationStore` to observe the CRDT.

### `useLibraryStore`
*   **Initialization:** Added `init()` action. It triggers migration and then subscribes to `crdtService.books.observe()`.
*   **State Update:** When Yjs updates (local or remote), the observer updates the local Zustand `books` array state.
*   **Writes (Dual-Write Strategy):**
    *   **Add Book:**
        1.  Calls `dbService.addBook` (Legacy) to handle file parsing and binary storage (Heavy Layer).
        2.  Writes the resulting metadata to `crdtService.books` (Moral Layer).
    *   **Remove Book:**
        1.  Removes from `crdtService.books`.
        2.  Calls `dbService.deleteBook` to clean up binaries.
    *   **Offload/Restore:** Updates both layers to ensure consistency.

### `useAnnotationStore`
*   **Initialization:** `init()` ensures `CRDTService` is ready.
*   **Reads:** `loadAnnotations(bookId)` filters annotations from `crdtService.annotations` (Y.Array).
*   **Writes:** `addAnnotation`, `updateAnnotation`, `deleteAnnotation` perform dual-writes to both Legacy DB and Yjs CRDT.

## 3. Deviations & Discoveries

*   **Memory Leak Prevention:** We discovered that simply adding `.observe()` in `useEffect` or `init` causes duplicate subscriptions on component remounts. We added an `initialized` flag to `useLibraryStore` to ensure the observer is attached exactly once.
*   **Type Safety:** We had to use some type casting (`as unknown as ...`) when bridging `DBService` return types and Yjs structures. This is technical debt to be addressed when `DBService` is fully refactored or deprecated for metadata.
*   **Store Initialization:** `useAnnotationStore` relies on explicit `loadAnnotations` calls rather than a global observer for now, to avoid complexity with filtering by `bookId` without a global "current book" context in the store itself.

## 4. Status

*   [x] `MigrationService` implemented and tested.
*   [x] `useLibraryStore` refactored to use CRDT.
*   [x] `useAnnotationStore` refactored to use CRDT.
*   [x] Unit tests passed.
*   [x] Build passed.

## 5. Next Steps (Phase 3 & 4)

*   **Phase 3 (Reader Integration):** Deeper integration with `useReaderStore` for real-time history syncing.
*   **Phase 4 (Cloud Sync):** Implement the "Transport Layer" to sync the Yjs binary updates via Google Drive, replacing the current JSON manifest sync.

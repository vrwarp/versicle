# Phase 2: Store Refactoring & Migration

**Goal:** Split stores into Transient/Sync, bind them to Yjs, and refactor DBService to stop writing user data.

## 1. Refactor `useReaderStore` (The Split)

**File:** `src/store/useReaderStore.ts`

**Action:** Break the existing monolithic store into two.

### A. `useReaderUIStore` (Transient)
*   **Persistence:** `localStorage` (via standard `persist` middleware) or purely memory.
*   **State Properties:**
    *   `isLoading`: boolean
    *   `currentBookId`: string | null
    *   `toc`: NavigationItem[] (Static, heavy)
    *   `viewMode`: 'paginated' | 'scrolled'
    *   `immersiveMode`: boolean
    *   `shouldForceFont`: boolean
    *   `currentSectionTitle`: string | null
    *   `currentSectionId`: string | null

### B. `useReaderSyncStore` (Synced)
*   **Persistence:** `yjs` middleware (bound to `reader-settings` map or individual user properties).
*   **Binding:** `yDoc.getMap('reader-settings')` (Global) OR `yDoc.getMap('progress')` (Per-book).
    *   *Decision:* Global settings (font, theme) go to `settings` map. Progress goes to `progress` map.
    *   *Refinement:* Let's keep `useReaderSyncStore` for **Global Preferences** first.
*   **State Properties:**
    *   `currentTheme`: 'light' | 'dark' | 'sepia'
    *   `customTheme`: { bg: string; fg: string }
    *   `fontFamily`: string
    *   `fontSize`: number
    *   `lineHeight`: number

**Note:** **Reading Progress** (currentCfi) is strictly tied to a `bookId`. It should likely be accessed via a selector on the `inventory` or `progress` map, or a dedicated hook `useBookProgress(bookId)`, rather than a global store property.
*   *Implementation Detail:* `useReaderUIStore` will hold the *active* book ID. Components will subscribe to `useLibraryStore` (Yjs) -> `progress` map -> `get(activeBookId)`.

## 2. Refactor `useAnnotationStore`

**File:** `src/store/useAnnotationStore.ts`

**Action:** Replace `zustand/persist` with `zustand-middleware-yjs`.

*   **Shared Type:** `yDoc.getMap('annotations')`.
*   **State Interface:**
    *   `annotations: Record<string, UserAnnotation>` (The middleware typically maps Y.Map to a JS Object).
*   **Actions:**
    *   `addAnnotation`: `set(state => { state.annotations[id] = newAnn })` (Middleware handles Proxy wrap).
    *   `deleteAnnotation`: `set(state => { delete state.annotations[id] })`.

## 3. Refactor `useLibraryStore`

**File:** `src/store/useLibraryStore.ts`

**Action:** Replace manual `DBService.getLibrary()` fetching with Yjs binding.

*   **Shared Type:** `yDoc.getMap('inventory')`.
*   **State Interface:**
    *   `books: Record<string, UserInventoryItem>`.
    *   `staticMetadata: Record<string, StaticBookManifest>` (Hydrated from IDB).
*   **Derived State (Selectors):**
    *   `bookList`: `Object.values(books).map(b => ({ ...b, ...staticMetadata[b.bookId] })).sort(...)`
*   **Critical Requirement: The Hydrator**
    *   Since Yjs only stores the `inventory` (user metadata), the store **must** have a mechanism to fetch and cache `StaticBookManifest` (covers, author, title) from `static_manifests` IDB.
    *   *Action:* Implement a `hydrateStaticMetadata` effect that runs whenever `books` changes or on startup.
*   **Modified Actions:**
    *   `fetchBooks`: **Remove** (Binding handles this).
    *   `addBook(file)`:
        1.  Call `const metadata = await dbService.addBook(file)` (Pure Ingestion).
        2.  `set(state => { state.books[metadata.id] = mapMetadataToInventory(metadata) })`.
        3.  *Middleware automatically syncs this change to Yjs 'inventory' map.*
    *   `removeBook(id)`:
        1.  `set(state => { delete state.books[id] })`.
        2.  Call `await dbService.deleteBook(id)` (to clear blobs).

## 4. Refactor `useReadingListStore`

**File:** `src/store/useReadingListStore.ts`

**Action:** Create a new store to manage the persistent reading history (Shadow Inventory).

*   **Shared Type:** `yDoc.getMap('reading_list')`.
*   **State Interface:**
    *   `entries: Record<string, ReadingListEntry>`.
*   **Actions:**
    *   `upsertEntry(entry: ReadingListEntry)`: Updates the Yjs map.
    *   `removeEntry(filename: string)`: Removes from Yjs map.
    *   `getEntry(filename: string)`: Selector to retrieve entry.

## 5. Refactor `DBService` (The Dismantling)

**File:** `src/db/DBService.ts`

**Action:** Remove write responsibilities for user-domain data.

### Method Updates:
1.  **`addBook(file)`:**
    *   **Old:** Returns `void`. Writes to `static_*` AND `user_inventory`.
    *   **New:** Returns `Promise<BookMetadata>`. Becomes a **Pure Ingestion Engine**.
        *   Parses EPUB and extracts metadata.
        *   Writes **ONLY** to `static_*` stores (Blobs).
        *   Does **NOT** write to `user_inventory` or any Yjs maps.
        *   The calling Store is responsible for taking the returned Metadata and writing it to the Yjs `inventory`.
2.  **`deleteBook(id)`:**
    *   **Keep:** Needs to delete `static_*` and `cache_*` stores.
    *   **Remove:** Deletion of `user_*` stores (handled by Yjs, though we might keep `user_*` cleanup for legacy hygiene temporarily).
3.  **`updateBookMetadata`:** **Delete**. (Handled by Store).
4.  **`saveProgress`:** **Delete**. (Handled by Store).
5.  **`addAnnotation` / `deleteAnnotation`:** **Delete**. (Handled by Store).
6.  **`getLibrary`:** **Keep for Phase 3 Migration**, then Deprecate.

async addBook(file: File, ...): Promise<StaticBookManifest> {
    // ... extract metadata ...
    // ... write to static_manifests ...
    // ... write to static_resources ...
    return manifest; // Do NOT write to user_inventory
}
```

## 6. Sync Orchestration & Deprecation

**Action:** Phase out `src/lib/sync/SyncOrchestrator.ts`.

*   **Legacy Sync:** Relies on manual diffing and IDB writes.
*   **New Yjs Sync:** Automatic via `y-indexeddb` and providers.
*   **Action Items:**
    1.  Remove `SyncOrchestrator.get()?.scheduleSync()` calls from stores.
    2.  Ensure Yjs providers are initialized *before* store consumers attempt to read data.

## 7. Risks & Mitigations

| Risk | Mitigation |
| :--- | :--- |
| **Partial Ingestion** | If `DBService.addBook` fails after writing blobs but before store updates Yjs, we get orphaned blobs. **Mitigation:** Wrap IDB writes in a transaction where possible; rely on Phase 1 Garbage Collector to clean up orphans. |
| **Silent Failures** | Yjs LWW might overwrite local changes if clocks are skewed. **Mitigation:** Minimal impact for metadata; focus on robust error boundaries for `StaticResource` fetching. |
| **Hydration Lag** | UI might show missing covers while IDB fetches manifests. **Mitigation:** Use a "Loading/Placeholder" state for covers; ensure `staticMetadata` hydration is prioritized. |

## 8. Component Updates (Consumers)

*   **`ReaderView.tsx`:** Update to read `toc` from `ReaderUIStore` and `theme` from `ReaderSyncStore`.
*   **`LibraryView.tsx`:** Update to observe `useLibraryStore.books` (Yjs map) instead of array.
*   **`ReaderControlBar.tsx`:** Update font/theme setters to use `ReaderSyncStore`.

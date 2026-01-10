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
*   **Derived State (Selectors):**
    *   `bookList`: `Object.values(books).sort(...)`
*   **Modified Actions:**
    *   `fetchBooks`: **Remove**.
    *   `addBook(file)`:
        1.  Call `const metadata = await dbService.addBook(file)`.
        2.  `set(state => { state.books[metadata.id] = mapMetadataToInventory(metadata) })`.
    *   `removeBook(id)`:
        1.  `set(state => { delete state.books[id] })`.
        2.  Call `await dbService.deleteBook(id)` (to clear blobs).

## 4. Refactor `DBService` (The Dismantling)

**File:** `src/db/DBService.ts`

**Action:** Remove write responsibilities for user-domain data.

### Method Updates:
1.  **`addBook(file)`:**
    *   **Old:** Returns `void`. Writes to `static_*` AND `user_inventory`.
    *   **New:** Returns `Promise<BookMetadata>`. Writes **ONLY** to `static_*` stores.
2.  **`deleteBook(id)`:**
    *   **Keep:** Needs to delete `static_*` and `cache_*` stores.
    *   **Remove:** Deletion of `user_*` stores (handled by Yjs, though we might keep `user_*` cleanup for legacy hygiene temporarily).
3.  **`updateBookMetadata`:** **Delete**. (Handled by Store).
4.  **`saveProgress`:** **Delete**. (Handled by Store).
5.  **`addAnnotation` / `deleteAnnotation`:** **Delete**. (Handled by Store).
6.  **`getLibrary`:** **Keep for Phase 3 Migration**, then Deprecate.

**Reference - New `addBook` signature:**
```typescript
async addBook(file: File, ...): Promise<BookMetadata> {
    // ... extract metadata ...
    // ... write to static_manifests ...
    // ... write to static_resources ...
    return metadata; // Do NOT write to user_inventory
}
```

## 5. Component Updates (Consumers)

*   **`ReaderView.tsx`:** Update to read `toc` from `ReaderUIStore` and `theme` from `ReaderSyncStore`.
*   **`LibraryView.tsx`:** Update to observe `useLibraryStore.books` (Yjs map) instead of array.
*   **`ReaderControlBar.tsx`:** Update font/theme setters to use `ReaderSyncStore`.

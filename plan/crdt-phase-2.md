# Phase 2: Switch to Yjs Persistence

**Goal:** Transition the refactored stores (from Phase 0) to use Yjs middleware for persistence and sync, and update `DBService` to stop writing user data.

## 1. Bind Stores to Yjs

**Action:** Update the store factories created in Phase 0 to accept a `Y.Doc` and use `yjs` middleware.

### A. `usePreferencesStore`
*   **Old:** `zustand/persist` (localStorage).
*   **New:** `yjs(doc, 'settings', ...)`
*   **Mapping:** Map local state fields to the `settings` shared map.

### B. `useReadingStateStore`
*   **Old:** `zustand/persist` (localStorage).
*   **New:**
    *   `currentBookId`: Remains ephemeral/local storage? *Decision:* Keep `currentBookId` in `localStorage` as it's device-specific state (what I'm looking at right now).
    *   `currentCfi`, `locations`: These move to the `progress` map in Yjs, accessed via the `useBookProgress` hook or a new `useReadingProgressStore` bound to Yjs.
    *   *Refinement:* The `useReadingStateStore` might just become a thin wrapper around `useBookProgress` for the active book.

### C. `useAnnotationStore`
*   **Shared Type:** `doc.getMap('annotations')`.
*   **State:** `annotations: Record<string, UserAnnotation>`.
*   **Update Factory:** `createAnnotationStore(doc)`.

### D. `useLibraryStore`
*   **Shared Type:** `doc.getMap('inventory')`.
*   **State:** `books: Record<string, UserInventoryItem>`.
*   **Update Factory:** `createLibraryStore(doc)`.
*   **Logic:** `addBook` now takes the metadata returned from `DBService` and simply does `state.books[id] = metadata`.

### E. `useReadingListStore`
*   **Shared Type:** `doc.getMap('reading_list')`.
*   **State:** `entries: Record<string, ReadingListEntry>`.
*   **Update Factory:** `createReadingListStore(doc)`.

## 2. Update Application Entrypoint

**Action:** Inject the real global `yDoc` into the store factories.

```typescript
// src/store/index.ts (or wherever stores are initialized)
import { yDoc } from './yjs-provider';
import { createLibraryStore } from './useLibraryStore';

export const useLibraryStore = createLibraryStore(yDoc);
// ... repeat for others
```

## 3. Dismantle DBService Write Logic

**File:** `src/db/DBService.ts`

**Action:** Now that stores are writing to Yjs, we remove the legacy write paths.

### Method Updates:
1.  **`addBook(file)`:**
    *   Ensure it **ONLY** writes to `static_*` stores.
    *   Returns `Promise<BookMetadata>`.
    *   Does NOT write to `user_inventory`.
2.  **`deleteBook(id)`:**
    *   **Keep:** Deletes `static_*` and `cache_*` stores.
    *   **Remove:** Deletion of `user_*` stores.
    *   *Note:* The Store `removeBook` action will call `DBService.deleteBook` AND remove from Yjs map.
3.  **`updateBookMetadata`:** **Delete**.
4.  **`saveProgress`:** **Delete**.
5.  **`addAnnotation` / `deleteAnnotation`:** **Delete**.
6.  **`getLibrary`:** **Keep** (for Migration Service usage only).

## 4. Component Updates

*   **`ReaderView.tsx`:** Verify `useBookProgress` handles the sync updates correctly.
*   **`LibraryView.tsx`:** Verify `useLibraryStore` (now Yjs-backed) updates in real-time.

CRDT Phase 2: The Bridge & Store Integration (Revised with Middleware)
======================================================================

**Status:** Active
**Dependency:** Phase 1 (Core CRDT Service) Complete

## Goals
1.  **Migrate Legacy Data:** One-way hydration from `idb` (books, annotations) to `y-indexeddb` (Y.Doc).
2.  **Refactor Stores:** Replace `useLibraryStore` and `useAnnotationStore` with `zustand-middleware-yjs` backed stores.
3.  **Ensure Reactivity:** UI updates automatically when Yjs state changes (local or remote).
4.  **Preserve UI State:** Separate transient UI state (filters, sort) from persistent data.

## 1. Migration Strategy (The Bridge)

The "Bridge" is a mechanism to populate the empty Y.Doc from the existing IndexedDB stores upon first run.

### 1.1 Hydration Logic (`src/lib/crdt/MigrationService.ts`)
*   **Check:** On startup, check if `CRDTService.isHydrated` (flag in `y-indexeddb` or `localStorage`) is false.
*   **Source:** Read all data from legacy `DBService.getLibrary()` and `DBService.getAnnotations()`.
*   **Target:** `CRDTService.doc`.
*   **Transformation:**
    *   Books: Map to `Y.Map<BookMetadata>`.
    *   Annotations: Map to `Y.Array<Annotation>`.
    *   History: Map to `Y.Map<string[]>`.
*   **Completion:** Set `CRDTService.isHydrated = true`.

## 2. Store Refactoring (Middleware Integration)

We will use `zustand-middleware-yjs` to bind Zustand stores directly to Yjs shared types. This eliminates the need for manual `observe` listeners and reduces the risk of sync loops.

### 2.1 Store Separation
Currently, `useLibraryStore` mixes data (`books`) with UI state (`viewMode`, `sortOrder`). The middleware syncs the *entire* store state to the Yjs shared type. To prevent syncing local UI state to the cloud, we must split the stores.

#### `useBookStore` (Synced Data)
*   **Backed by:** `yjs(doc, 'books', ...)`
*   **State:**
    *   `books: Record<string, BookMetadata>` (or Map)
*   **Actions:** `addBook`, `updateBook`, `deleteBook` (These just mutate the state; middleware updates Yjs).

#### `useAnnotationStore` (Synced Data)
*   **Backed by:** `yjs(doc, 'annotations', ...)`
*   **State:**
    *   `annotations: Annotation[]`
*   **Actions:** `addAnnotation`, `deleteAnnotation`.

#### `useLibraryUIStore` (Local UI)
*   **Backed by:** Standard `zustand` (persist to localStorage).
*   **State:**
    *   `viewMode`: 'grid' | 'list'
    *   `sortOrder`: 'recent' | 'author' | ...
    *   `searchQuery`: string
*   **Selectors:** Combine data from `useBookStore` with local filters.

### 2.2 Implementation Steps

1.  **Install Middleware:**
    ```bash
    npm install zustand-middleware-yjs
    ```

2.  **Create `useBookStore`:**
    ```typescript
    import { create } from 'zustand';
    import { yjs } from 'zustand-middleware-yjs';
    import { crdtService } from '../crdt/CRDTService';

    interface BookState {
      books: Record<string, BookMetadata>;
      addBook: (book: BookMetadata) => void;
      // ...
    }

    export const useBookStore = create<BookState>()(
      yjs(
        crdtService.doc,
        'books',
        (set) => ({
          books: {},
          addBook: (book) => set((state) => ({ books: { ...state.books, [book.id]: book } })),
          // ...
        })
      )
    );
    ```

3.  **Update `useLibraryStore` (now `useLibraryUIStore`):**
    *   Remove `books` array from state.
    *   Add selectors that read from `useBookStore`.
    *   Example hook usage:
        ```typescript
        const books = useBookStore(state => state.books);
        const sortOrder = useLibraryUIStore(state => state.sortOrder);
        const sortedBooks = useMemo(() => sortBooks(Object.values(books), sortOrder), [books, sortOrder]);
        ```

## 3. Handling Binary Assets (The "Heavy" Layer)

Yjs is for metadata (The "Moral" Layer). Large binary assets (EPUB files, covers) remain in IndexedDB (managed by `DBService`).

*   **Ingestion:**
    1.  `DBService.addBook(file)` -> Stores binary in IDB.
    2.  Returns `BookMetadata`.
    3.  `useBookStore.getState().addBook(metadata)` -> Syncs metadata to Yjs.

*   **Deletion:**
    1.  `useBookStore.getState().deleteBook(id)` -> Removes metadata from Yjs.
    2.  `DBService.deleteBook(id)` -> Removes binary from IDB.

## 4. Execution Plan

### Step 1: Migration Service
*   Implement `src/lib/crdt/MigrationService.ts`.
*   Add unit tests using `fake-indexeddb` to verify data is copied correctly.

### Step 2: Store Split & Middleware
*   Create `src/store/useBookStore.ts` with middleware.
*   Refactor `src/store/useLibraryStore.ts` to be UI-only.
*   Update `LibraryView` and other components to use the new hooks.

### Step 3: Annotation Store
*   Apply similar pattern to `useAnnotationStore`.

### Step 4: Verification
*   **Test:** Open two tabs. Add a book in Tab A. Verify it appears in Tab B.
*   **Test:** Change sort order in Tab A. Verify it *does not* change in Tab B.
*   **Test:** Reload page. Verify data persists (via `y-indexeddb`).

## 5. Risks & Mitigation

*   **Middleware Limitations:** Verify `zustand-middleware-yjs` handles nested object updates correctly. If `books` is a Record, `set` must use spread correctly.
*   **Type Safety:** The middleware might lose some type inference. Ensure explicit typing of the store.
*   **Performance:** Reactivity on a large `books` object might trigger re-renders. Use `zustand` selectors carefully (e.g., `useBookStore(state => state.books[id])`).


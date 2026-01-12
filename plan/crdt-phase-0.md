# Phase 0: Pre-Migration Refactoring & Test Hardening

**Goal:** Prepare the codebase for Yjs by decoupling stores from implementation details, splitting monolithic stores, and shifting testing strategy to be behavior-centric. This phase uses existing persistence (localStorage/IndexedDB) but establishes the *structure* needed for a seamless switch to Yjs.

## 1. Split `useReaderStore`

**Current State:** `useReaderStore` mixes ephemeral UI state, user preferences, and book progress.

**Action:** Split into three focused stores. Use `zustand/persist` for persistent ones for now.

### A. `useReaderUIStore` (Ephemeral)
*   **Purpose:** UI state that resets on reload or is derived.
*   **State:** `isLoading`, `toc`, `viewMode`, `immersiveMode`, `currentSectionTitle`.
*   **Persistence:** None (Memory).

### B. `usePreferencesStore` (Persistent)
*   **Purpose:** Global user settings.
*   **State:** `theme`, `fontFamily`, `fontSize`, `lineHeight`.
*   **Persistence:** `localStorage` (via `zustand/persist`).

### C. `useReadingStateStore` (Persistent)
*   **Purpose:** Tracks *active* book state.
*   **State:** `currentBookId`, `currentCfi`, `locations`.
*   **Persistence:** `localStorage` (via `zustand/persist`).
*   *Note:* In Phase 2, `currentBookId` stays local, but `currentCfi` moves to the Yjs `progress` map.

## 2. Abstraction of "Progress"

**Action:** Create a custom hook `useBookProgress(bookId)` to abstract *where* progress comes from.

*   **Implementation (Phase 0):** Selects from `useReadingStateStore` (if active) or fetches from `DBService` (async).
*   **Future (Phase 2):** Selects from Yjs `progress` map (sync).
*   **Benefit:** Components like `LibraryView` won't change when we switch storage engines.

## 3. Refactor `useLibraryStore` Internals

**Current State:** Stores `books` as `BookMetadata[]`.

**Action:** Refactor to store books as `Record<string, BookMetadata>` (or Map).

*   **Internal State:** `books: Record<string, BookMetadata>`.
*   **Selector:** `useAllBooks()` returns `Object.values(books).sort(...)`.
*   **Updates:** `addBook` and `fetchBooks` update the Map.
*   **Benefit:** O(1) lookups and easier synchronization with Yjs Maps later.

## 4. Testing Strategy Overhaul

**Problem:** Current tests mock `DBService.getDB()` heavily. Switching to Yjs will break all tests because `getDB` won't be called.

**Action:** Switch to "Behavioral Testing" using Store Factories.

### A. Create Store Factories
Modify store files to export a factory function that accepts dependencies (and later, the Yjs Doc).

```typescript
// src/store/useLibraryStore.ts
export const createLibraryStore = (initialState = {}) => create(...)
export const useLibraryStore = createLibraryStore(); // Default singleton
```

### B. Refactor Store Tests
Update tests to assert on *State Changes* rather than *Mock Calls*.

*   **Before:**
    ```typescript
    test('addBook calls db.add', () => {
       act(() => store.addBook(book));
       expect(mockDB.add).toHaveBeenCalledWith(book);
    });
    ```
*   **After:**
    ```typescript
    test('addBook updates state', () => {
       const store = createLibraryStore();
       act(() => store.addBook(book));
       expect(store.getState().books[book.id]).toEqual(book);
    });
    ```
*   **Note:** In Phase 0, we may still need to mock `DBService` if the store calls it, but the *assertion* should be on the state.
*   **Preparation for Phase 2:** In Phase 2, we will inject a Mock Y.Doc into the factory, completely bypassing DB mocks.

## 5. Refactor `DBService` Interface (Prep)

**Action:** Update `addBook` signature to return `BookMetadata`.

*   **Current:** `async addBook(file): Promise<void>`
*   **New:** `async addBook(file): Promise<BookMetadata>`
*   **Logic:** It still writes to `user_inventory` for now, but returning the metadata allows the Store to update its local state immediately, paving the way for the Store to be the *writer* in Phase 2.

# Phase 0: Pre-Migration Refactoring & Test Hardening

**Goal:** Prepare the codebase for Yjs migration by mechanically separating concerns and hardening tests **before** switching the persistence layer. This minimizes the "Big Bang" risk.

**Status:** Immediate Execution

## 1. Store Splitting & Refactoring

We will split the monolithic stores and abstract data access patterns now, while keeping the underlying `localStorage` / `IndexedDB` persistence (via `DBService`) unchanged for this phase.

### A. Split `useReaderStore`
Currently mixed ephemeral UI state, user prefs, and book progress.

**Action:** Split into three distinct stores:

1.  **`useReaderUIStore`** (Ephemeral)
    *   **State:** `isLoading`, `toc`, `viewMode`, `immersiveMode`, `currentSectionTitle`.
    *   **Persistence:** None (Memory only).
2.  **`usePreferencesStore`** (Persistent Settings)
    *   **State:** `theme`, `fontFamily`, `fontSize`, `lineHeight`.
    *   **Persistence:** `zustand/persist` (localStorage) for now.
    *   *Future:* Will bind to Yjs `settings` map.
3.  **`useReadingStateStore`** (Persistent Progress)
    *   **State:** `currentBookId`, `currentCfi` (active), `progress`.
    *   **Persistence:** `zustand/persist` (localStorage) for now.
    *   *Future:* Will bind to Yjs `progress` map.

**Benefit:** Components update to use these granular stores. When we swap persistence to Yjs, the components remain untouched.

### B. Abstraction of "Progress"
Reading progress varies by book. Direct store access couples components to the storage shape.

**Action:** Create `useBookProgress(bookId)` hook.

*   **Current Implementation (Phase 0):** Selects from `useReadingStateStore` or fetches from `DBService` (if needed for list view compatibility).
*   **Future Implementation (Phase 2):** Selects from Yjs `progress` map.

**Components to Update:**
*   `ReaderView`: Use `useBookProgress` for current location.
*   `LibraryView`: Use `useBookProgress` for % read badges.

### C. Internalize `useLibraryStore` Structure
Currently stores `books` as `BookMetadata[]`. Yjs will use a Map.

**Action:**
1.  Refactor `useLibraryStore` state to store `books: Record<string, BookMetadata>`.
2.  Expose selector `useAllBooks()` that returns `Object.values(books).sort(...)`.
3.  Update components (`LibraryView`) to use `useAllBooks()`.

> [!IMPORTANT]
> **Strict Selector Enforcement:** Once `books` becomes a Record, components **MUST NOT** access `state.books` directly. Use `useAllBooks()` for lists and `useBook(id)` for individual book access. This ensures that the component doesn't re-render when *any* book changes, only when the book it cares about changes.

**Benefit:** The internal data structure matches the future Yjs `inventory` map. Switching to Yjs becomes a backend change only.

## 2. Testing Strategy Refactor

**Problem:** Current tests mock `DBService` internals (`getDB`, `put`, `add`). When we switch to Yjs, these tests will all fail because `DBService` is no longer called for user data.

**Goal:** Shift to **Behavioral Testing** using Dependency Injection.

### A. Store Factories (Dependency Injection)
Instead of importing the singleton `yDoc` or `dbService` directly in stores (hard coupling), use a Factory Pattern for tests.

**Implementation Pattern:**

```typescript
// src/store/useLibraryStore.ts
import { createStore } from 'zustand';
import * as Y from 'yjs';

// The Core Logic Factory
export const createLibraryStore = (doc: Y.Doc | null) => {
    // If doc is provided, use Yjs middleware
    // If null (Phase 0), use legacy logic (or mock middleware equivalent)
    return createStore(...)
}

// The Singleton for App usage
export const useLibraryStore = create(() => createLibraryStore(globalYDoc));
```

*Refinement for Phase 0:* Since we aren't using Yjs yet in Phase 0, we can structure the tests to verify **State Updates** rather than **Service Calls**.

*   **Before:** Expect `dbService.addBook` to be called.
*   **After:** Call `addBook`. Expect `store.getState().books[id]` to exist.

### B. The "Test Middleware Shim"
To verify store logic without full Yjs/IDB complexity in unit tests:
1.  Create a factory for stores.
2.  In tests, use a "Memory" version of the store or pass a fresh `new Y.Doc()` (once Yjs is added).
3.  Eliminate mocks of `getDB` for store logic tests. Only mock `DBService` for *side effects* (like checking if a file blob was written), not for state consistency.

### C. Action Items
1.  **Refactor `useAnnotationStore.test.ts`**: Remove `getDB` mocks. Test that `addAnnotation` updates the store's `annotations` array/map.
2.  **Refactor `useLibraryStore.test.ts`**: Test that `addBook` updates the internal map.

## 3. Refactor `addBook` Logic (Preparation)

**Action:** Ensure `DBService.addBook` is a **Pure Ingestion Engine**.

> [!WARNING]
> `processEpub` in `src/lib/ingestion.ts` is currently a monolithic function. We need to split it to separate side-effects from data extraction.

**Split Strategy for `processEpub`:**
1.  **`extractBookData(file)`**: Pure function. Returns `{ manifest, resource, structure, inventory, progress, readingListEntry, ttsContentBatches, tableBatches }`.
2.  **`DBService.ingestBook(data)`**: Writes *only* "Static" data (`manifest`, `resource`, `structure`) to IndexedDB.
3.  **`LibraryStore.addBook(file)`**:
    - Calls `extractBookData`.
    - Calls `DBService.ingestBook`.
    - In Phase 0: Writes "User" data (`inventory`, `progress`, `readingListEntry`) to legacy IDB via `DBService`.
    - In Phase 2+: Writes "User" data to Yjs maps.

## 4. Conflict Resolution & Merging (Preview)

While Phase 0 doesn't implement Yjs, we must prepare for its conflict resolution model (LWW).

**Decision:**
*   **Reading Progress:** Pure LWW is insufficient as it might revert progress if a user reads on an offline device with a skewed clock.
*   **Mitigation:** In Phase 2, we will implement a "Max Progress Wins" merge strategy for the `progress` map, likely via a custom observer or by wrapping the write logic.

## 5. Phase 0 Success Criteria (Tests)
*   [ ] `useReaderStore` is deleted and replaced by 3 specialized stores.
*   [ ] `useLibraryStore.state.books` is a Record.
*   [ ] `DBService.addBook` no longer performs a monolithic transaction over 9+ stores.
*   [ ] All existing tests pass after refactoring to use Store Factories.

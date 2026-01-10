# Phase 2: Store Refactoring & Migration

**Goal:** Split stores into Transient/Sync, bind them to Yjs, and refactor DBService to stop writing user data.

## 1. Refactor `useReaderStore`
*   **Action:** Split into two stores.
*   **`useReaderUIStore` (Transient):**
    *   Keeps: `isLoading`, `currentBookId`, `toc`, `viewMode`, `immersiveMode`, `shouldForceFont`.
    *   Remains a standard Zustand store (persisted to localStorage via standard persist middleware if needed, or just transient).
*   **`useReaderSyncStore` (Synced):**
    *   Keeps: `currentCfi`, `progress`, `currentTheme` (maybe), `fontFamily`, `fontSize`, `lineHeight`.
    *   Uses `yjs` middleware bound to `reader-settings` (or split further if needed).
*   **Update Consumers:** Update `ReaderView.tsx`, `ReaderControlBar.tsx` to import from the correct store.

## 2. Refactor `useAnnotationStore`
*   **Action:** Convert to Yjs.
*   **Binding:** Bind to `Y.Map` named `annotations`.
*   **Logic:**
    *   `addAnnotation`: `set(state => ({ annotations: { ...state.annotations, [uuid]: note } }))`.
    *   `deleteAnnotation`: Remove from map.

## 3. Refactor `useLibraryStore`
*   **Action:** Convert to Yjs.
*   **Binding:** Bind to `Y.Map` named `inventory`.
*   **Logic:**
    *   `fetchBooks`: **Remove**. The middleware auto-loads the state.
    *   `addBook`: Call `DBService.addBook` (blobs), then `set` metadata to `inventory`.
    *   `removeBook`: Remove from `inventory`, then call `DBService.deleteBook` (blobs).
    *   *Note:* Need to ensure `BookMetadata` shape is compatible or needs a slight wrapper.

## 4. Refactor `DBService` (The Dismantling)
*   **Target:** `src/db/DBService.ts`
*   **Action:** Remove write operations for user data.
    *   Remove `updateBookMetadata` (or make it a no-op/log warning).
    *   Remove `saveProgress`.
    *   Remove `addAnnotation`.
    *   Remove `saveContentAnalysis` (if synced) or keep if cache. *Decision: Content Analysis is expensive cache, keep in Legacy IDB (`static_manifests` or `cache`).*
*   **Action:** Ensure `addBook` returns the `BookMetadata` object so the store can use it.

## 5. Component Updates
*   Audit all components using `useLibraryStore`, `useReaderStore`.
*   Replace `fetchBooks()` calls with... nothing (auto-sync).
*   Update write actions to use the new store methods.

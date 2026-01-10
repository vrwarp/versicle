# Phase 1: Foundation & Dependencies

**Goal:** Initialize the Yjs runtime, set up the persistence layer, and establish the singleton provider pattern.

## 1. Install Dependencies
*   Install `yjs` (CRDT implementation).
*   Install `zustand-middleware-yjs` (Zustand binding).
    *   *Note:* Use the fork at `https://github.com/vrwarp/zustand-middleware-yjs` to support modern Zustand versions.
*   Install `y-indexeddb` (Local persistence).
*   *Note:* Ensure peer dependencies for `zustand` are compatible.

## 2. Create Yjs Provider Singleton
*   **File:** `src/store/yjs-provider.ts`
*   **Responsibility:**
    *   Instantiate the root `Y.Doc`.
    *   Initialize `IndexeddbPersistence` (naming the DB `versicle-yjs`).
    *   Export the `doc` instance for use by the middleware.
    *   Add basic event logging (e.g., "Yjs loaded", "Yjs synced").

## 3. Validation
*   Create a temporary test file or script.
*   Write a value to the `Y.Doc`.
*   Reload the page/app.
*   Read the value from the `Y.Doc`.
*   **Success Criteria:** Data persists across reloads without touching the legacy `versicle-db`.

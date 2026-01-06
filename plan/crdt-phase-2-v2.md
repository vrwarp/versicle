Design Document: CRDT Phase 2 - Gradual Data Migration & Store Refactor
=======================================================================

**Target:** Refactor the "Moral Layer" from direct IndexedDB writes to a reactive Yjs-driven architecture through four controlled subphases, ensuring zero data loss and maintaining high performance.

Phase 2A: The Shunt (Infrastructure & Dual-Source Ready)
--------------------------------------------------------

Before moving any data, we must prepare the stores to handle two sources of truth and disable legacy automatic persistence that would conflict with Yjs.

### 2A.1 Store Persistence Decommissioning

**Audit Finding:** `useSyncStore` and `useUIStore` use `persist` middleware.

-   **Minutia:** Ripping out `persist` will cause an immediate "First Run" state for users.

-   **Transition Detail:** We must create a `LegacyStorageBridge`. On boot, it reads from `localStorage`, writes the values into the Zustand state, and then *immediately* deletes the `localStorage` keys to prevent them from ever being used again.

-   **Impacted Store:** `useUIStore.ts` (theme, layout), `useSyncStore.ts` (credentials).

### 2A.2 The `PersistenceShunt` Proxy (DBService Refactor)

**Transition Detail:** Refactor `src/db/DBService.ts` to implement a "Persistence Shunt" pattern for every Moral-layer function.

-   **`updateBookMetadata(id, updates)`**:

    -   If `mode === 'legacy'`: `db.put('books', ...)`

    -   If `mode === 'shadow'`: `db.put('books', ...)` AND `yjsBooks.get(id).set(...)`

    -   If `mode === 'crdt'`: `yjsBooks.get(id).set(...)` only.

-   **`deleteBook(id)`**: Must ensure the `files` store (Heavy Layer) is cleared via `db.delete('files', id)` regardless of mode, but metadata deletion moves to Yjs.

Phase 2B: Decoupling & Reactive Wrappers
----------------------------------------

In this subphase, we break the direct link between Zustand and IndexedDB, moving to an observer-driven architecture.

### 2B.1 The `YjsObserverService` (Zustand Binding)

**Minutia:** Mapping Yjs events to specific Zustand actions without creating infinite loops.

-   **`yDoc.observeDeep((events) => { ... })`**:

    -   **Detail:** The observer must check `event.transaction.origin`. If origin is `zustand_internal`, ignore.

    -   **Action:** `useLibraryStore.getState().internalSync(yMap.toJSON())`.

-   **Deep Equality:** Use `fast-deep-equal` on the `books` map. We must not trigger a React re-render if the only change was a non-visible metadata field (e.g., `lastUpdated` timestamp).

### 2B.2 Refactoring `useReaderStore.saveLocation`

**Audit Finding:** `saveLocation` is high-frequency (triggered on scroll and TTS).

-   **Transition Detail:** Currently, this calls `DBService.updateBookMetadata`.

-   **Refactor:** `saveLocation` will now update local Zustand state immediately for UI fluidity, but the "Moral" write to Yjs is throttled via the existing `DEBOUNCE_MS` (60s) logic to prevent binary update log bloat.

Phase 2C: Selective Hydration (The "Warm-Up")
---------------------------------------------

We migrate low-risk, low-frequency data first to verify the pipeline.

### 2C.1 Hydrating `lexicon` and `reading_list`

-   **`DBService.getAllLexiconRules()`**:

    -   **Minutia:** Migration must preserve the `order` property by pushing rules to a `Y.Array`.

    -   **Sanitization:** Legacy `ReadingListEntry` uses filenames as keys. Migration must map these to `bookId` (UUID) to avoid key collision issues with special characters in filenames.

### 2C.2 Hydrating `annotations`

-   **`DBService.getAnnotations(bookId)`**:

    -   **Minutia:** Move from `db.getAll('annotations')` to `Y.Map<UUID, Annotation>`.

    -   **Verification:** `AnnotationList.tsx` expects an array. The `YjsObserverService` must provide a computed array sorted by `created` timestamp to maintain UI consistency.

Phase 2D: The Final Cutover (History & Progress)
------------------------------------------------

The most delicate part: migrating high-frequency data and the TTS handoff state.

### 2D.1 `ReadingHistory` Compression

-   **Audit Finding:** `reading_history` is a list of segments and sessions.

-   **Transition Detail:** Before writing to the `Y.Array`, legacy data must be passed through `src/lib/cfi-utils.ts:mergeCfiRanges`.

-   **Rationale:** A user might have 1,000 small "scroll" sessions. We should compress these into unified ranges *before* they enter the permanent CRDT log.

### 2.D2 Ingestion Pipeline Refactor (`ingestEpub`)

**Audit Finding:** `src/lib/batch-ingestion.ts` performs a single `db.transaction(['books', 'files'], 'readwrite')`.

-   **CRDT Transition Detail:** 1\. Write `Blob` to legacy `files` store (IndexedDB). 2. Wait for success. 3. Call `useLibraryStore.actions.addBookMetadata(...)` (which writes to Yjs).

-   **Why:** Yjs operations cannot be part of an IndexedDB transaction. Decoupling ensures that if the binary file write fails, we don't end up with a "ghost metadata" entry in the CRDT.

Risks & Mitigations (Function-Level)
------------------------------------

### 2.R1 The "Partial Ingestion" Orphan

If `saveFile` succeeds but the app crashes before the Yjs `addBookMetadata` call.

-   **Mitigation:** Add a `MaintenanceService.cleanupOrphanedFiles()` function in Phase 4 that deletes any entry in the `files` store that doesn't have a corresponding ID in the Yjs `books` map.

### 2.R2 TTS Progress Drift

**Audit Finding:** `AudioPlayerService` updates `lastPlayedCfi`.

-   **Mitigation:** During Phase 2D Cutover, we must implement an `atomicPause()`. It stops the audio, flushes the final `lastPlayedCfi` to IndexedDB, completes hydration, and then resumes audio from the CRDT.

### 2.R3 `requestIdleCallback` Priority

Hydrating a library of 200 books on a Tesla browser might block the main thread.

-   **Mitigation:** Wrap the migration loop in `requestIdleCallback` with a `timeout: 2000` to ensure user interactions (like clicking "Cancel") remain responsive during the database upgrade.

## Phase 2C Execution Report

**Status:** Completed.

**Work Done:**
1.  **MigrationService:** Implemented `src/lib/migration/MigrationService.ts`.
2.  **Hydration Logic:**
    *   `lexicon`: Migrated with order preservation (sorted by `order` field).
    *   `reading_list`: Migrated to `Y.Map` (keyed by filename as per schema, despite plan note about bookId mapping which seemed contradictory to current schema definition).
    *   `annotations`: Migrated to `Y.Array` (as per schema).
3.  **Trigger:** Integrated into `useLibraryStore.fetchBooks` (init path) with a non-blocking timeout.
4.  **Guard Mechanism:** Used `crdtService.settings.get('migration_phase_2c_complete')` to prevent re-hydration loops, as checking `books.size` was insufficient (since books are not hydrated yet in this phase).

**Findings:**
*   **Flag Necessity:** Since Phase 2C only hydrates side tables, `crdtService.books` remains empty. We introduced a `migration_phase_2c_complete` flag in the `settings` map to ensure migration runs exactly once.
*   **Documentation vs Schema:** The plan mentioned mapping reading list keys to `bookId`, but the CRDT schema explicitly defines `readingList` as a `Y.Map` keyed by filename. We followed the schema.

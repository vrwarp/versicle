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

## Phase 2B Execution Report (Decoupling & Reactive Wrappers)

**Status:** Phase 2B Complete.

**Implementation Summary:**
- **Core:** Created `YjsObserverService` in `src/lib/crdt/YjsObserverService.ts` to bridge Yjs events to Zustand stores.
- **Store Refactor:**
    - Updated `useLibraryStore` to include `internalSync` for reactive book updates.
    - Updated `useAnnotationStore` to include `internalSync` for reactive annotation updates.
    - Refactored `useReaderStore` to implement throttled writes to Yjs (Moral Layer) for reading progress (`lastRead`, `progress`) using a 60s debounce, ensuring local fluidity while preventing CRDT history bloat.
- **Integration:** Hooked `YjsObserverService` into `App.tsx` initialization.
- **Testing:**
    - Verified `useReaderStore` throttle logic logic via unit tests.
    - Ensured `internalSync` updates correctly via integration tests.
    - Mocked dependencies in tests (e.g. `fast-deep-equal`, `lodash/debounce`) to ensure isolation.
    - Fixed mocked dependencies in `App_Capacitor.test.tsx` to align with the new store structure.

**Findings & Deviations:**
- **Throttling Strategy:** Instead of using `SyncOrchestrator`'s debounce for local persistence, a dedicated `throttledCrdtUpdate` utility was created to manage Yjs writes independently. This decoupling ensures that local "Moral Layer" persistence happens regardless of cloud sync status.
- **Store Subscriptions:** `YjsObserverService` uses `useStore.getState().internalSync` to push updates. This avoids subscription loops because `internalSync` only updates the React state and does not trigger a DB write back to Yjs (which `DBService` methods do).
- **Test Mocks:** Extensive mocking of `zustand` stores was required for `App_Capacitor.test.tsx` to handle the new `getState()` calls introduced by the observer service.

## Phase 2C Execution Report (Selective Hydration)

**Status:** Phase 2C Complete.

**Implementation Summary:**
- **Core:** Implemented `MigrationService` in `src/services/MigrationService.ts` to handle the one-way hydration of legacy data into the Yjs `CRDTService`.
- **Integration:** Hooked `MigrationService.hydrateIfNeeded()` into `App.tsx` initialization, wrapped in `requestIdleCallback` with a 2-second timeout to avoid blocking the main thread during startup.
- **Data Scope:**
    - **Books Metadata:** Migrated from legacy `books` store to `crdtService.books` (Y.Map). This was deemed necessary as a dependency for other entities (annotations, reading list).
    - **Lexicon:** Migrated from `lexicon` store to `crdtService.lexicon` (Y.Array), preserving order. Added `getAllLexiconRules` to `DBService`.
    - **Reading List:** Migrated from `reading_list` store to `crdtService.readingList` (Y.Map), currently using filename as key as per v1 schema.
    - **Annotations:** Migrated from `annotations` store to `crdtService.annotations` (Y.Array).
- **Testing:** Created comprehensive unit tests in `src/services/tests/MigrationService.test.ts` mocking `DBService` and `CRDTService` to verify correct data transfer and idempotency (skipping if already migrated).

**Findings & Deviations:**
- **Books Metadata Included:** Although Phase 2C focused on "Selective Hydration" of low-risk data, Books Metadata was included because it serves as the foundational foreign key for Annotations and other entities. Without it, the "Moral Layer" in CRDT would be structurally incomplete.
- **Reading List Keys:** The plan suggested mapping Reading List keys from filenames to Book IDs. However, efficient reverse lookup (filename -> bookId) without a full scan is expensive. For Phase 2C, we maintained the filename key to match the current `ReadingListEntry` schema and `crdt.md` definition, deferring the potentially complex re-keying to a later refactor or cleanup phase if necessary.
- **Test Strategy:** Mocking `Yjs` and `CRDTService` in Vitest required careful handling of module mocking (hoisting) to ensure the test and the service under test shared the same `Y.Doc` instance logic. A factory-based mock approach was used.

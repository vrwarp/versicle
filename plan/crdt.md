Design Document: Versicle CRDT-Based State Syncing (Yjs)
========================================================

**Author:** Gemini

**Status:** Draft / Conceptual

**Target:** Replace manual LWW/CFI merging with Yjs CRDTs for absolute data consistency across high-latency or high-concurrency environments.

1\. Motivation & Problem Statement
----------------------------------

The current manual sync implementation (v1) relies on a JSON `SyncManifest`. While functional, it has two primary risks:

1.  **Last-Write-Wins (LWW) Data Loss:** If two devices update the same book metadata (e.g., changing a title on a laptop and reading progress on a phone) simultaneously, the older update might be clobbered depending on timestamp precision and sync timing.

2.  **Maintenance Complexity:** Every new data type added to Versicle requires a manual update to `SyncManager.mergeManifests`.

3.  **Bandwidth Overhead:** v1 uploads the entire manifest (~1MB for large libraries). Yjs allows syncing only the incremental binary diffs.

2\. Technical Architecture
--------------------------

### 2.1 The "Moral Doc" Structure

Instead of a JSON object, the system state is represented by a `Y.Doc`. Within this document, we define a structured hierarchy of shared types:

```
// Shared Types Map
{
  "books": Y.Map<Y.Map<any>>,         // Keyed by bookId. Inner map holds metadata.
  "annotations": Y.Array<Annotation>, // Global append-only array of user highlights.
  "lexicon": Y.Array<LexiconRule>,    // Ordered global/book pronunciation rules.
  "history": Y.Map<Y.Array<string>>,  // Keyed by bookId. Array of CFI ranges.
  "readingList": Y.Map<ReadingListEntry>, // Keyed by filename.
  "transient": Y.Map<TTSPosition>,    // High-frequency playback positions.
}

```

### 2.2 Persistence Layer (`y-indexeddb`)

We will utilize the `y-indexeddb` provider. This creates a dedicated IndexedDB store (e.g., `versicle-state`) where Yjs stores incremental update blocks.

-   **Initialization:** On app boot, the provider reads all blocks from IndexedDB and reconstructs the `Y.Doc` state in-memory. This is non-blocking for UI interactions.

-   **Auto-Commit:** Any change made to the `Y.Doc` via `yjsDoc.getMap('...').set(...)` is automatically persisted to IndexedDB as a binary update block by the provider.

3\. Implementation Details: The Delicate Bits
---------------------------------------------

### 3.1 Handling "Offline-First" Convergent History

One of the most complex parts of Versicle is `reading_history`.

-   **Current (v1):** `mergeCfiRanges` is called on sync to union arrays.

-   **CRDT (v2):** `history` becomes a `Y.Array` of CFI strings. If Device A adds `Range1` and Device B adds `Range2`, the Yjs array simply contains both. A **computed getter** in Versicle will then pass the `Y.Array.toArray()` results through the existing `mergeCfiRanges` utility for UI rendering.

### 3.2 Metadata Collisions

For fields like `lastRead` or `progress`, we use `Y.Map`. Yjs handles map updates using Lamport timestamps.

-   If User A sets progress to 50% and User B (offline) sets it to 60%, when they sync, Yjs determines the winner based on its internal logical clock. This eliminates the "split-brain" timestamp issues inherent in standard `Date.now()` checks.

### 3.3 Transport Layer (Google Drive as a Binary Log)

Since we don't have a central Web Socket server (Tesla browser limitations), Google Drive remains our "Intermittent Broker."

1.  **State Vector:** Every sync starts by generating a `State Vector` (a small binary signature of what the local device knows).

2.  **The Diff:** We fetch the remote state from Google Drive.

3.  **The Update:** We call `Y.encodeStateAsUpdate(localDoc, remoteStateVector)` to get only the bytes missing from the remote.

4.  **The Push:** We upload the new merged binary blob to Google Drive.

4\. The Migration Strategy (The "Bridge" Phase)
-----------------------------------------------

Because this change is "invasive," we cannot simply delete the old IndexedDB stores. We must perform a **One-Way-Hydration**:

1.  **Detection:** On first launch of the CRDT version, check if the Yjs store is empty but the old `books` store is not.

2.  **Hydration:**

    -   Read all data from existing `books`, `annotations`, `lexicon`, etc.

    -   Batch write these into the `Y.Doc`.

    -   Mark the hydration as complete in `app_metadata`.

3.  **Deprecation:** The standard stores (`books`, `annotations`) are no longer the primary source of truth. They are kept as "Legacy Backups" for one version cycle, then deleted.

4.  **Reactive Store Integration:**

    -   Our Zustand stores (`useLibraryStore`, `useAnnotationStore`) will now subscribe to Yjs events (`yDoc.observeDeep()`).

    -   When Yjs updates (locally or via sync), the Zustand store is notified and updates its React state.

5\. Risks and Mitigations
-------------------------

|

Risk

 |

Mitigation

 |
|

**Storage Bloat**

 |

Yjs keeps a history of changes. We must periodically call `Y.encodeStateAsUpdate` and write a "Clean Snapshot" back to the database to prune the incremental update log.

 |
|

**Schema Incompatibility**

 |

Yjs is very flexible with types. We must use a robust **Validator** (like the existing `src/db/validators.ts`) before applying updates to the `Y.Doc` to prevent corrupted state from syncing.

 |
|

**Initial Load Time**

 |

For extremely large libraries (1000+ books), reconstructing the doc from IndexedDB might take >100ms. We will use a "Loading State" during the `y-indexeddb` ready event.

 |

6\. Development Roadmap
-----------------------

1.  **Phase 1 (Proof of Concept):** Implement a standalone `Y.Doc` in a test environment and verify that two separate tabs can sync via a shared binary blob.

2.  **Phase 2 (The Bridge):** Implement the `HydrationService` to move v1 data into Yjs.

3.  **Phase 3 (Store Refactor):** Rewrite `useLibraryStore` to act as a reactive wrapper around `yDoc.getMap('books')`.

4.  **Phase 4 (Cloud Sync):** Refactor `SyncOrchestrator` to use `Y.applyUpdate` instead of `SyncManager.mergeManifests`.

## Phase 1 Execution Report (Deviations & Findings)

**Status:** Phase 1 Complete.

**Implementation Summary:**
- **Core:** The `CRDTService` has been implemented in `src/lib/crdt/CRDTService.ts`, utilizing `yjs` and `y-indexeddb`.
- **Schema:** A strict TypeScript schema `VersicleDocSchema` was defined in `src/lib/crdt/types.ts` to map the "Moral Layer" entities (Books, Annotations, History) to Yjs structures.
- **Testing:** Instead of a manual "debug page", a comprehensive automated test suite (`src/lib/crdt/tests/CRDTService.test.ts`) was created. It uses `fake-indexeddb` to simulate multiple isolated instances (devices) and validates:
    - **Convergence:** Concurrent metadata updates from different instances merge correctly.
    - **History:** CFI ranges from different instances are unioned in the shared `Y.Array`.
    - **Persistence:** Data survives service re-instantiation.

**Findings:**
- **Compaction:** While the plan called for periodic `Y.encodeStateAsUpdate`, `y-indexeddb` handles incremental updates efficiently. A `compact()` method was added to the service to return the current snapshot size, but manual replacement of the persistence layer was not necessary for basic functionality.
- **Testing Strategy:** Automated tests proved far more effective than a manual debug view for verifying convergence scenarios and ensuring no "split-brain" timestamp issues.
Design Document: CRDT Phase 2 - Gradual Data Migration & Store Refactor
=======================================================================

**Target:** Refactor the "Moral Layer" from direct IndexedDB writes to a reactive Yjs-driven architecture through four controlled subphases. This phase moves the "Source of Truth" from a traditional database model to a distributed operation log, ensuring zero data loss and maintaining high performance on Newark-Mountain View commutes.

Phase 2A: The Shunt (Infrastructure & Dual-Source Ready)
--------------------------------------------------------

Phase 2A establishes the coexistence of the legacy and CRDT systems. We prepare the stores to handle two sources of truth simultaneously and disable legacy automatic persistence that would conflict with Yjs's own persistence layer.

### 2A.1 Store Persistence Decommissioning & Bridging

**Audit Finding:** `useSyncStore` and `useUIStore` currently rely on Zustand's `persist` middleware, which targets `localStorage`.

-   **The Problem:** Ripping out `persist` will cause an immediate "First Run" state for users. We must avoid a scenario where a user's Google Drive credentials or theme preferences vanish upon upgrade.

-   **Transition Detail:** Implement a `LegacyStorageBridge` utility.

    -   **Function:** `migrateLocalStorageToState()`.

    -   **Logic:** On application startup, before any CRDT initialization, this function reads known keys (e.g., `versicle-ui-storage`, `versicle-sync-config`) from `localStorage`.

    -   **Data Mapping:** It maps these stringified JSON objects into the typed structures of the new `Y.Doc`. For example, the `theme` key in the UI store moves to a `Y.Map` value.

    -   **The "Burn" Sequence:** Only after the values are safely in memory and the first Yjs transaction is confirmed as persisted to IndexedDB, the bridge executes `localStorage.removeItem()` to prevent stale data conflicts on subsequent reloads.

-   **Keys to Migrate:**

    -   `useUIStore`: `theme`, `fontSize`, `lineHeight`, `fontFamily`, `margin`, `textAlign`.

    -   `useSyncStore`: `googleDriveConfig`, `autoSyncEnabled`.

### 2A.2 The `PersistenceShunt` Proxy (DBService Refactor)

**Transition Detail:** Refactor `src/db/DBService.ts` to implement a branching strategy for all "Moral" layer writes.

-   **Implementation:** Add a private `_mode: 'legacy' | 'shadow' | 'crdt'` variable to the `DBService` class, controlled by a feature flag in `app_metadata`.

-   **Function Refactor: `updateBookMetadata(id, updates)`**:

    -   **Logic:**

        -   If `mode === 'legacy'`: Perform standard `db.put('books', ...)`.

        -   If `mode === 'shadow'`: Perform the legacy write, then call `ydoc.getMap('books').get(id).set(...)`. This allows us to compare IndexedDB records with CRDT state in the `sync_log`.

        -   If `mode === 'crdt'`: Perform only the Yjs write. Standard stores become read-only caches or are cleared entirely.

-   **Function Refactor: `deleteBook(id)`**:

    -   **Critical Sequence:** The "Heavy Layer" (EPUB binaries) is not part of the CRDT. The refactored function must always call `db.delete('files', id)` first to free up IndexedDB space. Metadata deletion in the `books` map follows the shunt logic.

### 2A.3 The Hydration Guard & UI Stability

-   **Component:** Create a `HydrationGuard` wrapper for `App.tsx`.

-   **Technical Detail:** The Tesla Model 3 browser often experiences high latency when opening IndexedDB connections. The guard subscribes to the `y-indexeddb` provider's `synced` event.

-   **User Experience:** While `synced === false`, the guard returns a themed `Loading` spinner. This prevents the "Ghost Library" bug where a user sees an empty library because the UI rendered before the Yjs binary operation log was parsed and merged into memory.

Phase 2B: Decoupling & Reactive Wrappers
----------------------------------------

In this subphase, we break the direct link between Zustand and IndexedDB, moving to an observer-driven architecture where stores react to storage changes rather than commanding them.

### 2B.1 The `YjsObserverService` (The Reactive Bridge)

**Minutia:** Mapping Yjs binary events to specific Zustand actions without creating infinite loops.

-   **Implementation:** `yDoc.observeDeep((events) => { ... })`.

-   **Recursive Prevention (The Origin Guard):**

    -   Every store action that writes to storage must use `ydoc.transact(() => { ... }, 'zustand_internal')`.

    -   The observer checks `event.transaction.origin === 'zustand_internal'`. If true, it returns immediately because the local state is already "optimistically" correct.

    -   If origin is `remote` (e.g., from another tab or device sync), the observer calls `store.setState()`.

-   **Performance Detail:** Use `fast-deep-equal` on the `books` map. In memory-constrained environments, React re-renders are expensive. We must not trigger a re-render if the only change was a metadata field not currently visible (e.g., an internal `lastUpdated` timestamp).

### 2B.2 Refactoring `useReaderStore.saveLocation`

**Audit Finding:** `saveLocation` is the most high-frequency function in Versicle, triggered on every scroll movement and TTS sentence boundary.

-   **Transition Detail:** Refactor the internal `saveProgress` action to bifurcate state:

    -   **Local UI State:** Updates the `currentCfi` in Zustand immediately (unthrottled) for smooth UI highlighting and progress bar movement.

    -   **Moral Checkpoint:** Throttles the write to the `Y.Doc` using a 60-second debounce window (using `lodash.debounce` or similar). This ensures that while the user reads 100 sentences, only one binary operation is written to the CRDT log, preventing catastrophic database bloat and maintaining sync performance over Tesla's LTE connection.

Phase 2C: Selective Hydration (The "Warm-Up")
---------------------------------------------

We migrate low-risk, low-frequency data first to verify the pipeline under real-world conditions.

### 2C.1 Hydrating `lexicon` and `reading_list`

-   **`DBService.getAllLexiconRules()`**:

    -   **Ordering Logic:** Legacy rules are stored in a flat IndexedDB store. Migration must push rules to a `Y.Array`. We must preserve the integer `order` property to maintain TTS pronunciation precedence (e.g., "U.S." should be replaced before "US").

-   **`ReadingListEntry` Key Refactor**:

    -   **Problem:** Legacy keys are filenames (e.g., `alice.epub`). Period characters and spaces in keys can break some nested `Y.Map` path lookups.

    -   **Transition Action:** Migration will map these entries to the internal `bookId` (UUID) as the primary key in the CRDT `readingList` map, effectively decoupling the reading list from the filesystem.

### 2C.2 Hydrating `annotations` (The Map Test)

-   **`DBService.getAnnotations(bookId)`**:

    -   **Minutia:** Transition from `db.getAll('annotations')` to a `Y.Map<UUID, Annotation>`.

-   **UI Integration Detail:** The `AnnotationList.tsx` component currently expects a pre-sorted array. Since `Y.Map` is unordered, the `YjsObserverService` must implement a "Computed Snapshot" logic that extracts map values and sorts them by the `created` timestamp before updating the Zustand store. This prevents the annotations from "jumping around" in the UI after a sync.

Phase 2D: The Final Cutover (History & Progress)
------------------------------------------------

The most delicate part: migrating high-frequency data and decommissioning the legacy write-paths.

### 2D.1 `ReadingHistory` Compression & Hydration

-   **Audit Finding:** `reading_history` is a high-volume list of segments and sessions.

-   **Transition Detail:** Before writing legacy data to the `Y.Array` in the CRDT, it must be processed via `src/lib/cfi-utils.ts:mergeCfiRanges`.

-   **Rationale:** A user might have thousands of granular "scroll-based" sessions. This step compresses them into unified ranges, ensuring the permanent CRDT operation log remains small enough to sync quickly.

-   **Atomic Swap:** Once hydration is verified, flip the `persistenceMode` to `'crdt'`. All Moral-layer methods in `DBService` (metadata, history, annotations) are now redirected solely to Yjs operations.

### 2.D2 Ingestion Pipeline Refactor (`ingestEpub`)

**Audit Finding:** `src/lib/batch-ingestion.ts` currently performs a single `db.transaction(['books', 'files'], 'readwrite')` to ensure metadata and files stay in sync.

-   **The Conflict:** Yjs operations are synchronous in memory but eventually consistent in persistence, and they cannot participate in browser-level IndexedDB transactions.

-   **CRDT Transition Detail:** Refactor the flow into a **Sequential Heavy-then-Moral** pattern:

    1.  Execute `db.put('files', blob)`.

    2.  Await the `complete` event of the transaction.

    3.  Call `useLibraryStore.actions.addBookMetadata(...)` which executes the Yjs write.

-   **Implications:** This decoupling prevents "Ghost Books" where a book appears in the library (metadata in CRDT) but has no content (file write failed). It also simplifies error handling: if step 1 fails, we never clutter the CRDT log.

Risks & Mitigations (Function-Level)
------------------------------------

### 2.R1 The "Partial Ingestion" Orphan

If the browser crashes or the user closes the tab between the file write and the Yjs metadata write.

-   **Mitigation:** Implement `MaintenanceService.cleanupOrphanedFiles()`. This function, scheduled for Phase 4, will identify any entry in the `files` store that lacks a corresponding entry in the Yjs `books` map and delete the orphaned binary data to save storage space.

### 2.R2 TTS Progress Drift during Cutover

**Audit Finding:** `AudioPlayerService` updates `lastPlayedCfi` in the background every few seconds.

-   **Mitigation:** During the Phase 2D cutover window, the app must execute an `atomicPause()`. This flushes the final `lastPlayedCfi` to legacy storage, stops the `AudioContext`, completes the CRDT hydration, and then resumes playback using the new CRDT-driven state as the start position.

### 2.R3 Main Thread "Freezing" on Tesla

Hydrating a library with hundreds of books and thousands of annotations can block the main thread.

-   **Mitigation:** The `MigrationService` hydration loop must use `requestIdleCallback` with a `timeout: 2000`. We will process data in batches of 20 items per frame. This ensures the browser remains responsive to "Stop" or "Back" commands even while moving the entire database into the CRDT log.
## Phase 2A Execution Report (Deviations & Findings)

**Status:** Phase 2A Complete.

**Implementation Summary:**
- **The Shunt (Infrastructure):**
    - `src/db/DBService.ts` was refactored to support three modes: `'legacy'`, `'shadow'`, and `'crdt'`.
    - `updateBookMetadata` writes to both IndexedDB and Yjs (CRDT) when in 'shadow' mode.
    - `deleteBook` was split: it always deletes "Heavy Layer" assets (files, locations, TTS content) from IndexedDB, but delegates "Moral Layer" (metadata, annotations) deletion to the Shunt logic.
    - `addBook` was updated to perform a "Double Write" in 'shadow' mode: first to IndexedDB via `processEpub`, then transacting the metadata into the Yjs `books` map.
- **Legacy Migration:**
    - `LegacyStorageBridge` was implemented to inspect `localStorage` for `reader-storage` and `sync-storage`.
    - It maps these legacy keys (e.g., `currentTheme`, `googleClientId`) to a new `settings` Y.Map in the CRDT doc.
    - A unit test suite (`LegacyStorageBridge.test.ts`) verifies this migration logic.
- **Hydration Guard:**
    - A `HydrationGuard` component wraps the application in `App.tsx`.
    - It initializes the `CRDTService`, injects it into `DBService`, and sets the mode to `'shadow'`.
    - It blocks rendering until `y-indexeddb` signals `synced`, ensuring no "Ghost Library" issues.
- **Schema Update:**
    - Added `SETTINGS: 'settings'` to `CRDT_KEYS` in `types.ts` to accommodate global settings migration.

**Findings & Deviations:**
- **Global Settings in CRDT:** The original plan did not explicitly define where global settings (theme, sync config) should live in the Y.Doc. We established a top-level `settings` map for this purpose.
- **Shadow Mode Complexity:** Implementing "Shadow Mode" for `addBook` required reading back the metadata from IndexedDB immediately after ingestion to populate the CRDT. This ensures the CRDT has the full initial state, including cover thumbnails (which are currently treated as metadata).
- **Singleton Injection:** To avoid circular dependencies and complex rewiring, `CRDTService` is instantiated as a singleton and injected into `DBService` at runtime via `HydrationGuard`. This serves as a pragmatic bridge before a full dependency injection system or store refactor.

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

## Phase 2A Execution Report (Deviations & Findings)

**Status:** Phase 2A Complete.

**Implementation Summary:**
- **The Shunt:** `DBService` now supports `'legacy' | 'shadow' | 'crdt'` modes. 'Shadow' mode implements dual-writing to IndexedDB and Yjs for `addBook` and `updateBookMetadata`.
- **Legacy Storage Bridge:** A new `LegacyStorageBridge` migrates local storage keys (like theme and sync settings) to a new `settings` map in the Yjs doc.
- **Hydration Guard:** The app is now wrapped in a `HydrationGuard` that ensures the CRDT layer is synced with IndexedDB before rendering.

**Findings:**
- **Global Settings:** We introduced a new top-level `settings` map in the `Y.Doc` to handle global app state, which was not explicitly defined in the original schema.
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

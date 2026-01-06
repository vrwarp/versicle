Design Document: CRDT Phase 2 - Gradual Data Migration & Store Refactor

Target: Refactor the "Moral Layer" from direct IndexedDB writes to a reactive Yjs-driven architecture through four controlled subphases. This phase moves the "Source of Truth" from a traditional database model to a distributed operation log, ensuring zero data loss and maintaining high performance on Newark-Mountain View commutes.

Phase 2A: The Shunt (Infrastructure & Dual-Source Ready)

Phase 2A establishes the coexistence of the legacy and CRDT systems. We prepare the stores to handle two sources of truth simultaneously and disable legacy automatic persistence that would conflict with Yjs's own persistence layer.

2A.1 Store Persistence Decommissioning & Bridging

Audit Finding: useSyncStore and useUIStore currently rely on Zustand's persist middleware, which targets localStorage.

The Problem: Ripping out persist will cause an immediate "First Run" state for users. We must avoid a scenario where a user's Google Drive credentials or theme preferences vanish upon upgrade.

Transition Detail: Implement a LegacyStorageBridge utility.

Function: migrateLocalStorageToState().

Logic: On application startup, before any CRDT initialization, this function reads known keys (e.g., versicle-ui-storage, versicle-sync-config) from localStorage.

Data Mapping: It maps these stringified JSON objects into the typed structures of the new Y.Doc. For example, the theme key in the UI store moves to a Y.Map value.

The "Burn" Sequence: Only after the values are safely in memory and the first Yjs transaction is confirmed as persisted to IndexedDB, the bridge executes localStorage.removeItem() to prevent stale data conflicts on subsequent reloads.

Keys to Migrate:

useUIStore: theme, fontSize, lineHeight, fontFamily, margin, textAlign.

useSyncStore: googleDriveConfig, autoSyncEnabled.

2A.2 The PersistenceShunt Proxy (DBService Refactor)

Transition Detail: Refactor src/db/DBService.ts to implement a branching strategy for all "Moral" layer writes.

Implementation: Add a private _mode: 'legacy' | 'shadow' | 'crdt' variable to the DBService class, controlled by a feature flag in app_metadata.

Function Refactor: updateBookMetadata(id, updates):

Logic:

If mode === 'legacy': Perform standard db.put('books', ...).

If mode === 'shadow': Perform the legacy write, then call ydoc.getMap('books').get(id).set(...). This allows us to compare IndexedDB records with CRDT state in the sync_log.

If mode === 'crdt': Perform only the Yjs write. Standard stores become read-only caches or are cleared entirely.

Function Refactor: deleteBook(id):

Critical Sequence: The "Heavy Layer" (EPUB binaries) is not part of the CRDT. The refactored function must always call db.delete('files', id) first to free up IndexedDB space. Metadata deletion in the books map follows the shunt logic.

2A.3 The Hydration Guard & UI Stability

Component: Create a HydrationGuard wrapper for App.tsx.

Technical Detail: The Tesla Model 3 browser often experiences high latency when opening IndexedDB connections. The guard subscribes to the y-indexeddb provider's synced event.

User Experience: While synced === false, the guard returns a themed Loading spinner. This prevents the "Ghost Library" bug where a user sees an empty library because the UI rendered before the Yjs binary operation log was parsed and merged into memory.

Phase 2B: Decoupling & Reactive Wrappers

In this subphase, we break the direct link between Zustand and IndexedDB, moving to an observer-driven architecture where stores react to storage changes rather than commanding them.

2B.1 The YjsObserverService (The Reactive Bridge)

Minutia: Mapping Yjs binary events to specific Zustand actions without creating infinite loops.

Implementation: yDoc.observeDeep((events) => { ... }).

Recursive Prevention (The Origin Guard):

Every store action that writes to storage must use ydoc.transact(() => { ... }, 'zustand_internal').

The observer checks event.transaction.origin === 'zustand_internal'. If true, it returns immediately because the local state is already "optimistically" correct.

If origin is remote (e.g., from another tab or device sync), the observer calls store.setState().

Performance Detail: Use fast-deep-equal on the books map. In memory-constrained environments, React re-renders are expensive. We must not trigger a re-render if the only change was a metadata field not currently visible (e.g., an internal lastUpdated timestamp).

2B.2 Refactoring useReaderStore.saveLocation

Audit Finding: saveLocation is the most high-frequency function in Versicle, triggered on every scroll movement and TTS sentence boundary.

Transition Detail: Refactor the internal saveProgress action to bifurcate state:

Local UI State: Updates the currentCfi in Zustand immediately (unthrottled) for smooth UI highlighting and progress bar movement.

Moral Checkpoint: Throttles the write to the Y.Doc using a 60-second debounce window (using lodash.debounce or similar). This ensures that while the user reads 100 sentences, only one binary operation is written to the CRDT log, preventing catastrophic database bloat and maintaining sync performance over Tesla's LTE connection.

Phase 2C: Selective Hydration (The "Warm-Up")

We migrate low-risk, low-frequency data first to verify the pipeline under real-world conditions.

2C.1 Hydrating lexicon and reading_list

DBService.getAllLexiconRules():

Ordering Logic: Legacy rules are stored in a flat IndexedDB store. Migration must push rules to a Y.Array. We must preserve the integer order property to maintain TTS pronunciation precedence (e.g., "U.S." should be replaced before "US").

ReadingListEntry Key Refactor:

Problem: Legacy keys are filenames (e.g., alice.epub). Period characters and spaces in keys can break some nested Y.Map path lookups.

Transition Action: Migration will map these entries to the internal bookId (UUID) as the primary key in the CRDT readingList map, effectively decoupling the reading list from the filesystem.

2C.2 Hydrating annotations (The Map Test)

DBService.getAnnotations(bookId):

Minutia: Transition from db.getAll('annotations') to a Y.Map<UUID, Annotation>.

UI Integration Detail: The AnnotationList.tsx component currently expects a pre-sorted array. Since Y.Map is unordered, the YjsObserverService must implement a "Computed Snapshot" logic that extracts map values and sorts them by the created timestamp before updating the Zustand store. This prevents the annotations from "jumping around" in the UI after a sync.

Phase 2D: The Final Cutover (History & Progress)

The most delicate part: migrating high-frequency data and decommissioning the legacy write-paths.

2D.1 ReadingHistory Compression & Hydration

Audit Finding: reading_history is a high-volume list of segments and sessions.

Transition Detail: Before writing legacy data to the Y.Array in the CRDT, it must be processed via src/lib/cfi-utils.ts:mergeCfiRanges.

Rationale: A user might have thousands of granular "scroll-based" sessions. This step compresses them into unified ranges, ensuring the permanent CRDT operation log remains small enough to sync quickly.

Atomic Swap: Once hydration is verified, flip the persistenceMode to 'crdt'. All Moral-layer methods in DBService (metadata, history, annotations) are now redirected solely to Yjs operations.

2.D2 Ingestion Pipeline Refactor (ingestEpub)

Audit Finding: src/lib/batch-ingestion.ts currently performs a single db.transaction(['books', 'files'], 'readwrite') to ensure metadata and files stay in sync.

The Conflict: Yjs operations are synchronous in memory but eventually consistent in persistence, and they cannot participate in browser-level IndexedDB transactions.

CRDT Transition Detail: Refactor the flow into a Sequential Heavy-then-Moral pattern:

Execute db.put('files', blob).

Await the complete event of the transaction.

Call useLibraryStore.actions.addBookMetadata(...) which executes the Yjs write.

Implications: This decoupling prevents "Ghost Books" where a book appears in the library (metadata in CRDT) but has no content (file write failed). It also simplifies error handling: if step 1 fails, we never clutter the CRDT log.

Risks & Mitigations (Function-Level)

2.R1 The "Partial Ingestion" Orphan

If the browser crashes or the user closes the tab between the file write and the Yjs metadata write.

Mitigation: Implement MaintenanceService.cleanupOrphanedFiles(). This function, scheduled for Phase 4, will identify any entry in the files store that lacks a corresponding entry in the Yjs books map and delete the orphaned binary data to save storage space.

2.R2 TTS Progress Drift during Cutover

Audit Finding: AudioPlayerService updates lastPlayedCfi in the background every few seconds.

Mitigation: During the Phase 2D cutover window, the app must execute an atomicPause(). This flushes the final lastPlayedCfi to legacy storage, stops the AudioContext, completes the CRDT hydration, and then resumes playback using the new CRDT-driven state as the start position.

2.R3 Main Thread "Freezing" on Tesla

Hydrating a library with hundreds of books and thousands of annotations can block the main thread.

Mitigation: The MigrationService hydration loop must use requestIdleCallback with a timeout: 2000. We will process data in batches of 20 items per frame. This ensures the browser remains responsive to "Stop" or "Back" commands even while moving the entire database into the CRDT log.

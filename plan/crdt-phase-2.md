Design Document: CRDT Phase 2 - Data Migration & Store Integration
==================================================================

**Target:** Execute a non-destructive migration from legacy IndexedDB stores to the Yjs "Moral Doc" and refactor Zustand stores to become reactive Yjs observers.

1\. Migration Minutia: The Hydration Service
--------------------------------------------

We cannot simply "import" data. We must bridge the gap between static IndexedDB records and an event-based log.

### 1.1 Detection Logic

The system must determine if a migration is needed without relying on a brittle version number.

-   **Condition:** `y-indexeddb` has 0 blocks AND the primary `books` store has > 0 records.

-   **Locking:** We must set a `MIGRATION_IN_PROGRESS` flag in `app_metadata` to prevent partial hydration if the user refreshes during the process.

### 1.2 The One-Way Valve

Migration will happen in a strict sequential order to maintain referential integrity:

1.  **Books Metadata:** Populate `yDoc.getMap('books')`.

2.  **Reading History:** Convert `ReadingHistoryEntry` arrays into `Y.Array` instances within the `history` map.

3.  **Annotations:** Push legacy array to `Y.Array`.

4.  **Lexicon:** Map current rules to the ordered `lexicon` `Y.Array`.

5.  **Transient State:** Copy `tts_position` to the `transient` map.

### 1.3 Validation & Checkpoint

Before a single byte is written to the `Y.Doc`, a full legacy backup (v1 JSON manifest) is created and stored in the `checkpoints` store as `pre-crdt-migration-backup`.

2\. Store Refactor: The "Observer" Pattern
------------------------------------------

Our current Zustand stores (e.g., `useLibraryStore`) pull from IndexedDB and push to IndexedDB. In v2, they will instead "wrap" the Yjs types.

### 2.1 The Two-Way Binding

-   **Yjs → Zustand (Incoming):** We use `yDoc.observeDeep((events) => { ... })`. When Yjs updates (locally or via future sync), we compute the new state and call the Zustand `set()` function.

-   **Zustand → Yjs (Outgoing):** Store actions (like `addAnnotation`) will no longer call `db.put`. They will call `yArray.push()`.

### 2.2 Handling Proxies

Yjs types are live objects. We must ensure we only store **serializable snapshots** in the Zustand state to prevent React from attempting to proxy a Yjs proxy, which leads to massive performance degradation.

3\. Data Integrity Minutia: Conflict Resolution in Phase 2
----------------------------------------------------------

Even though Phase 2 is "Local," multiple tabs constitute a distributed system.

### 3.1 The "Tab War" Scenario

If a user has two Versicle tabs open during migration:

-   **Tab A** starts migration.

-   **Tab B** is still writing to legacy IndexedDB.

-   **Mitigation:** Tab A must emit a `BroadcastChannel` message: `CRDT_MIGRATION_STARTED`. Tab B must immediately freeze all writes and show a "Database Upgrading" overlay.

### 3.2 CFI Re-Normalization

Legacy CFI ranges in `reading_history` might be messy. During hydration, we will pass every range through `src/lib/cfi-utils.ts` to ensure the Yjs log starts with a "clean" state.

4\. Performance: The "Write-Heavy" Problem
------------------------------------------

Zustand and React are optimized for discrete state changes. Yjs updates can be extremely granular (one character at a time).

### 4.1 Transaction Batching

We will wrap all multi-step updates in `ydoc.transact(() => { ... })`.

-   *Rationale:* This ensures that a "Batch Add" of 50 annotations only triggers **one** Zustand state update and **one** IndexedDB write, preventing UI stutter.

5\. Phase 2 Checklist (The "Safe-to-Ship")
------------------------------------------

1.  $$$$

    Implement `MigrationService.ts` with "Legacy → CRDT" mapping logic.

2.  $$$$

    Add `ydoc.observeDeep` to `useLibraryStore`.

3.  $$$$

    Refactor `useReaderStore` to update `yMap('books').get(id).set('progress')`.

4.  $$$$

    Verify "Multi-Tab Lockdown" during migration.

5.  $$$$

    Stress Test: Migrate a library with 500 books and 2,000 annotations. Measure hydration time (Goal: < 2s).

6\. Risks & Mitigations
-----------------------

### 6.1 Partial Hydration

If the browser crashes during the `Y.Array` push, the user might lose half their annotations.

-   **Mitigation:** We will use a `migration_status` key. If it isn't `COMPLETED`, the system will wipe the CRDT doc and restart the migration on the next boot.

### 6.2 Recursive Observation Loops

Zustand update -> Yjs update -> Yjs Observer -> Zustand update.

-   **Mitigation:** We will use the `transaction.origin` property in the Yjs observer. If the origin is `zustand-internal`, the observer will ignore the event to prevent infinite loops.

### 6.3 Schema Drifts

If the `Annotation` interface changes in the code but not in the hydration logic, we sync garbage.

-   **Mitigation:** The `MigrationService` will share the same `Validator` functions used in `src/db/validators.ts` to "wash" data before it enters the CRDT.

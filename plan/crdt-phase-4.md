Design Document: CRDT Phase 4 - Final Stabilization & Legacy Deletion
=====================================================================

**Target:** Permanently decommission legacy IndexedDB stores, optimize CRDT garbage collection, and finalize the hardened recovery infrastructure.

1\. Decommissioning Minutia: "Burning the Ships"
------------------------------------------------

Once Phase 3 has been live for a sufficient period (the "Soak Period"), we must remove the legacy code paths to prevent technical debt and database bloat.

### 1.1 The Definitive Deletion

On first boot of Phase 4, after verifying a successful CRDT load:

-   **Target Stores:** `books`, `annotations`, `lexicon`, `reading_history`, `reading_list`, `tts_position`.

-   **Execution:** Iterate through each store and call `db.clear()`.

-   **Schema Update:** Increment IndexedDB version to v17 and remove the object stores from the `initDB` logic entirely.

### 1.2 Binary Files Preservation

Crucially, the `files` (EPUB binaries), `tts_cache`, and `table_images` stores are **NOT** deleted. These remain in the primary `idb` instance as they are not part of the "Moral Layer" CRDT.

2\. Recovery Minutia: Hardened Rollback
---------------------------------------

Since we no longer have standard database records to "peek" at, the recovery system must be entirely based on binary snapshots.

### 2.1 The "Time Travel" Interface

Refactor the "Recovery" tab in `GlobalSettingsDialog` to support:

-   **Snapshot Inspection:** Metadata-only preview of what is inside a `SyncCheckpoint` (e.g., "This snapshot has 42 books and was created on Device: Tesla_M3").

-   **Partial Restore:** Ability to pluck a single book's metadata or a specific lexicon rule from a historical binary snapshot without overwriting the entire current state.

### 2.2 The "Emergency Reset" (The Red Button)

A hidden UI sequence (e.g., triple-tap on the version number) that:

1.  Wipes the `y-indexeddb` update log.

2.  Deletes the remote `root_state.bin` from Google Drive.

3.  Allows the user to start a "Fresh Moral Layer" while keeping their local EPUB files intact.

3\. Performance Minutia: Compaction & Pruning
---------------------------------------------

Over time, the Yjs update log can contain redundant operations (e.g., 5,000 updates to the same `progress` field).

### 3.1 Local Log Compaction

Implement a background "Janitor" service:

-   **Trigger:** If `y-indexeddb` block count > 1,000.

-   **Action:** Call `Y.encodeStateAsUpdate(ydoc)`, write this single block to a new store, then delete all 1,000 individual blocks.

-   **Efficiency:** This reduces initial load time from seconds to milliseconds for high-frequency users.

### 3.2 Knowledge Pruning

Yjs retains "Deleted" item metadata for conflict resolution (ghost markers).

-   **Action:** Periodically run `Y.cleanup(ydoc)` to remove markers from items that were deleted more than 30 days ago (once all devices have likely merged the deletion).

4\. Multi-Tenant Minutia (Tesla Optimization)
---------------------------------------------

For the Tesla browser, which has extremely aggressive memory management and often clears caches:

### 4.1 "Cold Boot" Optimization

If IndexedDB is cleared by the car OS:

1.  Phase 4 logic detects a "Naked Boot" (no files, no CRDT).

2.  Handshake with Google Drive immediately downloads `root_state.bin`.

3.  The UI shows a "Restoring your library..." progress bar before allowing any interaction. This ensures the user never sees an empty library and "accidentally" starts creating duplicate data.

5\. Phase 4 Checklist (The Final Sign-off)
------------------------------------------

1.  [ ] Remove `SyncManager.ts` (Legacy) and all references to `mergeCfiRanges` as a sync-time utility.

2.  [ ] Implement the "Janitor" background compaction service.

3.  [ ] Finalize the "Snapshot Inspector" in the Recovery UI.

4.  [ ] Verify that v17 migration successfully clears the legacy stores.

5.  [ ] Stress Test: Rapidly open/close Versicle in multiple tabs while a heavy compaction is running.

6\. Risks & Mitigations
-----------------------

### 6.1 The "Late Migrator" Risk

A user hasn't opened Versicle since Phase 1. They jump straight to Phase 4.

-   **Mitigation:** We will keep a "Migration Stub" in the code. If v17 detects data in the legacy stores, it runs the Phase 2 hydration logic one last time before clearing them.

### 6.2 Compaction Corruption

If the browser crashes mid-compaction, the user loses the entire "Moral Layer."

-   **Mitigation:** The Janitor service uses a "Shadow Write" pattern. It writes the compacted block to a temporary key, verifies it can be parsed, and only then deletes the fragmented logs.

### 6.3 State Vector Bloat

As the number of unique device IDs in the CRDT grows, the state vector used for sync grows.

-   **Mitigation:** Device Registry cleanup. Any device not seen for 90 days has its operations "squashed" into a generic `legacy_device` ID during the Cloud Consolidation process.

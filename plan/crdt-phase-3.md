Design Document: CRDT Phase 3 - Cloud Binary Delta Sync
=======================================================

**Target:** Refactor the `SyncOrchestrator` to exchange Yjs binary update blocks via Google Drive, moving away from JSON manifests to achieve true mathematical convergence across high-latency devices.

1\. Transport Minutia: From Manifests to Deltas
-----------------------------------------------

In the legacy system, we uploaded a single `sync_manifest.json`. In Phase 3, we move to a "State Vector" handshake protocol.

### 1.1 The Handshake Protocol

1.  **State Vector Fetch:** The client fetches the current `remote_state_vector.bin` from the user's Google Drive. This is a tiny binary file (~sub-KB) describing the remote's knowledge (logical clock positions).

2.  **Diff Generation:** The client calculates the local diff using `Y.encodeStateAsUpdate(localDoc, remoteStateVector)`. This contains *only* the bytes the remote is missing.

3.  **The Atomic Push:** The client uploads the diff to a `pending_updates/` folder as a unique file (e.g., `${deviceId}_${timestamp}.delta`).

4.  **The Merge (Brokerless):** On the next fetch, every device reads all files in `pending_updates/`, applies them locally using `Y.applyUpdate`.
    *   **Reactivity:** Because our stores are bound via `zustand-middleware-yjs` (Phase 2), `Y.applyUpdate` immediately updates the `Y.Doc`. This triggers the middleware, which automatically updates the React state. No manual dispatch is required.

2\. Storage Minutia: Cloud Log Management
-----------------------------------------

Unlike IndexedDB, Google Drive API calls are expensive and rate-limited. We cannot treat it as a live socket.

### 2.1 The "Shadow Update" Strategy

To optimize for the Tesla browser's erratic connection, we will implement a two-tier push:

-   **Tier 1 (High Frequency):** Write tiny delta files to `appDataFolder`.

-   **Tier 2 (Snapshot):** Every 24 hours, or when the number of delta files exceeds 50, the "Primary Device" (the one with the most recent logical clock) will perform a **Cloud Consolidation**. It merges all deltas into a single `root_state.bin` and deletes the old delta files.

3\. The "Split-Brain" Resolution
--------------------------------

Because we lack a central server, we must handle the scenario where Device A and Device B both try to "Snapshot" the cloud log simultaneously.

### 3.1 Conflict-Free Snapshotting

-   **Logic:** Snapshots are written as new files with a version suffix.

-   **Tie-breaking:** If Device A and B both create `root_state_v12.bin`, the client will fetch both, call `Y.applyUpdate` for both, and then continue. Yjs is designed to handle redundant updates gracefully (they are idempotent).

4\. Minutia: Bandwidth & Binary Compression
-------------------------------------------

Binary update blocks are already compact, but for large libraries with extensive reading history, the logical clock overhead can add up.

### 4.1 V2 Encoding

We will use Yjs **V2 Encoding** (`Y.encodeStateAsUpdateV2`).

-   *Rationale:* V2 is optimized for even smaller footprints and is significantly faster to parse on low-powered mobile devices. This is critical for keeping the "instant handoff" feel while on a 4G/LTE car connection.

5\. Security & Validation (The "Deep Defense")
----------------------------------------------

A single corrupt binary block synced from the cloud could break every connected device.

### 5.1 Pre-Application Verification

Before `Y.applyUpdate(remoteBlob)` is called, the binary blob is checked:

1.  **Checksum:** Validate the CRC32 of the block.

2.  **Dry Run:** Apply the update to a *temporary* in-memory `Y.Doc`.

3.  **Schema Check:** Run `src/db/validators.ts` on the temporary doc.

4.  **Commit:** Only if the dry run is valid is the update applied to the primary "Moral Doc."

6\. Phase 3 Checklist (The "Convergence Test")
----------------------------------------------

1.  [ ] Refactor `GoogleDriveProvider.ts` to support binary upload/download.

2.  [ ] Implement the `StateVector` handshake logic in `SyncOrchestrator`.

3.  [ ] Build the "Cloud Compactor" service to periodically consolidate deltas.

4.  [ ] Implement "Ejection Logic": If a device's logical clock is > 10,000 steps behind, force a full `root_state.bin` redownload rather than a delta sync.

5.  [ ] Stress Test: Simulate two devices offline for 1 hour, performing concurrent annotations, and verify merge on reconnection.

7\. Risks & Mitigations
-----------------------

### 7.1 Logical Clock Overflow

If a device's clock counter grows too high, it could theoretically cause integer issues or massive state vectors.

-   **Mitigation:** The Phase 3 "Consolidation" process will involve a `Y.encodeStateAsUpdate` without a state vector, which resets the internal structure while preserving the data state, effectively "garbage collecting" the history.

### 7.2 Google Drive API Quota

Fetching 50 tiny delta files might hit API limits.

-   **Mitigation:** We will use the Google Drive `files.list` with a specific query for the `appDataFolder` to get metadata for all deltas in a single request, then batch-fetch the contents only when necessary.

### 7.3 The "Dead Device" Problem

A device that is destroyed or never synced again leaves "holes" in the logical clock understanding.

-   **Mitigation:** We will implement a "Device TTL." Any device not seen in the `deviceRegistry` (shared Yjs type) for > 30 days is ignored during delta calculations to keep the state vector small.

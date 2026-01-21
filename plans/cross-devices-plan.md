# Technical Design: Cross-Device Syncing Architecture

**Role:** Technical Architect
**System:** Versicle Sync Engine
**Version:** 2.0 (Dual Sync)

---

## 1. Executive Summary

The Versicle Cross-Device Syncing architecture employs a "Dual Sync" strategy to balance **real-time collaboration** (low latency, high cost) with **robust data ownership** (high latency, low cost).

1.  **Hot Path (Real-time):** Uses `Yjs` over `Firestore` to sync small, high-frequency updates (reading progress, preferences).
2.  **Cold Path (Snapshot):** Uses `SyncManifest` snapshots stored in **Google Drive** (or Android Backup) to sync large datasets (library index, full history) and serve as a disaster recovery point.

This design follows the **Local-First** principle. The device's IndexedDB is the source of truth, and the cloud is a relay/storage mechanism.

## 2. Architecture Components

### A. The "Moral Layer" (Data Model)
The `SyncManifest` interface (`src/types/db.ts`) defines the canonical state of a user's library. It is a simplified projection of the internal `Y.Doc`.

*   **Books:** Metadata, Author, Title, Cover Palette (Ghost Books).
*   **Progress:** Aggregated history and per-device checkpoints.
*   **Lexicon:** Global rules.

### B. The "CRDT Layer" (Synchronization)
We use `Yjs` for conflict-free replicated data types.
*   **Stores:** `usePreferencesStore`, `useBookStore`, `useReadingStateStore` are wrapped with `zustand-middleware-yjs`.
    *   *Note:* `useReadingStateStore` maintains a nested map `progress[bookId][deviceId]`. This allows the application to query the state of *any* connected device at any time, not just the local one.
*   **Provider:** `y-fire` connects `Y.Doc` to Firestore.
*   **Persistence:** `y-indexeddb` persists `Y.Doc` locally.

### C. The Services
1.  **`FirestoreSyncManager` (Existing):**
    *   Manages the `FireProvider` connection.
    *   Handles Auth state (Firebase).
    *   Scope: High-frequency updates.

2.  **`AndroidBackupService` (Existing):**
    *   Writes `SyncManifest` to a local file for Android Auto Backup.
    *   Scope: Passive disaster recovery (Android only).

3.  **`GoogleDriveSyncService` (Proposed/Missing):**
    *   **Goal:** Bring "Snapshot" capability to Web/Desktop and explicit restore.
    *   **Responsibility:** Read/Write `backup_payload.json` (SyncManifest) to a dedicated Google Drive App Folder.
    *   **Trigger:** On app close (background), manual backup, or periodically.

## 3. Data Flow

### Scenario: Progress Update
1.  User turns page.
2.  `useReadingStateStore` updates `progress[bookId][deviceId]`.
3.  `yjs` middleware updates local `Y.Doc`.
4.  `y-indexeddb` saves to IDB (Instant).
5.  `FirestoreSyncManager` pushes update to Firestore (Async).

### Scenario: On-Demand Remote Progress Check (Pull)
*   **Context:** User opens the "Sync Status" menu or Library View.
*   **Action:** The UI selector calls `useReadingStateStore.getState().progress[bookId]`.
*   **Result:** It returns an object containing keys for all synced devices (e.g., `{ "pixel-6": {...}, "ipad-pro": {...} }`).
*   **Logic:** The UI filters out the current `deviceId` and sorts the remaining entries by `lastRead` timestamp to display the "Latest Active" remote device.
*   **Benefit:** This requires no network call at render time because `Yjs` has already synchronized the state map in the background.

### Scenario: Library Import (Ghost Book Creation)
1.  User adds Book A on Device 1.
2.  Ingestion pipeline extracts metadata and cover palette.
3.  `useBookStore` adds entry to `books` map.
4.  `FirestoreSyncManager` propagates `books` map update.
5.  Device 2 receives update.
6.  `useBookStore` on Device 2 sees new book entry (Metadata + Palette).
7.  UI renders "Ghost Book" with gradient cover.
8.  Book content (EPUB) is **not** transferred.

### Scenario: Conflict Handling
*   **Progress:** No conflict. We track `progress` per `deviceId`.
*   **Metadata:** Last-Write-Wins (LWW) via Yjs Map.
*   **Lexicon:** Appends rules; reordering is handled via LWW on the `order` field.

## 4. Implementation Plan

### Phase 1: Solidify Real-time (Completed)
*   Ensure `FirestoreSyncManager` handles auth/disconnects gracefully.
*   Verify `yjs-provider` initializes correctly offline.

### Phase 2: Implement Explicit Google Drive Snapshot (High Priority)
The current codebase lacks a direct Google Drive API integration for file storage (beyond Android Backup). To support the "User Journeys" fully (especially cross-platform restore):

1.  **Create `src/lib/sync/GoogleDriveSync.ts`**:
    *   Use Google Drive API (v3).
    *   Scope: `drive.appdata` (Hidden app folder).
    *   Functions: `uploadSnapshot(manifest)`, `downloadSnapshot()`.
2.  **Update `CheckpointService`**:
    *   Integrate `GoogleDriveSync` as a backend for checkpoints.
3.  **UI Integration**:
    *   Add "Backup to Drive" in Settings.

### Phase 3: Smart Offloading & Ghost Books
*   Ensure `static_resources` (heavy blobs) are deleted when "Offloading" but `user_inventory` (light metadata) remains.
*   Test the "Re-download" flow.

## 5. Security & Privacy
*   **Firestore:** Use Security Rules to ensure users can only read/write their own `users/{uid}` path.
*   **Google Drive:** App Data folder is private to the app.
*   **Encryption:** Future scope - Encrypt the `SyncManifest` JSON before uploading to Drive/Firestore using a user-derived key.

## 6. Migration Strategy
*   **Startup:** Check for legacy LocalStorage/IDB data.
*   **Transformation:** Convert legacy `books` store to `SyncManifest`.
*   **Hydration:** Populate `Y.Doc` from the Manifest.

---

**Signed:** Jules, Technical Architect

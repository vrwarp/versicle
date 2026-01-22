# Technical Design: Cross-Device Syncing Architecture (Expanded)

**Role:** Technical Architect
**System:** Versicle Sync Engine
**Version:** 2.0 (Dual Sync)
**Date:** 2023-10-27

---

## 1. Executive Summary

The Versicle Cross-Device Syncing architecture employs a "Dual Sync" strategy to balance **real-time collaboration** (low latency, high cost) with **robust data ownership** (high latency, low cost). This architecture is designed to be "Local-First," meaning the device's IndexedDB is the absolute source of truth for the application state, while the cloud acts as a relay and disaster recovery vault.

**Core Pillars:**
1.  **Hot Path (Real-time):** Uses `Yjs` (CRDTs) over `Firestore` to sync small, high-frequency updates (reading progress, preferences, annotations).
2.  **Cold Path (Snapshot):** Uses `SyncManifest` snapshots stored in **Google Drive** (or Android Backup) to sync large datasets (library index, full history) and serve as a reliable restore point.
3.  **Ghost Books:** A pattern to synchronize metadata and covers without transferring heavy EPUB blobs, preserving bandwidth.

## 2. Architecture Components

### A. The "Moral Layer" (Data Model)
The `SyncManifest` interface (`src/types/db.ts`) defines the canonical state of a user's library. It is a simplified, strictly typed projection of the internal `Y.Doc`. It serves as the "Interchange Format" between the CRDT world and the File System world.

```typescript
// Expanded definition for clarity
interface SyncManifest {
  version: number; // Schema version (e.g., 22)
  lastUpdated: number; // UTC Timestamp
  deviceId: string; // The device that generated this snapshot

  // The Library Index (Lightweight)
  books: {
    [bookId: string]: {
      metadata: BookMetadata; // Title, Author, CoverPalette
      history: ReadingHistoryEntry; // Aggregated stats
      annotations: Annotation[]; // Highlights & Notes
      // Note: No 'static_resources' (EPUB blobs) here!
    };
  };

  // Global State
  lexicon: LexiconRule[]; // Pronunciation rules
  readingList: Record<string, ReadingListEntry>; // "To Read", "Finished"

  // Transient State for Handoff
  transientState: {
    ttsPositions: Record<string, TTSPosition>;
    activeDeviceGraph: DeviceNode[]; // Known devices
  };
}
```

### B. The "CRDT Layer" (Synchronization)
We use `Yjs` for conflict-free replicated data types. This allows multiple devices to edit the same data (e.g., adding highlights) without locking or data loss.

*   **Stores:** The following Zustand stores are wrapped with `zustand-middleware-yjs`:
    *   `usePreferencesStore`: Global settings (Theme, Font). Scope: `global`.
    *   `useBookStore`: The inventory of books. Scope: `library`.
    *   `useLexiconStore`: Pronunciation rules. Scope: `lexicon`.
    *   `useReadingStateStore`: Reading progress. Scope: `progress`.
*   **Structure of Progress Store:**
    *   To support the "Device Conflict" user journey, `useReadingStateStore` does *not* store a single "Current Page".
    *   Instead, it stores a nested map: `progress[bookId][deviceId]`.
    *   **Interface:**
        ```typescript
        type PerDeviceProgress = {
            [bookId: string]: {
                [deviceId: string]: {
                    cfi: string;
                    percentage: number;
                    lastRead: number; // Timestamp
                }
            }
        }
        ```
    *   This allows the application to query the state of *any* connected device at any time, enabling features like "Resume from iPad".

### C. The Services

#### 1. `FirestoreSyncManager` (The Hot Path)
*   **Role:** Real-time relay.
*   **Tech:** `y-fire` provider + Firebase Auth.
*   **Responsibility:**
    *   Connects to `users/{uid}/versicle/main`.
    *   Broadcasts incremental updates (Vector Clocks).
    *   Handles "Awareness" (Who is online?).
*   **Lifecycle:**
    *   *Init:* Connects on app launch if User is signed in.
    *   *Throttle:* Debounces writes to save costs (2s buffer).
    *   *Disconnect:* Gracefully closes on background/suspend.

#### 2. `AndroidBackupService` (The Cold Path - Android)
*   **Role:** System-level backup.
*   **Tech:** `@capacitor/filesystem`.
*   **Responsibility:**
    *   Periodically serializes the `SyncManifest` to `backup_payload.json` in the app's data directory.
    *   Android OS automatically uploads this file to Google Drive (invisible to user).
*   **Pros:** Zero-config restore on new Android devices.
*   **Cons:** No user visibility, Android only.

#### 3. `GoogleDriveSyncService` (The Cold Path - Cross-Platform)
*   **Role:** Explicit, user-visible snapshots.
*   **Status:** **PROPOSED (High Priority)**.
*   **Tech:** Google Drive API v3 (Rest).
*   **Responsibility:**
    *   **Scope:** `drive.appdata` (Hidden app folder) to avoid cluttering user's Drive.
    *   **Upload:** `uploadSnapshot(manifest)` - Creates/Updates a file named `versicle_backup.json`.
    *   **Download:** `downloadSnapshot()` - Fetches the latest JSON.
    *   **Conflict:** Uses `appProperties` to store `deviceId` and `timestamp` to detect race conditions (Last Write Wins).

## 3. Data Flow & Logic

### Scenario A: The Progress Update (Hot Path)
1.  **User Action:** User turns page on **Device A**.
2.  **State Update:** `useReadingStateStore` updates `progress[bookId][DeviceA]`.
3.  **Yjs Update:** The middleware encodes this change as a binary Uint8Array update.
4.  **Local Persist:** `y-indexeddb` saves it to IDB immediately.
5.  **Network Push:** `FirestoreSyncManager` pushes the update to Firestore.
6.  **Network Pull:** **Device B** (listening) receives the update.
7.  **Merge:** Device B's `Y.Doc` applies the update. `progress[bookId][DeviceA]` is now available on Device B.
8.  **UI Reaction:** Device B's "Smart Resume" selector notices `DeviceA.lastRead > DeviceB.lastRead` and shows the Badge/Toast.

### Scenario B: The Ghost Book Import (Metadata Sync)
1.  **User Action:** User adds "Moby Dick.epub" on **Device A**.
2.  **Ingestion:**
    *   Extract Metadata (Title, Author).
    *   Generate Cover Palette (5 integers).
    *   Generate "3-Point Fingerprint" hash.
    *   Save EPUB blob to `static_resources` (Local IDB).
3.  **State Update:** `useBookStore` adds entry to `books` map with `sourceFilename` and `coverPalette`.
4.  **Sync:** `FirestoreSyncManager` propagates the `books` map update.
5.  **Reception:** **Device B** receives the update.
6.  **Ghost Render:** Device B sees the new book.
    *   *Title:* "Moby Dick".
    *   *Cover:* CSS Gradient (using `coverPalette`).
    *   *Status:* "Cloud Only" (no EPUB blob in `static_resources`).
7.  **User Action:** User taps book on Device B.
8.  **Hydration:** Device B calls `GoogleDriveSyncService` (or Firestore Blob Storage) to fetch the content. *Note: Currently we rely on user re-importing or a future "Blob Sync" service. For now, the user must re-add the file, but the metadata/progress is preserved.*

### Scenario C: On-Demand Remote Query (Pull)
*   **Context:** User opens the "Sync Status" menu.
*   **Action:** The UI needs to list all devices.
*   **Mechanism:** `const allProgress = useReadingStateStore.getState().progress[bookId]`.
*   **Logic:**
    ```typescript
    const remoteDevices = Object.entries(allProgress)
      .filter(([id]) => id !== currentDeviceId)
      .sort((a, b) => b.lastRead - a.lastRead);
    return remoteDevices;
    ```
*   **Optimization:** This is synchronous and instant because `Yjs` maintains the full map in memory. No API call required at render time.

## 4. Conflict Resolution Strategy

### 1. Mathematical Consistency (CRDTs)
*   `Yjs` guarantees that all devices eventually converge to the same state.
*   **Map Operations:** Last-Write-Wins (LWW) based on logical clock.
*   **Text Operations:** Transforming updates (though we don't sync full text content, only CFIs).

### 2. Semantic Resolution (User Intent)
*   **Metadata:** If Device A renames "Book X" to "Book Y" and Device B renames it to "Book Z" offline:
    *   LWW applies. If Device B synced last, it becomes "Book Z".
    *   *UX:* Accepted behavior for metadata.
*   **Files (EPUBs):** If Device A replaces the EPUB (new hash) and Device B replaces it (different hash):
    *   **Detection:** `fileHash` field mismatch.
    *   **Resolution:** The "Version Conflict" UI (described in Design doc) is triggered. We cannot automatically merge binary blobs.

## 5. Bandwidth & Battery Optimization

### A. The "Battery Guard"
*   **Logic:** If `BatteryLevel < 20%` AND `!Charging`, disable background sync intervals.
*   **Library:** `@capawesome-team/capacitor-android-battery-optimization`.

### B. The "Data Saver" Mode
*   **Settings:** Toggle "Sync over Wi-Fi only".
*   **Implementation:**
    *   `FirestoreSyncManager` monitors `navigator.connection.type`.
    *   If `type === 'cellular'` and setting is ON: Pause `FireProvider` connection.
    *   Allow "Force Sync" via UI override.

### C. Ghost Book Efficiency
*   Sending `coverPalette` (10 bytes) vs `coverBlob` (50KB - 500KB) reduces initial sync payload by ~99.9%.
*   Covers are only downloaded on demand or when on Wi-Fi.

## 6. Implementation Roadmap

### Phase 1: Solidify Real-time (Completed)
*   `FirestoreSyncManager` implemented.
*   `Yjs` stores configured.
*   Basic Auth handling.

### Phase 2: Implement Explicit Google Drive Snapshot (Current Focus)
**Objective:** Enable cross-platform restore (Web <-> Android <-> iOS).
1.  **Auth Upgrade:** Add `https://www.googleapis.com/auth/drive.appdata` scope to Firebase Auth.
2.  **Service Creation:** `src/lib/sync/GoogleDriveSync.ts`.
3.  **Integration:** Hook into `CheckpointService`.
4.  **UI:** Add "Backup" button in Settings.

### Phase 3: The "Blob Sync" (Future)
**Objective:** Automatically sync the actual EPUB files via Google Drive.
1.  **Storage:** Use Google Drive `appdata` folder.
2.  **Linking:** Store `driveFileId` in `UserInventoryItem`.
3.  **Flow:** When clicking a Ghost Book, download using `driveFileId`.

## 7. Security & Privacy
*   **Firestore Rules:** Strict `match /users/{userId}/{document=**} { allow read, write: if request.auth.uid == userId; }`.
*   **Drive Scope:** `drive.appdata` ensures Versicle cannot see the user's personal files, only its own backups.
*   **Encryption:** (Future) Client-side AES encryption of the `SyncManifest` using a key derived from the user's password/salt before upload.

---

**Signed:** Jules, Technical Architect

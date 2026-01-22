# Technical Design: Cross-Device Syncing Architecture (Expanded & Revised)

**Role:** Technical Architect
**System:** Versicle Sync Engine
**Version:** 2.0 (Dual Sync - Firestore/Manual)
**Date:** 2023-10-27

---

## 1. Executive Summary

The Versicle Cross-Device Syncing architecture employs a "Dual Sync" strategy to balance **real-time collaboration** (low latency, high cost) with **robust data ownership** (high latency, low cost).

**Changes from V1:**
*   Removed `GoogleDriveSyncService` dependency entirely to avoid vendor lock-in and complexity.
*   The "Cold Path" is now handled via **Native Android Backup** (on Android) and **Manual JSON Export/Import** (Cross-platform).
*   Firestore usage is optimized for cost and security.

**Core Pillars:**
1.  **Hot Path (Real-time):** Uses `Yjs` (CRDTs) over `Firestore` to sync small, high-frequency updates (reading progress, preferences, annotations).
2.  **Cold Path (Snapshot):** Uses `SyncManifest` snapshots. On Android, this hooks into the OS backup. On Web/Desktop, this relies on user-initiated JSON exports.
3.  **Ghost Books:** A pattern to synchronize metadata and covers without transferring heavy EPUB blobs, preserving bandwidth and storage costs.

## 2. Architecture Components

### A. The "Moral Layer" (Data Model)
The `SyncManifest` interface (`src/types/db.ts`) defines the canonical state of a user's library. It serves as the "Interchange Format" between the CRDT world and the File System world (Exports).

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

### C. The Services

#### 1. `FirestoreSyncManager` (The Hot Path)
*   **Role:** Real-time relay.
*   **Tech:** `y-fire` provider + Firebase Auth.
*   **Responsibility:**
    *   Connects to `users/{uid}/versicle/main`.
    *   Broadcasts incremental updates (Vector Clocks).
*   **Cost Optimization:**
    *   **Debounce:** All writes are buffered for 2000ms.
    *   **Batching:** Up to 500 updates are merged into a single Firestore transaction to minimize "Write Operations" (billing unit).
    *   **Delta Compression:** Only the *diff* of the CRDT state vector is sent, not the full document.

#### 2. `AndroidBackupService` (The Cold Path - Android)
*   **Role:** System-level backup.
*   **Tech:** `@capacitor/filesystem`.
*   **Responsibility:**
    *   Periodically serializes the `SyncManifest` to `backup_payload.json` in the app's data directory.
    *   Android OS automatically uploads this file to Google Drive (invisible to user).
*   **Pros:** Zero-config restore on new Android devices.

#### 3. `ExportImportService` (The Cold Path - Cross-Platform)
*   **Role:** Explicit, user-visible portability.
*   **Responsibility:**
    *   **Export:** Serializes `SyncManifest` to a JSON blob.
        *   *Validation:* Calculates SHA-256 checksum.
        *   *Formatting:* Pretty-printed (optional) or Minified.
    *   **Import:** Parses JSON, validates schema version (migrating v21 -> v22 if needed), and hydrates the `Y.Doc`.
    *   **Merge Logic:** If importing into an existing library, it uses `yDoc.transact` to merge fields intelligently (LWW for scalars, Union for arrays).

## 3. Data Flow & Logic

### Scenario A: The Progress Update (Hot Path)
1.  **User Action:** User turns page on **Device A**.
2.  **State Update:** `useReadingStateStore` updates `progress[bookId][DeviceA]`.
3.  **Yjs Update:** The middleware encodes this change as a binary Uint8Array update.
4.  **Local Persist:** `y-indexeddb` saves to IDB immediately.
5.  **Network Push:** `FirestoreSyncManager` pushes the update to Firestore (Async).
6.  **Network Pull:** **Device B** (listening) receives the update.
7.  **Merge:** Device B's `Y.Doc` applies the update. `progress[bookId][DeviceA]` is now available on Device B.

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
8.  **Hydration:** Device B prompts user to import file. User shares file via AirDrop.
9.  **Match:** App calculates hash of imported file, matches to Ghost Book ID, and saves blob to IDB.

## 4. Security Architecture

### A. Firestore Security Rules
We must enforce strict ownership.

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Only authenticated users can access their own data
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    // Explicitly deny everything else
    match /{document=**} {
      allow read, write: false;
    }
  }
}
```

### B. Encrypted Exports (Future Scope)
To allow safe storage on insecure media (USB drives), the `ExportImportService` could offer an "Encrypt with Password" option using AES-GCM before generating the JSON file.

## 5. Conflict Resolution Matrix

Since we removed the "Master Snapshot" in Drive, Firestore/Yjs is the primary arbiter.

| Data Type | Scenario | Resolution Strategy |
| :--- | :--- | :--- |
| **Progress** | Device A and B read same book offline | **No Conflict.** Stored as `progress[bookId][DeviceA]` and `progress[bookId][DeviceB]`. Merged via Union. |
| **Metadata** | Device A renames book, Device B changes tags | **Merge.** Properties are independent. If both change Title, **LWW** (Last Write Wins) based on logical clock. |
| **Lexicon** | Device A adds Rule 1, Device B adds Rule 2 | **Union.** Both rules are added to the list. |
| **Annotations** | Device A highlights Ch 1, Device B highlights Ch 2 | **Union.** Both highlights appear. |
| **Settings** | Device A sets Dark Mode, Device B sets Light Mode | **LWW.** The last device to sync determines the global setting. |

## 6. Data Portability Specs (JSON Export)

The export format is designed to be machine-readable and partially compatible with other readers (via transformation).

```json
{
  "meta": {
    "exporter": "Versicle",
    "version": "1.2.0",
    "timestamp": "2023-10-27T10:00:00Z"
  },
  "library": [
    {
      "title": "Dune",
      "author": "Frank Herbert",
      "identifiers": { "isbn": "...", "versicleId": "..." },
      "progress": {
        "percentage": 0.45,
        "cfi": "epubcfi(/6/14[...])"
      },
      "annotations": [
        { "text": "Fear is the mind-killer", "cfi": "...", "color": "#ff0000" }
      ]
    }
  ]
}
```

## 7. Implementation Roadmap

### Phase 1: Solidify Real-time (Completed)
*   `FirestoreSyncManager` implemented.
*   `Yjs` stores configured.

### Phase 2: Manual Export/Import (High Priority)
**Objective:** Replace the gap left by removing Google Drive.
1.  **Service:** Create `src/lib/sync/ExportImportService.ts`.
2.  **UI:** Build the "Export Wizard" components.
3.  **Integration:** Hook up "Import" to the `yDoc.transact` API to safely merge external data.

### Phase 3: Android Backup Polish
*   Ensure `AndroidBackupService` writes frequently enough (e.g., `onPause`).
*   Test restore flows on physical devices.

---

**Signed:** Jules, Technical Architect

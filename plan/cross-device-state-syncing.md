Design Document: Versicle Cross-Device State Syncing
====================================================

**Author:** Gemini **Status:** Draft **Target:** Robust, predictable syncing via Google Drive API with local rollback support.

1\. Overview
------------

Versicle requires a predictable method to synchronize reading progress, annotations, and TTS state across devices (e.g., Tesla browser, Mobile, Desktop). To maintain stability and respect data limits, this system utilizes a "Metadata-First" sync strategy using the Google Drive `appDataFolder`. This approach ensures that while the heavy binary EPUB files remain local, the "intellectual layer" of reading---highlights, progress, and custom pronunciations---is universally available.

2\. Technical Architecture
--------------------------

### 2.1 Sync Manifest Schema

The core of the sync is a single JSON manifest stored in Google Drive. This acts as the source of truth for all metadata. The schema is designed to be extensible, allowing for future additions like reading goals or social features without breaking legacy clients.

```
interface SyncManifest {
  version: number;       // Schema version for migration handling
  lastUpdated: number;    // Global timestamp (UTC)
  deviceId: string;       // Unique ID of the device that last wrote to the manifest
  books: {
    [bookId: string]: {
      metadata: Partial<BookMetadata>;
      history: ReadingHistoryEntry;
      annotations: Annotation[];
    };
  };
  lexicon: LexiconRule[];
  readingList: Record<string, ReadingListEntry>; // Lightweight portable history
  transientState: {
    // High-frequency updates used for "Handoff" scenarios
    ttsPositions: Record<string, TTSPosition>;
  };
  deviceRegistry: {
    [deviceId: string]: {
      name: string;
      lastSeen: number;
    };
  };
}

```

### 2.2 Trigger & Frequency Strategy

To optimize API usage while maintaining state consistency, we avoid real-time polling in favor of event-driven synchronization. This protects the Google Drive rate limits and preserves battery on mobile devices.

1.  **Immediate Pull (App Start):** Force a manifest fetch and merge on initialization. If a network error occurs, the app proceeds with local data and flags a "Sync Pending" state.

2.  **Explicit Push (User Actions):**

    -   **Pause/Stop:** Triggered when the TTS engine stops or the user manually pauses. This is the primary "handoff" trigger.

    -   **Session End:** Triggered when a book is closed or the user navigates back to the library.

3.  **Timed Push (Active Reading):** A 60-second debounce during active reading or TTS playback. This ensures that a sudden crash or power loss only loses a maximum of 60 seconds of progress.

4.  **Lifecycle Push (System Events):** Triggered on `visibilitychange` (transitioning to `hidden`). This is critical for browsers that might discard inactive tabs to free up memory.

### 2.3 Exclusion Strategy: Binary & Transient Data

To maintain a predictable and lightweight sync footprint, the following data types are **explicitly excluded** from both the Google Drive Sync Manifest and local Checkpoints:

-   **Large Binary Blobs:** The `files` store (original EPUBs) and `coverBlob` data are never synced. These are bulky and redundant if the user has the source file.

-   **Transient Analytical Cache:** Data from the `content_analysis` (AI summaries, structure mapping) and `tts_content` (pre-extracted sentences) stores are excluded. These are derived from the EPUB and can be regenerated on-device if needed, saving significant storage space and preventing "dirty" data from persisting across app versions.

-   **Volatile Audio Cache:** The `tts_cache` (generated audio segments) is strictly device-local and excluded.

3\. Conflict Resolution Engine
------------------------------

We employ a "Logical Merge" approach rather than strict overwrites, treating the manifest as a collection of sets rather than a single atomic document.

### Resolution Strategies by Data Type:

-   **Progress & Reading List**

    -   **Resolution Strategy:** Last-Write-Wins (LWW) via Timestamp.

    -   **Implementation:** Compare `lastRead` or `lastUpdated` timestamps between the local store and the remote manifest. The record with the higher numeric timestamp is accepted.

-   **Reading History**

    -   **Resolution Strategy:** CFI Union (CRDT-lite).

    -   **Implementation:** We do not overwrite history. Instead, we use the `mergeCfiRanges` utility to combine `readRanges` arrays. If Device A read pages 1-10 and Device B read pages 5-15 while offline, the resulting sync will show pages 1-15 as read.

-   **Annotations & Lexicon Rules**

    -   **Resolution Strategy:** ID-Based Set Union with Semantic De-duplication.

    -   **Implementation:** Entries are merged based on their unique UUID. If two devices have different content for the same ID, the one with the newer `created` timestamp is used.

-   **TTS Position**

    -   **Resolution Strategy:** Absolute Latest Update.

    -   **Implementation:** Since TTS position is transient, we only care about where the user was *last*. The most recent `updatedAt` value across all devices wins.

4\. Versioned Checkpoints & Rollbacks
-------------------------------------

To satisfy the requirement for high stability and user control, we implement a local safety net that allows users to "undo" a bad sync or accidental data deletion.

### 4.1 Implementation: The Checkpoint Store

A new object store `checkpoints` is added to the IndexedDB schema.

-   **Key:** `timestamp` (integer).

-   **Value:** A JSON string containing a serialized snapshot of only the "Moral Layer": `books` (metadata only), `annotations`, `reading_history`, and `lexicon` stores.

-   **Exclusions:** Large blobs (`files`) and transient data (`content_analysis`, `tts_content`, `tts_cache`) are **never** included in checkpoints to ensure restoration is fast and the DB remains compact.

-   **Retention Policy:** The system maintains a "sliding window" of 10 checkpoints.

### 4.2 Rollback Workflow

1.  **Automatic Capture:** A checkpoint is created automatically before every "Pull & Merge" operation from Google Drive.

2.  **User Access:** A "Recovery" section in Global Settings displays checkpoints with timestamps and summaries.

3.  **Restoration:** Upon selecting a checkpoint, the app clears the current metadata stores and repopulates them from the snapshot.

4.  **Sync Reconciliation:** After restoration, the local state is marked as "Force Dirty." The next sync operation will push this restored state to Google Drive as the new truth.

5\. Testing Strategy
--------------------

### 5.1 Abstracting the API: The Storage Provider

To prevent tight coupling with the Google Drive SDK, we interact through a `RemoteStorageProvider` interface.

```
interface RemoteStorageProvider {
  getManifest(): Promise<{ data: SyncManifest; etag: string }>;
  updateManifest(data: SyncManifest, etag: string): Promise<void>;
  deleteManifest(): Promise<void>;
  isAuthorized(): boolean;
}

```

### 5.2 Local Mocking & Edge Cases: The "Byzantine" Suite

We will create a `MockDriveProvider` for the Vitest suite that simulates network and logic failures.

-   **Network Flakiness:** Randomly inject `503 Service Unavailable` errors to verify retry logic.

-   **Concurrency Conflicts:** Simulate a `412 Precondition Failed` (ETag mismatch) to verify that the app re-merges before pushing.

-   **Atomic Corruption:** Feed partially-truncated JSON to verify the `SyncService` aborts the merge without corrupting local stores.

### 5.3 Automated Scenarios

-   **The "Traveler" Scenario:** Device A and Device B read different sections offline. Verify that history shows both as read after sync.

-   **The "Handoff" Scenario:** Verify that TTS position from Device A is available on Device B within 60 seconds of Device A being backgrounded.

-   **The "New Device" Scenario:** A completely empty IndexedDB instance pulls from Drive and correctly populates its library with offloaded book entries.

6\. Implementation Roadmap
--------------------------

1.  **Phase 1 (Data Foundation):** Add `sync_log` and `checkpoints` stores to the `initDB` routine in `db.ts`.

2.  **Phase 2 (Abstraction):** Implement the `RemoteStorageProvider` and its local mock.

3.  **Phase 3 (Cloud Integration):** Integrate the Google Identity Services (GIS) for OAuth2 authentication.

4.  **Phase 4 (Merge Logic):** Implement the `CFI Union` and `LWW` merge strategies.

5.  **Phase 5 (UI/UX):** Add a "Sync Status" indicator and a "Rollback/Checkpoint" manager in Global Settings.

Design Document: Versicle Cross-Device State Syncing
====================================================

**Author:** Gemini **Status:** Draft **Target:** Robust, predictable syncing via Google Drive API with local rollback support and Android native backup integration.

1\. Overview & Vision
---------------------

Versicle requires a predictable, high-fidelity method to synchronize reading progress, annotations, and TTS state across a fragmented device landscape (e.g., Tesla browser, Android mobile, and Desktop PWAs). This system adopts a **"Metadata-First"** sync strategy. By bifurcating the data into the "Heavy Layer" (EPUB binaries, which stay local) and the "Moral Layer" (user intellectual contributions, which sync), we achieve a synchronization speed that feels instantaneous without incurring massive data costs or API rate-limiting issues.

The vision is simple: a user should be able to highlight a passage on their phone while walking to their car, and have that highlight---and their exact TTS playback position---already present on the Tesla center console by the time they start the engine.

2\. The Source of Truth: Sync Manifest Schema
---------------------------------------------

The canonical state of a user's library is represented by a single JSON manifest. This manifest is not a direct mirror of IndexedDB but a serialized, optimized projection designed for efficient merging.

```
interface SyncManifest {
  /** Schema version to handle forward/backward compatibility as Versicle evolves */
  version: number;
  /** Global UTC timestamp (ms) representing the last authoritative write */
  lastUpdated: number;
  /** Unique ID of the device that last modified the manifest to prevent self-conflict */
  deviceId: string;

  /** * The "Moral Layer" of the Library.
   * Directly mapped from IndexedDB stores defined in src/types/db.ts.
   */
  books: {
    [bookId: string]: {
      /** Synchronized via Last-Write-Wins (LWW) based on metadata.lastRead */
      metadata: Partial<BookMetadata>;
      /** Merged via CFI Range Union; ensures progress is never lost across devices */
      history: ReadingHistoryEntry;
      /** Merged as a unique set; supports multi-device highlighting */
      annotations: Annotation[];
    };
  };

  /** Global pronunciation rules and custom abbreviations */
  lexicon: LexiconRule[];
  /** Current reading queue and priority states */
  readingList: Record<string, ReadingListEntry>;

  /** * High-frequency "Handoff" state.
   * Updated aggressively (every 60s or on Pause) to facilitate device switching.
   */
  transientState: {
    ttsPositions: Record<string, TTSPosition>;
  };

  /** Registry used to display "Last Synced" status per device in the UI */
  deviceRegistry: {
    [deviceId: string]: {
      name: string;
      lastSeen: number;
    };
  };
}

```

3\. Sync Mechanisms & Logic
---------------------------

### 3.1 Timing and Trigger Strategy

To achieve the "seamless" feel while respecting Google Drive's rate limits and preserving mobile battery life, we avoid constant polling in favor of a multi-tiered event-driven strategy:

1.  **Mandatory Initialization:** A "Pull & Merge" occurs on app start. If a newer manifest exists in the cloud, the local IndexedDB is updated before the user reaches the library view.

2.  **The "Handoff" Trigger:** An immediate "Push" is triggered when the user hits **Pause** or **Stop**. This is the critical path for users moving from one device to another.

3.  **Active Debounce:** During continuous reading or playback, updates are debounced to a 60-second window. This ensures that even if the app crashes, the user never loses more than a minute of reading history.

4.  **Lifecycle Preservation:** We hook into the browser's `visibilitychange` event. When a tab moves to the background or is hidden, a final sync attempt is made.

### 3.2 Conflict Resolution Engine

Conflict resolution is handled mathematically rather than through simple overwrites.

-   **Reading History (CFI Union):** Using the utility in `src/lib/cfi-utils.ts`, we perform a mathematical union of read segments.

-   **Annotations (ID-Based Set Union):** Since annotations use UUIDs, we treat them as an append-only set. If two devices modify the same ID, the newer `updatedAt` wins.

-   **Progress & Meta (LWW):** Metadata like "Date Added" or "Book Title" use strict Last-Write-Wins based on timestamps.

-   **TTS Position (Absolute Latest):** The most recent global `updatedAt` value wins.

### 3.3 Data Exclusion (The "Lightweight" Rule)

To keep the manifest size under 1MB even for large libraries, we strictly exclude:

-   **Binary Blobs:** The `files` store and `coverBlob` data. Books not present locally are marked `isOffloaded: true`.

-   **Derived Caches:** AI-generated summaries (`content_analysis`), sentence-level tokenization (`tts_content`), and cached audio (`tts_cache`).

4\. Platform & Credential Integration
-------------------------------------

### 4.1 User-Owned Infrastructure (Google Drive)

Versicle uses the user's personal Google Drive via the `appDataFolder` scope. This requires user-provided API credentials to ensure private, sovereign data storage.

-   **Credential Configuration:** The `clientId` and `apiKey` are configured within the **Preferences** section of the `GlobalSettingsDialog`.

-   **Persistence:** These keys are stored in the `useUIStore` state and persisted to the `global_settings` object store.

-   **Security:** The sync system will remain inactive until valid credentials are provided. A "Validation" step will attempt to ping the Drive API metadata endpoint to verify the keys before enabling sync.

### 4.2 Android Backup Manager (Capacitor)

For our Android target, we leverage the native OS backup transport.

-   **The Payload Mirror:** Every successful sync to Google Drive also writes the `SyncManifest` to a local file called `backup_payload.json` in the app's internal data directory using `@capacitor/filesystem`.

-   **Auto-Transport:** Android's system-level backup automatically copies this JSON to the user's private Google Cloud backup during charging/idle periods.

5\. Stability & Recovery
------------------------

### 5.1 Local Checkpoints: The Safety Net

Synchronization is inherently risky. To protect against "Sync Corruption," we implement local checkpoints.

-   **Automated Snapshots:** A compressed snapshot of the "Moral Layer" is stored in IndexedDB immediately before any remote data is merged.

-   **Retention:** We maintain the last 10 checkpoints.

-   **Manual Rollback:** Users can restore a checkpoint from "Settings > Recovery."

### 5.2 Schema Integrity & Evolution

-   **Schema Exhaustion Testing:** A mandatory Vitest run compares the current IndexedDB schema against the `SyncManifest` schema. Any field found in the DB that is not in the manifest (and not in an explicit `OPT_OUT_REGISTRY`) will fail the build.

-   **Forward Compatibility:** Older versions of the app "pass through" unknown fields in the JSON manifest, ensuring they don't break new features for newer devices.

6\. Testing Strategy
--------------------

### 6.1 The "Byzantine" Suite (Local Mocking)

All sync logic interacts with a `RemoteStorageProvider` interface. A `MockDriveProvider` simulates:

-   **Invalid Credentials:** Simulation of `401 Unauthorized` or `403 Forbidden` to test the credential-entry UI.

-   **Latency Simulation:** Artificial 5-second delays to test UI "Loading" states.

-   **Concurrency Conflicts:** Simulating `412 Precondition Failed` errors for merge-and-retry testing.

### 6.2 Automated Regression Scenarios

-   **The Traveler:** Device A and Device B read different sections while offline; verify a successful union post-sync.

-   **Credential Rotation:** Verifying that updating the API Key in settings correctly re-initializes the sync service without data loss.

7\. Phased Implementation Plan
------------------------------

### Phase 1: Data Foundations & Safety

-   **Schema Update:** Add `checkpoints` and `sync_log` stores to `src/db/db.ts`.

-   **Checkpoint Engine:** Implement automated snapshotting and the recovery UI.

-   **Integrity Checks:** Implement the **Schema Exhaustion Test**.

### Phase 2: Abstraction & Conflict Logic

-   **Provider Interface:** Define the `RemoteStorageProvider` and build the `MockDriveProvider`.

-   **Merge Engine:** Implement the `SyncManifest` merging logic (LWW and CFI Union).

### Phase 3: Cloud & Credential Integration

-   **UI Update:** Add `clientId` and `apiKey` fields to `GlobalSettingsDialog`.

-   **OAuth2 Flow:** Integrate Google Identity Services (GIS) with the `appDataFolder` scope using user-provided keys.

-   **Sync Orchestrator:** Add event listeners for `Pause`, `visibilitychange`, and the 60s debounce timer.

### Phase 4: Android Native Support

-   **Local Mirroring:** Implement logic to write `backup_payload.json`.

-   **Android Bridge:** Update `AndroidManifest.xml` and trigger Android's `BackupManager.dataChanged()`.

### Phase 5: Hardening & Release

-   **Byzantine Testing:** Run full suite for race conditions and credential failure handling.

-   **Migration Verification:** Perform "Hydration Tests" from simulated older manifest versions.

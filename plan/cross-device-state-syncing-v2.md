Design Document: Versicle Cross-Device State Syncing
====================================================

**Author:** Gemini **Status:** Implemented **Target:** Robust, predictable syncing via Google Drive API with local rollback support and Android native backup integration.

1\. Overview & Vision
---------------------

Versicle requires a predictable, high-fidelity method to synchronize reading progress, annotations, and TTS state across a fragmented device landscape (e.g., Tesla browser, Android mobile, and Desktop PWAs). This system adopts a **"Metadata-First"** sync strategy. By bifurcating the data into the "Heavy Layer" (EPUB binaries, which stay local) and the "Moral Layer" (user intellectual contributions, which sync), we achieve a synchronization speed that feels instantaneous without incurring massive data costs or API rate-limiting issues.

The vision is simple: a user should be able to highlight a passage on their phone while walking to their car, and have that highlight---and their exact TTS playback position---already present on the Tesla center console by the time they start the engine.

2\. The Source of Truth: Sync Manifest Schema
---------------------------------------------

The canonical state of a user's library is represented by a single JSON manifest. This manifest is not a direct mirror of IndexedDB but a serialized, optimized projection designed for efficient merging.

```typescript
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

1.  **Mandatory Initialization:** A "Pull & Merge" occurs on app start via the `SyncOrchestrator`. If a newer manifest exists in the cloud, the local IndexedDB is updated before the user reaches the library view.

2.  **The "Handoff" Trigger:** An immediate "Push" is triggered when the user hits **Pause** or **Stop** via `AudioPlayerService` calling `SyncOrchestrator.forcePush('pause')`. This is the critical path for users moving from one device to another.

3.  **Active Debounce:** During continuous reading or playback, updates are debounced to a 60-second window via `useReaderStore` calling `SyncOrchestrator.scheduleSync()`. This ensures that even if the app crashes, the user never loses more than a minute of reading history.

4.  **Lifecycle Preservation:** We hook into the browser's `visibilitychange` event. When a tab moves to the background or is hidden, a final sync attempt is made.

### 3.2 Conflict Resolution Engine

Conflict resolution is handled mathematically rather than through simple overwrites.

-   **Reading History (CFI Union):** Using the utility in `src/lib/cfi-utils.ts`, we perform a mathematical union of read segments.

-   **Annotations (ID-Based Set Union):** Since annotations use UUIDs, we treat them as an append-only set.

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

-   **Credential Configuration:** The `clientId` and `apiKey` are configured within the **Sync & Cloud** section of the `GlobalSettingsDialog`.

-   **Persistence:** These keys are stored in the `useSyncStore` state and persisted to `localStorage` (via zustand `persist` middleware).

-   **Security:** The sync system will remain inactive until valid credentials are provided. A "Validation" step attempts to ping the Drive API metadata endpoint.

### 4.2 Android Backup Manager (Capacitor)

For our Android target, we leverage the native OS backup transport.

-   **The Payload Mirror:** Every successful sync to Google Drive also writes the `SyncManifest` to a local file called `backup_payload.json` in the app's internal data directory using `@capacitor/filesystem`.

-   **Auto-Transport:** Android's system-level backup automatically copies this JSON to the user's private Google Cloud backup during charging/idle periods.

5\. Stability & Recovery
------------------------

### 5.1 Local Checkpoints: The Safety Net

Synchronization is inherently risky. To protect against "Sync Corruption," we implement local checkpoints.

-   **Automated Snapshots:** A compressed snapshot of the "Moral Layer" (`SyncManifest`) is stored in IndexedDB immediately before any remote data is merged (`pre-sync` trigger).

-   **Retention:** We maintain the last 10 checkpoints, managed by `CheckpointService`.

-   **Manual Rollback:** Users can restore a checkpoint from "Settings > Recovery."

### 5.2 Schema Integrity & Evolution

-   **Schema Exhaustion Testing:** A mandatory Vitest run (`src/lib/sync/schema.test.ts`) compares the current IndexedDB schema against the `SyncManifest` schema.

-   **Forward Compatibility:** Older versions of the app "pass through" unknown fields in the JSON manifest, ensuring they don't break new features for newer devices.

6\. Implementation Status (v1)
--------------------

### Implemented Components

- **`src/types/db.ts`**: Added `SyncManifest`, `SyncCheckpoint`, `SyncLogEntry`.
- **`src/db/db.ts`**: Updated schema to v16 with `checkpoints` and `sync_log` stores.
- **`src/lib/sync/SyncManager.ts`**: Implements LWW and CFI Union logic.
- **`src/lib/sync/CheckpointService.ts`**: Manages local snapshots.
- **`src/lib/sync/drivers/GoogleDriveProvider.ts`**: Real implementation using GAPI/GIS.
- **`src/lib/sync/android-backup.ts`**: Integration with `@capacitor/filesystem`.
- **`src/lib/sync/SyncOrchestrator.ts`**: Coordinates timing, merging, and provider communication. Exposed via Singleton pattern.
- **`src/components/GlobalSettingsDialog.tsx`**: Added "Sync & Cloud" and "Recovery" tabs.
- **`src/App.tsx`**: Initialized `SyncOrchestrator` via `useSyncOrchestrator` hook.
- **`src/lib/tts/AudioPlayerService.ts`**: Calls `SyncOrchestrator.forcePush` on playback pause/stop.
- **`src/store/useReaderStore.ts`**: Calls `SyncOrchestrator.scheduleSync` on location update (debounced).

### Discoveries & Deviations

- **Sync Store:** Created `useSyncStore` to manage credentials separately from general UI state, persisted to LocalStorage for resilience.
- **Build Dependencies:** required `@capacitor/filesystem` (v6 peer compatible) for Android backup.
- **Testing:** `schema.test.ts` acts as a basic integration test for the merge logic.
- **Orchestration:** Hooked directly into `App.tsx` for global lifecycle management.
- **Singleton Pattern:** Used explicit `SyncOrchestrator.get()` singleton pattern to allow loose coupling from `AudioPlayerService` and `useReaderStore` without dependency injection complexity.

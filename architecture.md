# Versicle Architecture

## 1. High-Level Overview

Versicle is a **Local-First**, **Privacy-Centric** EPUB reader and audiobook player that runs entirely in the browser (or as a Hybrid Mobile App via Capacitor).

### Core Design Principles

1.  **Store-First (Local-First) Architecture**:
    *   **Why**: To enable seamless offline functionality, instant UI updates, and conflict-free data synchronization without a central server.
    *   **How**: The application uses **Yjs** (CRDTs) as the single source of truth for all user data (reading progress, library inventory, annotations).
        *   **Zustand Middleware**: State changes in the UI (`useLibraryStore`, `useReadingStateStore`) are automatically mapped to Yjs documents via `zustand-middleware-yjs`.
        *   **Persistence**: The Yjs document is persisted to **IndexedDB** (`y-indexeddb`) for offline access.
    *   **Trade-off**: The initial load (hydration) involves reading the Yjs binary from IndexedDB, which scales with dataset size.

2.  **Heavy Client-Side Logic**:
    *   **Why**: To avoid server costs and maintain privacy. Features typically done on a backend (Text-to-Speech segmentation, Full-Text Indexing, File Parsing) are moved to the client.
    *   **How**:
        *   **Search**: Uses a **Web Worker** running a custom `SearchEngine` with **RegExp** scanning to find text in memory.
        *   **TTS**: Uses client-side logic (`TextSegmenter`) with JIT refinement to split text into sentences and caches audio segments locally (`TTSCache`).
        *   **Ingestion**: Parses EPUB files directly in the browser using `epub.js` and a custom **Offscreen Renderer** for accurate text extraction.
        *   **Yield Strategy**: Implements a **Time-Budgeted Yield Strategy** (pauses every 16ms) to keep the main thread responsive during heavy parsing.
    *   **Trade-off**: Higher memory and CPU usage on the client device. Large books may take seconds to index for search or parse for ingestion.

3.  **Hybrid Text-to-Speech (TTS) & GenAI**:
    *   **Why**: To balance quality, cost, and offline availability.
    *   **How**:
        *   **Local**: Uses the Web Speech API (OS native) or local WASM models (Piper) for free, offline reading.
        *   **Cloud**: Integrates with Google/OpenAI for high-quality neural voices.
        *   **Table Teleprompter**: Uses Multimodal GenAI to "see" data tables and convert them into natural speech (narrative flow).
    *   **Stability**: The system implements a "Let It Crash" philosophy for worker management to ensure resilience.

### User Interface: The "Three Rooms"

The UI is organized into three distinct operational modes to reduce cognitive load:
1.  **The Reading Room**: The distraction-free reading interface, controlled via `VisualSettings` (fonts, themes, layout).
2.  **The Listening Room**: The audio experience, managed by `UnifiedAudioPanel` (playback, speed, voice selection).
3.  **The Engine Room**: Global configuration, handled by `GlobalSettingsDialog` (data management, API keys, advanced imports).

## 2. System Architecture Diagram

```mermaid
graph TD
    subgraph Frontend [React UI]
        App[App.tsx]
        Library[LibraryView]
        Reader[ReaderView]
        VisualSettings[VisualSettings]
        AudioPanel[UnifiedAudioPanel]
        GlobalSettings[GlobalSettingsDialog]
        useEpub[useEpubReader Hook]
    end

    subgraph State [Zustand Stores]
        ReaderStore[useReaderStore]
        TTSStore[useTTSStore]
        LibStore[useLibraryStore]
        AnnotStore[useAnnotationStore]
        GenAIStore[useGenAIStore]
        ContentAnalysisStore[useContentAnalysisStore]
        BackNav[useBackNavigationStore]
        UIStore[useUIStore]
        SyncStore[useSyncStore]
        DeviceStore[useDeviceStore]
    end

    subgraph DataLayer [Data & Sync]
        SyncMesh[SyncMesh / DeviceId]
        YjsProvider[YjsProvider]
        Middleware[zustand-middleware-yjs]
        YDoc[Y.Doc CRDT]
        FireSync[FirestoreSyncManager]
        FireProvider[y-fire]
        AndroidBackup[AndroidBackupService]
        Checkpoint[CheckpointService]
        Inspector[CheckpointInspector]
        DriveScanner[DriveScannerService]
        GoogleAuth[GoogleIntegrationManager]
    end

    subgraph Core [Core Services]
        APS[AudioPlayerService (Main Thread)]
        Pipeline[AudioContentPipeline]
        Ingestion[ingestion.ts]
        BatchIngestion[batch-ingestion.ts]
        SearchClient[SearchClient]
        Backup[BackupService]
        Export[ExportImportService]
        Maint[MaintenanceService]
        GenAI[GenAIService]
        CostEst[CostEstimator]
        TaskRunner[cancellable-task-runner.ts]
        MediaSession[MediaSessionManager]
        ServiceWorker[ServiceWorker]
    end

    subgraph TTS [TTS Subsystem]
        PSM[PlaybackStateManager]
        Segmenter[TextSegmenter]
        Lexicon[LexiconService]
        TTSCache[TTSCache]
        Sync[SyncEngine]
        Providers[ITTSProvider]
        Piper[PiperProvider]
        PiperUtils[piper-utils.ts]
        BG[BackgroundAudio]
        TaskSeq[TaskSequencer]
    end

    subgraph Workers [Web Workers]
        SearchWorker[search.worker.ts]
        SearchEngine[SearchEngine]
        PiperWorker[piper_worker.js]
    end

    subgraph Storage [IndexedDB]
        DBService[DBService]
        StaticStores[Static & Resources]
        UserStores[User Data & Progress]
        CacheStores[Cache & Tables]
        AppStores[Checkpoints & Logs]
        YDB[versicle-yjs]
    end

    App --> Library
    App --> Reader
    Reader --> VisualSettings
    Reader --> AudioPanel
    Reader --> GlobalSettings
    Reader --> useEpub
    Library --> ServiceWorker

    VisualSettings --> ReaderStore
    AudioPanel --> TTSStore
    GlobalSettings --> UIStore
    GlobalSettings --> SyncStore
    GlobalSettings --> Export

    TTSStore --> APS
    Library --> LibStore

    LibStore <--> Middleware
    ReaderStore <--> Middleware
    DeviceStore <--> Middleware

    Middleware <--> YDoc
    YDoc <--> YjsProvider
    YjsProvider <--> YDB
    YjsProvider --> FireSync
    FireSync --> FireProvider
    FireSync --> Checkpoint
    DeviceStore --> SyncMesh
    LibStore --> AndroidBackup
    GlobalSettings --> Inspector
    Inspector --> Checkpoint
    GlobalSettings --> DriveScanner
    DriveScanner --> GoogleAuth
    GlobalSettings --> GoogleAuth

    LibStore --> DBService
    LibStore --> Ingestion
    LibStore --> BatchIngestion
    LibStore --> Backup
    LibStore --> Maint

    APS --> Pipeline
    APS --> PSM
    Pipeline --> GenAI
    Pipeline --> GenAIStore
    Pipeline --> ContentAnalysisStore
    Pipeline --> DBService

    APS --> Providers
    APS --> Segmenter
    APS --> Lexicon
    APS --> TTSCache
    APS --> Sync
    APS --> Piper
    APS --> CostEst
    APS --> BG
    APS --> MediaSession
    APS --> TaskSeq

    Piper --> PiperUtils
    PiperUtils --> PiperWorker

    Reader --> SearchClient
    SearchClient --> SearchWorker
    SearchWorker --> SearchEngine

    GenAIStore --> GenAI

    Ingestion --> DBService
    TTSCache --> DBService

    DBService --> StaticStores
    DBService --> UserStores
    DBService --> CacheStores
    DBService --> AppStores
```

## 3. Detailed Module Reference

### Data Layer (`src/db/`)

The data layer is built on **IndexedDB** using the `idb` library. It is accessed primarily through the `DBService` singleton, which provides a high-level API for all storage operations.

#### `src/db/DBService.ts`
The main database abstraction layer. It handles error wrapping (converting DOM errors to typed application errors like `StorageFullError`), transaction management, and debouncing for frequent writes.

**Key Stores (Schema v23):**
*   **Domain 1: Static (Immutable/Heavy)** - *Managed by DBService*
    *   `static_manifests`: Lightweight metadata (Title, Author, Cover Thumbnail) for listing books.
    *   `static_resources`: The raw binary EPUB files (Blobs). This is the heaviest store.
    *   `static_structure`: Synthetic TOC and Spine Items derived during ingestion.
*   **Domain 2: User (Mutable/Syncable)** - *Managed by Yjs*
    *   **Yjs Exclusive**: `user_inventory` (Books), `user_progress` (Reading State), `user_reading_list` (Shadow Inventory), `user_annotations`, and `user_overrides` (Lexicon Rules) are managed **exclusively** by Yjs stores. `DBService` only reads/writes static data.
    *   **IDB Local/Hybrid**:
        *   `static_manifests`: Used as a local index for offline access, but the "Truth" is in Yjs.
    *   **Deprecated/Replaced**:
        *   `user_journey`: **(Removed)** Granular reading history sessions are no longer stored in IDB.
        *   `user_ai_inference`: **(Replaced)** Expensive AI-derived data is now handled by the synced `useContentAnalysisStore` (Yjs).
*   **Domain 3: Cache (Transient/Regenerable)**
    *   `cache_table_images`: Snapshot images of complex tables (`webp`) for teleprompter/visual preservation. Indexed by `bookId` and `sectionId`.
    *   `cache_audio_blobs`: Generated TTS audio segments.
    *   `cache_render_metrics`: Layout calculation results.
    *   `cache_session_state`: Playback queue persistence.
    *   `cache_tts_preparation`: Staging area for TTS text extraction.

**Key Functions:**
*   **`offloadBook(id)`**: Deletes the large binary EPUB from `static_resources` and cached assets but keeps all `User` domain data (Progress, Annotations) and `user_reading_list` entry.
    *   *Trade-off*: User must re-import the *exact same file* to read again.
*   **`importBookWithId(id, file)`**: Special ingestion mode for restoring "Ghost Books" (books that exist in Yjs inventory but are missing local files). It bypasses new ID generation to match the existing Yjs record.
    *   **Logic**: Parses the new file but *forces* the internal IDs (Book ID, Spine Items, Batches) to match the provided ID, ensuring the new binary seamlessly reconnects with existing Yjs progress/annotations. It explicitly rewrites all internal references in the extracted data structures to align with the target ID before ingestion.
*   **`deleteBook(id)`**: Cleans up all `static_` and `cache_` stores (Heavy Data) but deliberately *leaves* the `user_` data (Progress, Annotations) in the Yjs document. This allows for a "Soft Delete" where the user can restore the book later (Ghost Book) without losing their place.
*   **`ingestBook(data)`**: Performs a "Static Only" write. It persists the heavy immutable data (`static_manifests`, `static_resources`) to IDB but relies on the caller (Zustand) to update the Yjs `user_inventory`.
*   **`getOffloadedStatus(bookIds)`**: Returns a Map indicating whether the binary resource for each book exists locally or has been offloaded.
*   **`getAvailableResourceIds()`**: Returns a Set of all book IDs that have binary content locally (NOT offloaded).

#### `src/store/useDeviceStore.ts` (Sync Mesh)
*   **Goal**: Provide visibility into the synchronization network and enable "Send to Device" features.
*   **Logic**:
    *   **Stable Identity**: `device-id.ts` generates and persists a stable UUID in `localStorage` to identify the current node.
    *   **Heartbeat**: `useDeviceStore` maintains a Yjs Map of active devices, updating the `lastActive` timestamp with a 5-minute throttle (`HEARTBEAT_THROTTLE_MS`) to prevent excessive CRDT updates.
    *   **Peer Discovery**: Automatically parses User Agent strings (via `ua-parser-js`) to provide human-readable device names (e.g., "Chrome on Windows").

#### `src/lib/batch-ingestion.ts` (Batch Ingestion)
*   **Goal**: Handle bulk import of books, including ZIP archives containing multiple EPUBs.
*   **Logic**:
    *   **Recursive Extraction**: Uses `JSZip` to extract EPUBs from uploaded ZIP files.
    *   **Progress Tracking**: Provides granular callbacks for both upload/extraction progress and individual book ingestion status.
    *   **Error Isolation**: A failure in one book (e.g., corruption) does not fail the entire batch.
*   **Trade-offs**:
    *   **Memory Pressure**: Loading a large ZIP file (e.g., 500MB+) entirely into memory (ArrayBuffer) for extraction can cause tab crashes on memory-constrained mobile devices.
    *   **Main Thread Blocking**: While `JSZip` is async, large decompression tasks can still cause frame drops or UI jank during the extraction phase.

#### `src/lib/csv.ts` (CSV Import/Export)
*   **Goal**: Provide interoperability with Goodreads and other reading trackers.
*   **Logic**:
    *   **Universal Format**: Exports reading lists using standard Goodreads headers (Title, Author, ISBN, My Rating, Exclusive Shelf, Date Read).
    *   **Filename Fallback Strategy**: When importing, the system attempts to resolve missing filenames using a priority cascade:
        1.  Explicit `Filename` column (Versicle native export).
        2.  `isbn-{ISBN}`.
        3.  `{Title}-{Author}` (Sanitized).
    *   **Trade-off**: Importing from generic CSVs (Goodreads) relies on "Ghost Books" creation; the user must manually import the matching EPUB file later to read it.

#### Hardening: Validation & Sanitization (`src/db/validators.ts` & `src/db/DBService.ts`)
*   **Goal**: Prevent database corruption and XSS attacks.
*   **Logic**:
    *   **Quota Management (`DBService.ts`)**: Explicitly handles `QuotaExceededError` (including legacy code 22) and wraps it in a typed `StorageFullError` for UI handling, prompting the user to offload books.
    *   **Sanitization (`validators.ts`)**: Delegates to `DOMPurify` to strip HTML tags from metadata.
    *   **Safe Mode**: A specialized UI state (`SafeModeView`) triggered by critical database initialization failures in `App.tsx`. It provides a last-resort "Factory Reset" option (`deleteDB`) to recover the application from a corrupted state without requiring user technical knowledge.

### Sync & Cloud (`src/lib/sync/`)

Versicle implements a strategy combining **Real-Time Sync** (via Firestore) for cross-device activity and **Native Backup** (via Android) for data safety.

#### `CheckpointService.ts` (The Moral Layer)
*   **Goal**: Prevent data loss during complex sync merges by creating "Safety Snapshots".
*   **Logic**:
    *   **Destructive Restore**: Clears all existing shared types (Map, Array, XmlText) in the Yjs document before applying the binary snapshot to ensure a clean state.
    *   **Before Sync**: Automatically creates a `pre-sync` checkpoint immediately before connecting to Firestore.
    *   **Rotation**: Maintains a rolling buffer of the last 10 checkpoints.

#### `FirestoreSyncManager.ts` (Real-Time Cloud)
Provides a "Cloud Overlay" for real-time synchronization.

*   **Logic**:
    *   **Hybrid Auth**: Supports both Web (`signInWithPopup`/`getRedirectResult`) and Native Android (`FirebaseAuthentication` plugin) flows for Google Sign-In.
    *   **Cloud Overlay**: Acts as a secondary sync provider. `y-indexeddb` remains the primary source of truth, while Firestore relays updates to other devices.
    *   **Y-Fire**: Uses `y-cinder` (a custom `y-fire` fork) to sync Yjs updates incrementally to Firestore (`users/{uid}/versicle/{env}`).
    *   **Pre-Sync Checkpoint**: Automatically creates a "pre-sync" checkpoint via `CheckpointService` immediately before connecting to the provider, ensuring a safe fallback state exists before merging remote changes (Destructive Restore protection).
    *   **Configurable Debounce**: Implements `maxWaitFirestoreTime` (default 2000ms) and `maxUpdatesThreshold` (default 50) to balance cost vs. latency.
    *   **Environment Aware**: Writes to `dev` bucket in development and `main` in production to prevent test data pollution.
    *   **Authenticated**: Sync only occurs when the user is signed in via Firebase Auth.
    *   **Mock Mode**: Includes a `MockFireProvider` for integration testing without a real Firebase project.
*   **Trade-offs**:
    *   **Complexity**: Requires maintaining a Firestore project.

#### `AndroidBackupService.ts` (Cold Path)
Manages integration with the native Android Backup Service.

*   **Logic**:
    *   **Payload File**: Periodically writes a `backup_payload.json` file to the app's internal data directory.
    *   **Native Handoff**: The Android OS automatically backs up this file to the user's Google Drive (if enabled in Android settings).
*   **Trade-off**: Restore is all-or-nothing and handled by the OS during app installation/restore.

#### `CheckpointInspector.ts` (Forensic Layer)
*   **Goal**: Provide deep visibility into binary checkpoints for debugging and support.
*   **Logic**:
    *   **Hydration**: Hydrates a binary checkpoint blob into a temporary `Y.Doc`.
    *   **Deep Diff (`src/lib/json-diff.ts`)**: Converts both the live document and the checkpoint to JSON and performs a recursive object difference (Added, Removed, Modified).
    *   **Dynamic Discovery**: Iterates over `doc.share` keys to dynamically discover and deserialize map/array types, handling `AbstractType` hydration issues.
*   **Trade-off**: High CPU and memory cost (full document serialization). Strictly on-demand.

### Core Logic & Services (`src/lib/`)

#### Logging (`src/lib/logger.ts`)
*   **Goal**: Provide environment-aware logging with context isolation.
*   **Logic**:
    *   **Scoped Loggers**: Uses `createLogger('Namespace')` to create isolated logger instances.
    *   **Filtering**: Filters logs based on `VITE_LOG_LEVEL` or environment (Info in Dev, Warn in Prod).
    *   **Legacy**: The singleton `Logger` class is deprecated in favor of functional factory usage.

#### Performance: Hot Paths (`src/lib/cfi-utils.ts`)
*   **Goal**: Minimize latency during heavy text segmentation and rendering operations.
*   **Logic**:
    *   **Fast Merge ("Point + Point")**: `tryFastMergeCfi` uses optimistic string manipulation to merge sibling CFIs directly. It detects if two CFIs share a common parent prefix (up to the last slash) and simply joins the leaf components (e.g., `/1` and `/2` -> `/1,/2`) without full parsing or regeneration.
    *   **Optimistic Append**: `mergeCfiRanges` assumes sequential reading patterns. It checks if the new range follows the last existing range to perform an O(1) merge, avoiding O(N) re-sorting.
    *   **Heuristic Fallback**: If the fast path fails (complex structure/nesting), it gracefully falls back to the standard, slower implementation.
*   **Verification**:
    *   **Fuzz Testing**: The optimization is verified using seeded Fuzz tests (`cfi-utils.fuzz.test.ts`) that generate random CFI inputs and assert that the Fast Path output matches the Slow Path reference implementation.

#### Ingestion (`src/lib/ingestion.ts` & `src/lib/offscreen-renderer.ts`)
Handles the complex task of importing an EPUB file.

*   **`extractBookData(file)`**:
    1.  **Validation**: Enforces strict ZIP signature check (`PK\x03\x04`).
    2.  **Offscreen Rendering**: Uses a hidden `iframe` (via `offscreen-renderer.ts`).
        *   **Time-Budgeted Yield Strategy**: Explicitly checks `performance.now()` and yields to the main thread every 16ms (1 frame) to prevent freezing the UI during heavy parsing.
    3.  **Fingerprinting**: Generates a **"3-Point Fingerprint"** (Head 4KB + Metadata + Tail 4KB) using a `cheapHash` function for O(1) duplicate detection.
    4.  **Adaptive Contrast**: Generates a **Cover Palette** via `cover-palette.ts`.
        *   **Logic**: Uses **Weighted K-Means Clustering** (manual implementation) on the cover image to extract dominant colors. It prioritizes colors based on spatial distribution (corners vs. center) to ensure UI elements don't clash with key visual areas.
        *   **Accessibility**: Calculates **Perceptual Lightness (L*)** (CIE 1976) from the extracted RGB values to determine the optimal text color (Soft Dark, Hard Black, Hard White, Soft Light) for UI overlays, ensuring WCAG contrast compliance.

#### Service Worker Image Serving (`src/lib/serviceWorkerUtils.ts`)
*   **Goal**: Prevent memory leaks caused by `URL.createObjectURL`.
*   **Logic**:
    *   **URL Scheme**: Uses `/__versicle__/covers/:bookId`.
    *   **Interception**: A **Service Worker** intercepts these requests, fetches the cover blob from IndexedDB (`static_manifests`), and responds directly.

#### Generative AI (`src/lib/genai/GenAIService.ts`)
*   **Goal**: Provide AI-driven content analysis and adaptation.
*   **Logic**:
    *   **Smart Rotation**: Implements a `executeWithRetry` strategy that shuffles between models (e.g., `gemini-2.5-flash-lite`, `gemini-2.5-flash`) to mitigate `429 RESOURCE_EXHAUSTED` errors and maximize free tier usage.
    *   **Thinking Budget**: `generateTableAdaptations` utilizes a configurable `thinkingBudget` (default 512 tokens) to allow the model to "reason" about complex table layouts (headers vs. data cells) before generating the narrative JSON.
    *   **Content Detection**: `detectContentTypes` analyzes text samples to classify semantic structures into 5 categories: **Title**, **Footnote**, **Main**, **Table**, and **Other**.
    *   **Structure Generation**: `generateTOCForBatch` uses GenAI to infer meaningful section titles when the EPUB metadata is lacking.
*   **Fuzzy Matching (`textMatching.ts`)**: Uses a robust fuzzy matching algorithm to locate LLM-generated snippets back in the original source text for accurate CFI targeting.
    *   **Strategy**: Tries Exact Match -> Case-Insensitive Match -> **Flexible Whitespace Regex** (matches varying newlines/spaces) to handle LLM formatting quirks.

#### Search (`src/lib/search.ts` & `src/workers/search.worker.ts`)
Implements full-text search off the main thread.

*   **Logic**: Uses a **RegExp** scanning approach over in-memory text via `SearchEngine` class, exposed via `Comlink`.
    *   **Fallback**: If raw text is missing, it attempts to parse XML content using `DOMParser` (if available) to extract text.
*   **Trade-off**: The index is **transient** (in-memory only) and rebuilt on demand.

#### Backup (`src/lib/BackupService.ts`)
Manages manual internal state backup and restoration.

*   **`createLightBackup()`**: JSON-only export (metadata, settings, history).
*   **`createFullBackup()`**: ZIP archive containing the JSON manifest plus all original `.epub` files.

#### Export (`src/lib/export.ts` & `src/lib/sync/ExportImportService.ts`)
*   **Goal**: Provide a platform-agnostic way to export data.
*   **Logic**:
    *   **Unified Export (`export.ts`)**: Acts as a **Platform Adapter**.
        *   **Web**: Uses `file-saver` to trigger a browser download.
        *   **Native**: Writes the file to the app's cache directory and uses `Capacitor Share` API to open the native share sheet.
    *   **Export/Import Service (`ExportImportService.ts`)**: The **Logic Provider** for the "Cold Path" (Manual Backup).
        *   **Export**: Serializes Yjs state (Inventory, Progress, Annotations) into a JSON blob with a checksum.
        *   **Import**: Validates schema and merges data into the local Yjs document using atomic transactions.
*   **Trade-offs**:
    *   **Memory Pressure**: On native devices, converting large Blobs to Base64 (for the Filesystem API) can cause Out-Of-Memory (OOM) crashes with very large backups.

#### Cloud Library (`src/lib/drive/`)
Integrates with Google Drive to provide a cloud-based library.

*   **`DriveScannerService.ts` (The Brain)**:
    *   **Goal**: Manage high-level sync logic and state.
    *   **Logic**:
        *   **Heuristic Sync**: To save API quota, it checks if the remote folder's `viewedByMeTime` is more recent than the local `lastScanTime` (`shouldAutoSync`). If not, it skips the expensive scan.
        *   **Diffing**: Compares the Cloud Index (`useDriveStore`) against the Local Library (`useBookStore` inventory) to identify "New" files (`checkForNewFiles`).
        *   **Direct Store Access**: Reads directly from `useDriveStore` and `useLibraryStore` to manage state and trigger imports.
        *   **Lightweight Indexing**: Maintains a local index (`useDriveStore`) for instant UI feedback.
*   **`DriveService.ts` (The Muscle)**:
    *   **Goal**: Handle low-level API interactions.
    *   **Logic**:
        *   **Resilience**: Implements automatic **Token Refresh** and **Retry Logic** for 401 Unauthorized errors.
        *   **Abstraction**: Wraps standard `fetch` calls with auth headers managed by `GoogleIntegrationManager`.
*   **Trade-offs**:
    *   **API Quotas**: Heavy scanning can hit Google Drive API rate limits. The system mitigates this with the heuristic check.

#### Google Integration (`src/lib/google/GoogleIntegrationManager.ts`)
*   **Goal**: Abstract authentication complexity across Web and Android platforms.
*   **Logic**:
    *   **Dual Strategy**:
        *   **Web**: Uses Google Identity Services (GIS) for pop-up based auth.
        *   **Android**: Uses `@capgo/capacitor-social-login` (patched) for native system-level sign-in, supporting `login_hint` and account selection.
    *   **Token Management**: Handles token refresh automatically, retrying failed requests (e.g., 401s in `DriveService`) with a fresh token.
    *   **Service Isolation**: Manages connections for 'drive' and 'sync' (Firestore) independently, allowing users to opt-in to specific features.

#### `src/lib/MaintenanceService.ts`
*   **Goal**: Perform database hygiene and remove orphaned data.
*   **Logic**:
    *   **Orphan Detection**: Scans `static_resources` (files) and `cache_` stores for keys that no longer exist in the Yjs `user_inventory`.
    *   **Post-Migration Role**: Unlike legacy versions, it *does not* touch user data (inventory, progress) as those are managed by Yjs/Firestore sync. It strictly cleans up the heavy binary/cache data left behind.
    *   **Metadata Regeneration**: Can re-import books from their binary blobs (`regenerateAllMetadata`) to refresh Yjs metadata if the schema changes, using `DBService.importBookWithId`.

#### Cancellable Task Runner (`src/lib/cancellable-task-runner.ts`)
*   **Goal**: Solve the "Zombie Promise" problem in React `useEffect` hooks.
*   **Logic**: Uses a **Generator** pattern (`function*`) to yield Promises. Calling `cancel()` throws a `CancellationError` into the generator.

#### Sync Mesh (`src/store/useDeviceStore.ts` & `src/lib/device-id.ts`)
*   **Goal**: Provide visibility into the synchronization network and enable "Send to Device" features.
*   **Logic**:
    *   **Stable Identity**: `device-id.ts` generates and persists a stable UUID in `localStorage` to identify the current node.
    *   **Heartbeat**: `useDeviceStore` maintains a Yjs Map of active devices, updating the `lastActive` timestamp with a 5-minute throttle.
    *   **Metadata**: Automatically parses User Agent strings (via `ua-parser-js`) to provide human-readable device names (e.g., "Chrome on Windows").

---

### TTS Subsystem (`src/lib/tts/`)

#### `src/lib/tts/AudioPlayerService.ts` (Main Thread Orchestrator)
The central hub for TTS operations. It runs on the **Main Thread** and coordinates the various subsystems (Pipeline, Providers, State). It does **NOT** run in a worker.

*   **Logic**:
    *   **Concurrency**: Uses `TaskSequencer` (`enqueue`) to serialize public methods (play, pause) to prevent race conditions during rapid UI interaction.
    *   **State Restoration**: Implements `sessionRestored` logic to seamlessly resume playback position and state (including queue) after an app restart.
    *   **Optimistic Playback**: Integrates with `AudioContentPipeline` using asynchronous callbacks (`onMaskFound`, `onAdaptationsFound`) to update the active queue with GenAI insights (skips, table narrations) *while* playback is already in progress.
    *   **Background Audio**: Explicitly manages background playback via `engageBackgroundMode`, ensuring metadata and audio focus are correctly handled on mobile.
    *   **Battery Guard**: On Android, explicitly checks for and warns about aggressive battery optimization (`checkBatteryOptimization`) via `@capawesome-team/capacitor-android-battery-optimization`. If enabled, it prompts the user to disable it to prevent the OS from killing the background service.
    *   **Delegation**: Offloads heavy content loading to `AudioContentPipeline`, provider management to `TTSProviderManager`, and state logic to `PlaybackStateManager`.

#### `src/lib/tts/TTSProviderManager.ts`
*   **Goal**: Abstract the differences between Native and Web TTS engines.
*   **Logic**:
    *   **Platform Detection**: Automatically selects `CapacitorTTSProvider` on native devices and `WebSpeechProvider` on the web.
    *   **Fallback Strategy**: Automatically falls back to the local Web Speech engine if a cloud/native provider fails.
    *   **Event Normalization**: Unifies disparate provider events (boundaries, errors, completion) into a consistent `TTSProviderEvents` interface.

#### `src/lib/tts/TaskSequencer.ts`
*   **Goal**: Prevent race conditions in async audio operations.
*   **Logic**:
    *   **Queue**: Maintains a promise chain (`pendingPromise`).
    *   **Serialization**: Ensures tasks like `play()`, `pause()`, and `loadSection()` run sequentially, preventing "Double Play" or invalid state transitions.
*   **Trade-offs**:
    *   **Head-of-Line Blocking**: A single slow operation (e.g., a network timeout) will block all subsequent playback actions.

#### `src/lib/tts/CostEstimator.ts`
*   **Goal**: Track and estimate usage costs for Cloud TTS providers.
*   **Logic**:
    *   **Session Tracking**: Uses a transient Zustand store (`useCostStore`) to track characters processed in the current session.
    *   **Estimation**: Applies per-character pricing models (e.g., $0.000016/char for Google WaveNet).

#### `src/lib/tts/AudioContentPipeline.ts`
The Data Pipeline for TTS.

*   **Goal**: Decouple "Content Loading" from "Playback Readiness".
*   **Logic (Optimistic Playback)**:
    1.  **Immediate Return**: Returns a raw, playable queue immediately after basic extraction.
    2.  **Background Analysis**: Fires "fire-and-forget" asynchronous tasks (`detectContentSkipMask`, `processTableAdaptations`) to analyze content using GenAI.
            *   **Grouping**: `groupSentencesByRoot` clusters sentences by their **Root CFI** (common ancestor) before GenAI analysis. This ensures the LLM receives logical blocks (e.g., an entire table row or aside) rather than fragmented sentences, improving classification accuracy.
        *   **Optimization**: Pre-filters table images by `sectionId` and batch-processes their CFIs via `preprocessTableRoots` to avoid redundant parsing and reduce lookup complexity during sentence grouping.
        3.  **Dynamic Updates**: Updates the *active* queue while it plays via callbacks (`onMaskFound`, `onAdaptationsFound`).
            *   **Table Injection**: `mapSentencesToAdaptations` matches raw sentences to AI-generated table narratives using CFI prefix matching, replacing the raw data cells with a natural language summary in real-time.
    4.  **Memoization**: Caches merged abbreviations (`getMergedAbbreviations`) to ensure reference stability, allowing `TextSegmenter` to skip redundant `Set` creation in hot loops.

#### `src/lib/tts/TextSegmenter.ts`
*   **Goal**: Robustly split text into sentences and handle abbreviations.
*   **Logic**:
    *   **Reactive Segmentation (`refineSegments`)**: Allows re-segmenting text on the fly based on changing abbreviation rules (e.g., toggling "Bible Mode" abbreviations) without re-ingesting the book.
    *   **Manual Backward Scan**: `mergeText` uses a manual character scan loop via `charCodeAt` (bypassing `trimEnd()` and regex) to find the merge point, reducing expensive string allocations in tight loops.
    *   **Zero-Allocation Scanning (`TextScanningTrie`)**: Uses a specialized Trie implementation that operates on character codes.
        *   **Strategy**: Uses static `Uint8Array` lookup tables (`PUNCTUATION_FLAGS`, `WHITESPACE_FLAGS`) for O(1) character classification, bypassing conditional logic.
        *   **Performance**: Instead of allocating new strings with `.toLowerCase()`, it performs manual ASCII case folding (checking range 65-90 and adding 32) during traversal. This enables allocation-free matching of abbreviations in hot loops.
    *   **Segmenter Cache**: Caches `Intl.Segmenter` instances via `segmenter-cache` to avoid the heavy cost of instantiating locale data repeatedly.
    *   **Optimization**: Uses `tryFastMergeCfi` to merge CFIs optimistically via string manipulation.
*   **Trade-offs**:
    *   **Maintenance**: The manual character scanning logic is more complex and brittle than standard regex or `String.trim()`, requiring careful regression testing.

#### `src/lib/tts/PlaybackStateManager.ts`
Manages the virtual playback timeline.

*   **Goal**: Abstract the complexity of skipped items and dynamic replacements.
*   **Logic**:
    *   **Virtualized Timeline**: Maintains a queue where items can be marked `isSkipped` without being removed.

#### `src/lib/tts/LexiconService.ts`
*   **Goal**: Manage pronunciation rules for TTS, handling book-specific and global overrides.
*   **Logic**:
    *   **Traceability**: `applyLexiconWithTrace` returns a step-by-step log of text transformations, enabling users to debug which rule caused a specific pronunciation change.
    *   **Performance (WeakMap Cache)**: Caches compiled `RegExp` objects keyed by the *reference* of the rules array in a `WeakMap`. This avoids re-compiling regexes for every sentence while ensuring memory is freed when rule sets change.
    *   **Layered Application**: Applies rules in a strict order: Book Specific (High Priority) -> Global -> Bible Rules (if enabled) -> Book Specific (Low Priority).
    *   **Bible Lexicon**: Injects a specialized set of rules (`BIBLE_LEXICON_RULES`) for Bible citations (e.g., "Gen 1:1") if enabled for the book.

#### `src/lib/tts/SyncEngine.ts` (Audio Synchronization)
*   **Goal**: Efficiently map audio playback time to text segments for highlighting.
*   **Logic**:
    *   **Optimized Forward Scan**: Uses a stateful cursor (`currentIdx`) to optimize the common case of continuous playback. It searches forward from the last known position, making typical updates effectively O(1).
    *   **Highlight Emission**: Triggers `onHighlight` callbacks only when the active segment actually changes, preventing unnecessary React re-renders in the UI.
*   **Trade-offs**:
    *   **State Management**: Requires strict lifecycle management. The stateful cursor must be manually reset (`currentIdx = -1`) on seeks or chapter changes to prevent incorrect alignment, as the engine assumes forward progression by default.

#### `src/lib/tts/processors/Sanitizer.ts`
*   **Goal**: Clean raw text before segmentation to improve TTS quality.
*   **Logic**:
    *   **Regex Operations**: Removes non-narrative artifacts like page numbers, URLs (keeping domain), and citations (numeric/author-year).
    *   **Efficiency**: Uses pre-compiled global regexes to minimize overhead during heavy processing.

#### HTML Sanitization (`src/lib/sanitizer.ts`)
*   **Goal**: Prevent XSS and ensure safe rendering of EPUB content.
*   **Logic**:
    *   **Library**: Uses `DOMPurify` with strict configuration.
    *   **Hardening**:
        *   **Reverse Tabnabbing**: Automatically adds `rel="noopener noreferrer"` to all `target="_blank"` links via a hook.
        *   **CSS Isolation**: Explicitly strips `<link>` tags pointing to external domains to prevent style injection attacks.
    *   **Metadata**: `sanitizeMetadata` strips *all* HTML tags to ensure plain text for titles and authors.

#### `BackgroundAudio.ts`
*   **Goal**: Ensure the app process remains active on Android/iOS when the screen is off.
*   **Logic**: Plays a silent (or white noise) audio loop in the background to prevent the OS from killing the suspended app.

#### `src/lib/tts/providers/PiperProvider.ts` (Local Neural TTS)
*   **Goal**: High-quality, offline TTS using Piper voices (WASM).
*   **Logic**:
    *   **Worker Offloading**: Offloads the heavy OnnxRuntime inference to a dedicated Web Worker (`piper_worker.js`) via `piper-utils` to prevent blocking the Main Thread.
    *   **Transactional Download**: Implements a robust "Download -> Verify -> Cache" strategy.
        1.  Downloads model and config to memory.
        2.  Verifies integrity by running a test inference.
        3.  Only commits to the cache if verification succeeds.
    *   **Input Sanitization**: Splits long inputs into smaller chunks to prevent WASM memory exhaustion/crashes.

#### `src/lib/tts/providers/LemonFoxProvider.ts` (Cloud Neural)
*   **Goal**: Provide a cost-effective alternative to OpenAI/Google with similar quality.
*   **Logic**:
    *   **API Compatibility**: Mimics the OpenAI API structure (`/v1/audio/speech`) but points to LemonFox endpoints.
    *   **Static Voices**: Hardcoded list of supported voices (e.g., "Heart", "Bella") mapped to the provider ID.

#### `src/lib/tts/providers/CapacitorTTSProvider.ts`
*   **Logic**: Uses `queueStrategy: 1` to preload the next utterance into the OS buffer while the current one plays.

#### `src/lib/tts/PlatformIntegration.ts`
*   **Goal**: Consolidate OS-level media interactions.
*   **Logic**:
    *   **Media Session**: Wraps `MediaSessionManager` to handle Lock Screen controls (Play/Pause/Seek) and update metadata/artwork.
    *   **Background Audio**: Manages a silent/noise audio loop via `BackgroundAudio` to prevent the Android OS from suspending the app process when the screen is off.
    *   **Lifecycle**: Automatically starts/stops the background loop based on playback state (`playing` -> start, `paused` -> stop with debounce).

#### `src/lib/tts/CsvUtils.ts` (Lexicon I/O)
*   **Goal**: Enable import/export of Lexicon rules and abbreviations.
*   **Logic**:
    *   **Library**: Uses `PapaParse` for robust CSV handling.
    *   **Format**: Handles standard CSV escaping (RFC 4180) for rules containing commas or quotes.

---

### State Management (`src/store/`)

State is managed using **Zustand** with specialized strategies for different data types.

*   **`useBookStore` (Synced)**: Manages **User Inventory**. Backed by Yjs Map.
*   **`useReadingListStore` (Synced)**:
    *   **Goal**: Functions as a **"Shadow Inventory"**.
    *   **Logic**: Tracks book status (Read, Reading, Want to Read) and Rating independently of the file existence. Persists even if the book file is offloaded or deleted.
*   **`useTTSStore`**:
    *   **Goal**: Manage TTS configuration and playback state.
    *   **Logic**:
        *   **Background Mode**: Configures `backgroundAudioMode` ('silence', 'noise', 'off') and `whiteNoiseVolume` to keep the app alive on mobile.
        *   **Preroll**: Manages `prerollEnabled` for chapter announcements.
        *   **Bible**: Toggles `isBibleLexiconEnabled` for specialized pronunciation.
        *   **Persistence**: Uses `persist` middleware to save user preferences (speed, voice, provider keys) to `localStorage`.
*   **`useReadingStateStore` (Per-Device Sync)**:
    *   **Strategy**: Uses a nested map structure (`bookId -> deviceId -> Progress`) in Yjs.
    *   **Why**: To prevent overwriting reading positions when switching between devices (e.g., preventing a phone at 10% from overwriting a tablet at 80% during a sync race).
    *   **Aggregation**: The UI selector uses a **Local Priority > Global Recent** strategy. It prefers the local device's progress if available; otherwise, it falls back to the most recently updated progress from any device in the mesh.
    *   **Session Merging**: Implements a "Smart Merge" strategy that aggregates reading updates of the same type (e.g., `page` vs `chapter`) into a single `ReadingSession` if they occur within 20 minutes (`MERGE_TIME_WINDOW`). This prevents history spam while preserving granular session data.
    *   **Pruning**: Automatically prunes reading history when it exceeds `MAX_READING_SESSIONS` (500), removing the oldest `HISTORY_PRUNE_SIZE` (200) entries to maintain Yjs document performance.
*   **`useDeviceStore` (Sync Mesh)**:
    *   **Strategy**: Maintains a Yjs Map of active devices in the mesh.
    *   **Logic**:
        *   **User Agent Parsing**: Uses `UAParser` to automatically generate human-readable device names (e.g., "Chrome on Windows") upon registration.
        *   **Heartbeat Throttling**: Updates the `lastActive` timestamp with a 5-minute throttle (`HEARTBEAT_THROTTLE_MS`) to prevent excessive CRDT updates while maintaining online status visibility.
    *   **Why**: Enables "Send to Device" features and provides visibility into the sync network.
*   **`useReaderStore`**: (Conceptual Facade) Aggregates ephemeral UI state (`useReaderUIStore`) and persistent settings (`usePreferencesStore`) for easier component consumption.
*   **`useGenAIStore` (Local/Persisted)**:
    *   **Goal**: Manage AI configuration, API keys, and usage tracking.
    *   **Logic**:
        *   **Persistence**: Stored in `localStorage` via `persist` middleware.
        *   **Usage Tracking**: Tracks token usage and estimated cost for the current session.
        *   **Logging**: Maintains a rolling buffer of the last 10 debug logs (`GenAILogEntry`) for troubleshooting.
*   **`useLexiconStore` (Synced)**:
    *   **Goal**: Synchronize pronunciation rules across devices.
    *   **Logic**:
        *   **Rules**: Stored in a Yjs Map (`lexicon`).
        *   **Ordering**: Rules have an explicit `order` field to ensure deterministic application order.
        *   **Settings**: Stores book-specific preferences (e.g., enable Bible Lexicon) in a nested map.
*   **`useContentAnalysisStore` (Synced)**:
    *   **Goal**: Sync expensive AI artifacts (Table Adaptations, Semantic Maps) across devices.
    *   **Logic**: Maps `${bookId}/${sectionId}` to a `SectionAnalysis` object containing the semantic map (footnotes/titles) and teleprompter scripts.
    *   **Trade-off**: Large analysis objects (e.g., from books with many tables) increase the Yjs document size, potentially causing higher latency during initial sync/hydration.
*   **`useBackNavigationStore` (Local Only)**:
    *   **Goal**: Solve the "Back Button Hell" on Android where multiple components (Router, Modals, Menus) compete for the hardware back action.
    *   **Logic**: Implements a **Priority Queue** (Modal > UI > Default). Components register handlers with a priority, and the store executes only the highest-priority handler.
    *   **Trade-off**: Requires strict lifecycle management. If a component fails to unregister its handler on unmount (zombie handler), it can permanently hijack the back button and trap the user.
*   **`useLibraryStore` (Local Only)**:
    *   **Strategy**: Manages **Static Metadata** (covers, file hashes) which are too heavy for Yjs.
    *   **The "Ghost Book" Pattern**: The UI merges Synced Inventory (Yjs) with Local Static Metadata (IDB). If the local file is missing, the book appears as a "Ghost Book" using synced metadata.
*   **`useGoogleServicesStore` (Local Only)**:
    *   **Goal**: Manage connection state for Google APIs (Drive, Sync) and persist user preferences.
    *   **Logic**: Tracks which services are actively connected and stores client IDs. Used to coordinate the authentication flow via `GoogleIntegrationManager`.

#### Selector Optimization (`src/store/selectors.ts`)
*   **Goal**: Ensure smooth UI scrolling (60fps) by preventing unnecessary re-renders in the main `LibraryView`.
*   **Logic**:
    *   **Phase 1 (Base Book Memoization)**: Merges heavy static metadata (covers, titles) into book objects. Memoized on `books` + `staticMetadata` (rare changes).
    *   **Phase 2 (Progress Merge)**: Merges frequent updates (Reading Progress) into the Base Books using **Reference Stability**.
        *   *Array Item Memoization*: Reuses the *same* book object reference from the previous render if only the progress changed but the book identity/metadata is stable, allowing `React.memo` components to skip updates.
*   **Trade-offs**:
    *   **Complexity**: Requires manual management of dependency arrays and object identity, making the code harder to maintain than simple selectors.
    *   **Stale Data Risk**: If a dependency is missed, the UI will not update even if the store changes.

### Hardening & Safety Rails

*   **Database Resilience**: `DBService` wraps `QuotaExceededError` into a unified `StorageFullError` for consistent UI handling.
*   **Safe Mode**: If critical database initialization fails, the app boots into `SafeModeView`, providing a "Factory Reset" (`deleteDB`) option to unblock the user.
*   **Service Worker**: The app verifies `waitForServiceWorkerController` on launch to ensure image serving infrastructure is active, failing fast if the SW is broken.
*   **Battery Guard**: Explicitly checks Android battery optimization settings via `BatteryGuard` and warns the user if they are likely to interfere with background playback.
*   **Transactional Voice Download**: `PiperProvider` prevents corrupt voice models by ensuring files are downloaded and verified in memory before writing to persistent storage.
*   **Input Sanitization**: All text inputs to the WASM TTS engine are sanitized and chunked to prevent memory access violations or worker crashes.
*   **Process Protection**: `PlatformIntegration` runs a silent audio loop during playback to prevent Android "Phantom Process Killers" from terminating the app in the background.

### UI Layer

#### Mobile Integration
*   **Safe Area**: Uses `@capacitor-community/safe-area`.
*   **Media Session**: Managed via `MediaSessionManager` with support for artwork cropping.

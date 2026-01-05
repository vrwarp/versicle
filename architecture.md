# Versicle Architecture

## 1. High-Level Overview

Versicle is a **Local-First**, **Privacy-Centric** EPUB reader and audiobook player that runs entirely in the browser (or as a Hybrid Mobile App via Capacitor).

### Core Design Principles

1.  **Local-First & Offline-Capable**:
    *   **Why**: To provide zero-latency access, total privacy (no reading analytics sent to a server), and true ownership of data. Users should be able to read their books without an internet connection or fear of service shutdown.
    *   **How**: All data—books, annotations, progress, and settings—is stored in **IndexedDB** via the `idb` wrapper. The app is a PWA that functions completely offline.
    *   **Trade-off**: Data is bound to the device. Syncing across devices requires manual backup/restore (JSON/ZIP export), as there is no central sync server. Storage is limited by the browser's quota.

2.  **Heavy Client-Side Logic**:
    *   **Why**: To avoid server costs and maintain privacy. Features typically done on a backend (Text-to-Speech segmentation, Full-Text Indexing, File Parsing) are moved to the client.
    *   **How**:
        *   **Search**: Uses a **Web Worker** running a custom `SearchEngine` with **RegExp** scanning to find text in memory.
        *   **TTS**: Uses client-side logic (`TextSegmenter`) with JIT refinement to split text into sentences and caches audio segments locally (`TTSCache`).
        *   **Ingestion**: Parses EPUB files directly in the browser using `epub.js` and a custom **Offscreen Renderer** for accurate text extraction.
    *   **Trade-off**: Higher memory and CPU usage on the client device. Large books may take seconds to index for search or parse for ingestion.

3.  **Hybrid Text-to-Speech (TTS)**:
    *   **Why**: To balance quality, cost, and offline availability.
    *   **How**:
        *   **Local**: Uses the Web Speech API (OS native) or local WASM models (Piper) for free, offline reading.
        *   **Cloud**: Integrates with Google/OpenAI/LemonFox for high-quality neural voices, but caches generated audio to minimize API costs and latency on replay.
        *   **Table Teleprompter**: Uses Multimodal GenAI to "see" data tables and convert them into natural speech (narrative flow) instead of robotic cell reading.
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
        UIStore[useUIStore]
        ToastStore[useToastStore]
    end

    subgraph Core [Core Services]
        APS[AudioPlayerService]
        Pipeline[AudioContentPipeline]
        Ingestion[ingestion.ts]
        BatchIngestion[batch-ingestion.ts]
        SearchClient[SearchClient]
        Backup[BackupService]
        Maint[MaintenanceService]
        GenAI[GenAIService]
        CostEst[CostEstimator]
        TaskRunner[cancellable-task-runner.ts]
        MediaSession[MediaSessionManager]
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
    end

    subgraph Workers [Web Workers]
        SearchWorker[search.worker.ts]
        SearchEngine[SearchEngine]
    end

    subgraph Storage [IndexedDB]
        DBService[DBService]
        IDB[(IndexedDB)]
    end

    App --> Library
    App --> Reader
    Reader --> VisualSettings
    Reader --> AudioPanel
    Reader --> GlobalSettings
    Reader --> useEpub

    VisualSettings --> ReaderStore
    AudioPanel --> TTSStore
    GlobalSettings --> UIStore

    TTSStore --> APS
    Library --> LibStore
    LibStore --> DBService
    LibStore --> Ingestion
    LibStore --> BatchIngestion
    LibStore --> Backup
    LibStore --> Maint

    APS --> Pipeline
    APS --> PSM
    Pipeline --> GenAI
    Pipeline --> GenAIStore
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

    Piper --> PiperUtils

    Reader --> SearchClient
    SearchClient --> SearchWorker
    SearchWorker --> SearchEngine

    GenAIStore --> GenAI

    Ingestion --> DBService
    TTSCache --> DBService

    DBService --> IDB
```

## 3. Detailed Module Reference

### Data Layer (`src/db/`)

The data layer is built on **IndexedDB** using the `idb` library. It is accessed primarily through the `DBService` singleton, which provides a high-level API for all storage operations.

#### `src/db/DBService.ts`
The main database abstraction layer. It handles error wrapping (converting DOM errors to typed application errors like `StorageFullError`), transaction management, and debouncing for frequent writes.

**Key Stores (Schema v15):**
*   `books`: Metadata and 50KB thumbnail blobs.
*   `files`: The raw binary EPUB files (large).
*   `table_images`: **(New)** Stores `webp` snapshots of tables captured during ingestion. Keyed by `${bookId}-${cfi}`.
*   `content_analysis`: **(New)** Stores GenAI classification results (e.g., this block is a footnote) and table adaptations.
*   `tts_cache`: Stores generated audio segments.
*   `tts_queue`: Persistent playback queue (for resumption).
*   `tts_position`: **(New)** Lightweight position tracking (current index/section). Separate from `tts_queue` to minimize write overhead.
*   `app_metadata`: Application-level configuration and flags.
*   `reading_history`: Tracks user sessions.

**Key Functions:**
*   **`saveProgress(bookId, cfi, progress)`**: Debounced (1s) persistence of reading position.
    *   *Trade-off*: A crash within 1 second of reading might lose the very last position update.
*   **`saveTTSState` / `saveTTSPosition`**:
    *   *Logic*: `saveTTSState` writes the heavy queue object only when the playlist changes. `saveTTSPosition` writes only indices (integers) frequently during playback.
    *   *Why*: Prevents freezing the main thread with large IDB writes every second.
*   **`offloadBook(id)`**: Deletes the large binary EPUB file (`files` store) to save space but keeps metadata, annotations, and reading progress.
    *   *Trade-off*: User must re-import the *exact same file* (verified via 3-point fingerprint) to read again.

#### Hardening: Validation & Sanitization (`src/db/validators.ts`)
*   **Goal**: Prevent database corruption and XSS attacks.
*   **Logic**:
    *   **Magic Number Check**: Verifies ZIP signature (`50 4B 03 04`) before parsing.
    *   **Sanitization**: Delegates to `DOMPurify` to strip HTML tags from metadata.

### Core Logic & Services (`src/lib/`)

#### Ingestion (`src/lib/ingestion.ts`)
Handles the complex task of importing an EPUB file.

*   **`processEpub(file)`**:
    1.  **Validation**: Enforces strict ZIP signature check (`PK\x03\x04`) to reject invalid files immediately.
    2.  **Offscreen Rendering**: Uses a hidden `iframe` (via `offscreen-renderer.ts`) to render chapters.
        *   *Logic*: Scrapes text nodes for TTS and uses `@zumer/snapdom` to capture tables as structural `webp` images (enforcing white background).
    3.  **Fingerprinting**: Generates a **"3-Point Fingerprint"** (Head + Metadata + Tail) using a `cheapHash` function for O(1) duplicate detection.
    4.  **Sanitization**: Registers an `epub.js` hook to sanitize HTML content before rendering.

*   **`reprocessBook(bookId)`**:
    *   **Goal**: Update book content (e.g., better text extraction, new table snapshots) without losing reading progress or annotations.
    *   **Logic**: Re-reads the source file from the `files` store, re-runs the extraction pipeline, and performs a transactional update of `sections`, `tts_content`, and `table_images`.
    *   **Trade-off**: Computationally expensive. Requires the original file to still be present in the `files` store (i.e., not offloaded).

#### Batch Ingestion (`src/lib/batch-ingestion.ts`)
*   **Goal**: Allow bulk import of multiple EPUBs or ZIP archives containing books.
*   **Logic**:
    *   **ZIP Expansion**: Uses `JSZip` to recursively scan and extract `.epub` files from uploaded archives.
    *   **Sequential Processing**: Processes files one by one to avoid memory spikes, reporting progress to the UI.

#### Generative AI (`src/lib/genai/`)
Enhances the reading experience using LLMs.

*   **Logic**:
    *   **Service**: Wrapper around **Gemini Flash Lite** (`gemini-flash-lite-latest`) via `@google/generative-ai`.
    *   **Multimodal Input**: Accepts text and images (blobs) for tasks like table interpretation.
    *   **Structured Output**: Enforces strict JSON schemas for all responses.
        *   **Content Type**: Classifies blocks as `title`, `footnote`, `main`, `table`, or `other`.
        *   **Table Adaptation**: Converts visual table data into narrative text.
    *   **Mocking**: Supports `localStorage` mocks (`mockGenAIResponse`) for cost-free E2E testing.
*   **Trade-off**: Requires an active internet connection and a Google API Key. Privacy implication: Book text snippets/images are sent to Google's servers.

#### Search (`src/lib/search.ts` & `src/workers/search.worker.ts`)
Implements full-text search off the main thread.

*   **Logic**: Uses a simple **RegExp** scanning approach over in-memory text.
    *   *Why*: `FlexSearch` (previously used) proved too memory-intensive for typical "find on page" use cases in personal libraries.
    *   **Offloading**: XML parsing is offloaded to the worker (`DOMParser` in Worker).
*   **Trade-off**: The index is **transient** (in-memory only). It is rebuilt every time the user opens a book.

#### Backup (`src/lib/BackupService.ts`)
Manages internal state backup and restoration.

*   **`createLightBackup()`**: JSON-only export (metadata, settings, history).
*   **`createFullBackup()`**: ZIP archive containing the JSON manifest plus all original `.epub` files.
*   **`restoreBackup()`**: Implements a smart merge strategy (keeps newer progress).

#### Maintenance (`src/lib/MaintenanceService.ts`)
Handles database health.

*   **Goal**: Ensure the database is free of orphaned records (files, annotations) that no longer have a parent book.
*   **Logic**: Scans all object stores and compares IDs against the `books` store.

---

### TTS Subsystem (`src/lib/tts/`)

#### `src/lib/tts/AudioPlayerService.ts`
The Orchestrator. Manages playback state, provider selection, and UI updates.

*   **Logic**:
    *   **Delegation**: Offloads content loading to `AudioContentPipeline` and state management to `PlaybackStateManager`.
    *   **Concurrency**: Uses `TaskSequencer` (`enqueue`) to serialize public methods.

#### `src/lib/tts/AudioContentPipeline.ts`
The Data Pipeline for TTS.

*   **Goal**: Decouple "Content Loading" from "Playback Readiness".
*   **Logic (Optimistic Playback)**:
    1.  **Immediate Return**: Returns a raw, playable queue immediately so playback starts instantly.
    2.  **Background Analysis**: Fires asynchronous tasks (`detectContentSkipMask`, `processTableAdaptations`) to analyze the content in the background.
    3.  **Dynamic Updates**: When analysis completes, it triggers callbacks (`onMaskFound`, `onAdaptationsFound`) to update the *active* queue while it plays.
*   **Table Adaptation Mapping**:
    *   Uses **Precise Grouping** to match table images to their source sentences.
    *   Logic sorts table roots by length to correctly handle nested tables (longest match wins).
*   **Trade-off**: The first few seconds of playback might contain un-adapted content (e.g., reading a footnote) before the mask is applied.

#### `src/lib/tts/PlaybackStateManager.ts`
Manages the virtual playback timeline.

*   **Goal**: Abstract the complexity of skipped items and dynamic replacements from the player.
*   **Logic**:
    *   **Virtualized Timeline**: Maintains a queue where items can be marked `isSkipped` without being removed (preserving index stability).
    *   **Adaptive Prefix Sums**: Dynamically recalculates duration and seek positions based on the current mask.
    *   **Table Adaptation Strategy (Anchor + Skip)**:
        *   When a table adaptation is applied, the *first* matching queue item (Anchor) gets its text replaced with the AI narrative.
        *   All *subsequent* items belonging to that table are marked `isSkipped`.
        *   *Result*: The player reads the narrative once, then silently skips the original raw rows.

#### `src/lib/tts/providers/CapacitorTTSProvider.ts`
Native mobile TTS integration.

*   **Goal**: Gapless playback on Android/iOS.
*   **Logic (Smart Handoff)**: Uses `queueStrategy: 1` to preload the next utterance into the OS buffer while the current one plays.

#### `src/lib/tts/providers/PiperProvider.ts`
Local WASM Neural TTS.

*   **Transactional Download**: Verifies integrity before committing to Cache API.
*   **Resilience**: Uses a "Let It Crash" strategy for the worker (Error Boundary resets the worker on failure).

---

### Reader Subsystem (`src/hooks/`)

#### CFI Normalization & Precise Grouping (`src/lib/cfi-utils.ts`)
*   **Goal**: Ensure annotations and TTS playback align perfectly with logical text blocks.
*   **Logic**:
    *   **Leaf Stripping**: Strips leaf offsets to target the containing block element.
    *   **Precise Grouping**: Explicitly snaps selection to known structural roots (like `<table>`, `<div>`) using a colon-delimiter heuristic. This ensures that complex elements (tables) are treated as atomic blocks for GenAI analysis.
*   **Trade-off**: Sacrifices granular addressing within complex structures (e.g., cannot highlight a single cell in a table).

---

### State Management (`src/store/`)

State is managed using **Zustand**.

*   **`useReaderStore`**: Persists visual preferences.
*   **`useTTSStore`**: Persists TTS settings.
*   **`useGenAIStore`**: Persists AI settings and usage stats.
*   **`useLibraryStore`**: Transient UI state.

### UI Layer

#### Mobile Integration
*   **Safe Area**: Uses `@capacitor-community/safe-area`.
*   **Media Session**: Managed via `MediaSessionManager` with support for artwork cropping.

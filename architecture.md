# Versicle Architecture

## 1. High-Level Overview

Versicle is a **Local-First**, **Privacy-Centric** EPUB reader and audiobook player that runs entirely in the browser (or as a Hybrid Mobile App via Capacitor).

### Core Design Principles

1.  **Local-First & Offline-Capable**:
    *   **Why**: To provide zero-latency access, total privacy (no reading analytics sent to a server), and true ownership of data. Users should be able to read their books without an internet connection or fear of service shutdown.
    *   **How**: All data—books, annotations, progress, and settings—is stored in **IndexedDB** via the `idb` wrapper. The app is a PWA that functions completely offline.
    *   **Trade-off**: Data is bound to the device. Syncing across devices requires manual backup/restore (JSON/ZIP export), as there is no central sync server. Storage is limited by the browser's quota (though usually generous).

2.  **Heavy Client-Side Logic**:
    *   **Why**: To avoid server costs and maintain privacy. Features typically done on a backend (Text-to-Speech segmentation, Full-Text Indexing, File Parsing) are moved to the client.
    *   **How**:
        *   **Search**: Uses a **Web Worker** running a custom `SearchEngine` with **RegExp** scanning to find text in memory.
        *   **TTS**: Uses client-side logic (`TextSegmenter`) to split text into sentences and caches audio segments locally (`TTSCache`).
        *   **Ingestion**: Parses EPUB files directly in the browser using `epub.js` and a custom **Offscreen Renderer** for accurate text extraction.
    *   **Trade-off**: Higher memory and CPU usage on the client device. Large books may take seconds to index for search or parse for ingestion.

3.  **Hybrid Text-to-Speech (TTS)**:
    *   **Why**: To balance quality, cost, and offline availability.
    *   **How**:
        *   **Local**: Uses the Web Speech API (OS native) or local WASM models (Piper) for free, offline reading.
        *   **Cloud**: Integrates with Google/OpenAI/LemonFox for high-quality neural voices, but caches generated audio to minimize API costs and latency on replay.
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
        ReadingListStore[useReadingListStore]
    end

    subgraph Core [Core Services]
        APS[AudioPlayerService]
        Ingestion[ingestion.ts]
        BatchIngestion[batch-ingestion.ts]
        SearchClient[SearchClient]
        Backup[BackupService]
        Maint[MaintenanceService]
        GenAI[GenAIService]
        CostEst[CostEstimator]
        TaskRunner[cancellable-task-runner.ts]
    end

    subgraph TTS [TTS Subsystem]
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
    GlobalSettings --> ReadingListStore

    TTSStore --> APS
    Library --> LibStore
    LibStore --> DBService
    LibStore --> Ingestion
    LibStore --> BatchIngestion
    LibStore --> Backup
    LibStore --> Maint

    APS --> Providers
    APS --> Segmenter
    APS --> Lexicon
    APS --> TTSCache
    APS --> Sync
    APS --> Piper
    APS --> CostEst
    APS --> BG

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

**Key Functions:**

*   **`getLibrary()`**: Retrieves all books. Validates metadata integrity using `validators.ts` and sorts by import date.
    *   *Returns*: `Promise<BookMetadata[]>`
*   **`getBook(id)`**: Retrieves both metadata and the binary EPUB file.
    *   *Returns*: `Promise<{ metadata: BookMetadata; file: Blob | ArrayBuffer }>`
*   **`addBook(file)`**: Imports a new book. Delegates parsing to `ingestion.ts`.
*   **`saveProgress(bookId, cfi, progress)`**: Saves reading progress.
    *   *Implementation*: Debounced (1s) to prevent thrashing IndexedDB during scrolling/reading.
    *   *Trade-off*: A crash within 1 second of reading might lose the very last position update.
*   **`saveTTSState(bookId, queue, currentIndex)`**: Persists the current TTS playlist and position.
    *   *Why*: Allows the user to close the app and resume the audiobook exactly where they left off.
*   **`offloadBook(id)`**: Deletes the large binary EPUB file to save space but keeps metadata, annotations, and reading progress. Sets `isOffloaded: true`.
    *   *Trade-off*: User must re-import the *exact same file* (verified via 3-point fingerprint) to read again.
*   **`restoreBook(id, file)`**: Restores an offloaded book. Verifies the file fingerprint matches the original before accepting.
*   **`updateReadingHistory(bookId, newRange, type)`**: Records reading sessions.
    *   *Logic*: Merges overlapping ranges. Coalesces events within 5 minutes into a single session to prevent database bloat.
    *   *Limits*: Enforces a rolling window of the last 100 sessions per book.

#### Hardening: Validation & Sanitization (`src/db/validators.ts` & `src/lib/sanitizer.ts`)
*   **Goal**: Prevent database corruption and XSS attacks from malicious EPUB metadata.
*   **Logic**:
    *   **`validateBookMetadata`**: Ensures required fields (ID, Title, AddedAt) exist.
    *   **`sanitizeString`**: Delegates to `DOMPurify` (via `src/lib/sanitizer.ts`) to strip all HTML tags from metadata fields (Title, Author), ensuring only plain text remains.
*   **Trade-off**: Stripping HTML removes formatting in book descriptions, but ensures safety against stored XSS.

#### Resilience: Safe Mode (`src/components/SafeModeView.tsx`)
*   **Goal**: Provide a recovery path if IndexedDB fails to initialize (e.g., corruption or storage quota exceeded).
*   **Logic**: Catches global initialization errors and offers the user a choice to **Retry** or **Reset Database** (destructive).

### Core Logic & Services (`src/lib/`)

#### Ingestion (`src/lib/ingestion.ts`)
Handles the complex task of importing an EPUB file.

*   **`processEpub(file)`**:
    1.  **Validation**: Checks ZIP headers (magic bytes) to ensure file validity.
    2.  **Offscreen Rendering**: Uses a hidden `<iframe>` (via `offscreen-renderer.ts`) to render chapters. This ensures that the extracted text and CFIs match *exactly* what the user will see/hear, which is critical for accurate TTS synchronization.
    3.  **Parsing**: Uses `epub.js` to parse the container.
    4.  **Synthetic TOC**: Iterates through the spine to generate a table of contents and calculate character counts (for reading time estimation).
    5.  **Fingerprinting**: Generates a **"3-Point Fingerprint"** based on metadata (filename, title, author) and head/tail file sampling.
        *   *Refactoring*: Replaced full-file SHA-256 hashing (which was slow and memory-intensive) with this constant-time O(1) check.
        *   *Trade-off*: Theoretical risk of collision is negligible for personal library scale, while performance gain is massive.
    6.  **Sanitization**: Uses `DOMPurify` to strip HTML and scripts from metadata fields, and enforces character limits (e.g. 255 chars for Author).
    *   *Returns*: `Promise<string>` (New Book ID).

#### Batch Ingestion (`src/lib/batch-ingestion.ts`)
*   **Goal**: Allow bulk import of multiple EPUBs or ZIP archives containing books.
*   **Logic**:
    *   **ZIP Expansion**: Uses `JSZip` to recursively scan and extract `.epub` files from uploaded archives.
    *   **Sequential Processing**: Processes files one by one to avoid memory spikes, reporting progress to the UI.
*   **Trade-off**: Processing a large ZIP happens on the main thread (mostly), which might cause minor UI jank, though `JSZip` is async.

#### Search (`src/lib/search.ts` & `src/workers/search.worker.ts`)
Implements full-text search off the main thread to prevent UI freezing.

*   **`SearchClient`**: The main-thread interface.
*   **`SearchEngine`**: Runs inside the Worker.
*   **Logic**: Uses a simple **RegExp** scanning approach over in-memory text.
    *   *Why*: `FlexSearch` (previously used) proved too memory-intensive and complex for typical "find on page" use cases in personal libraries.
    *   *Logic*: Maintains a `Map<BookID, Map<Href, Text>>`. Performs linear scan for matches.
*   **Communication**: Uses **`comlink`** to proxy method calls to the worker.
*   **Trade-off**: The index is **transient** (in-memory only). It is rebuilt every time the user opens a book. Linear scanning is slower than an inverted index for massive corpora but perfectly adequate for single books.

#### Backup (`src/lib/BackupService.ts`)
Manages internal state backup and restoration (JSON/ZIP).

*   **`createMetadataBackup()`**: Exports JSON containing metadata, themes, settings, and reading history ("Light Backup").
*   **`createFullBackup()`**: Exports a ZIP file containing the "Light" JSON manifest plus all original `.epub` files ("Full Backup").
    *   *Logic*: Uses `JSZip` to stream file content from IndexedDB into a downloadable archive.

#### Data Portability (`src/lib/csv.ts`)
Handles interoperability with external reading trackers (Goodreads).

*   **Goal**: Allow users to import/export their reading lists and status without vendor lock-in.
*   **Logic**:
    *   **Parsing**: Uses `PapaParse` to handle CSV complexity (quoted fields, newlines).
    *   **Heuristics**: If the CSV lacks a unique filename (e.g. Goodreads export), it generates a deterministic ID from ISBN or Title+Author.
    *   **Normalization**: Maps various status strings (e.g., "to-read", "want to read") to internal states.
*   **Trade-off**: Fuzzy matching by Title/Author when ISBN is missing can be imprecise (e.g., different editions of the same book).

#### Maintenance (`src/lib/MaintenanceService.ts`)
Handles database health and integrity.

*   **Goal**: Ensure the database is free of orphaned records (files, annotations, lexicon rules) that no longer have a parent book.
*   **Logic**: Scans all object stores (`files`, `annotations`, `locations`, `lexicon`) and compares IDs against the `books` store.
*   **Trade-off**: `pruneOrphans()` is a destructive operation. If logic is flawed, valid data could be lost. It is designed to be run manually or on specific error conditions.

#### Generative AI (`src/lib/genai/`)
Enhances the reading experience using LLMs (Google Gemini).

*   **Goal**: Provide features like "Smart Table of Contents" generation, summarization, and text analysis.
*   **Logic**:
    *   **`GenAIService`**: Singleton wrapper around `@google/generative-ai`. Handles API configuration and request logging.
    *   **`generateStructured`**: Uses Gemini's JSON schema enforcement to return strictly typed data (e.g., TOC structure).
    *   **`textMatching.ts`**: Provides fuzzy matching to locate AI-generated quotes/references back in the original source text (handling whitespace/case differences).
*   **Trade-off**: Requires an active internet connection and a Google API Key. Privacy implication: Book text snippets are sent to Google's servers.

#### Cost Estimator (`src/lib/tts/CostEstimator.ts`)
*   **Goal**: Provide users with a rough estimate of API costs for Cloud TTS usage during a session.
*   **Logic**: Tracks total characters sent to paid providers (Google, OpenAI) in a transient Zustand store (`useCostStore`).
*   **Trade-off**: Estimates are client-side approximations and do not account for billing nuances (e.g., minimum request size, retries).

#### Utilities

*   **`cancellable-task-runner.ts`**:
    *   **Goal**: Manage async flows that need to be aborted (e.g., `useEffect` data fetching).
    *   **Logic**: Uses Generators to yield Promises. This allows the runner to inject a `CancellationError` at any yield point, effectively halting execution and triggering `finally` cleanup blocks.
    *   **Why**: Standard Promises are not cancellable. AbortController is clunky for complex logic.

---

### TTS Subsystem (`src/lib/tts/`)

This is the most complex subsystem, handling audio generation, synchronization, and playback control. It is designed as a modular pipeline.

#### `src/lib/tts/AudioPlayerService.ts`
The singleton controller (Orchestrator).

*   **Goal**: Manage the playback queue, provider selection, and state machine (`playing`, `paused`, `loading`, etc.).
*   **Logic**:
    *   **Concurrency**: Uses a **Sequential Promise Chain** (`enqueue`) to serialize async operations (play, pause, next). This replaces the previous complex Mutex pattern.
    *   **Media Session**: Integrates with the OS Media Session API (lock screen controls) via `MediaSessionManager`.

#### `src/lib/tts/LexiconService.ts`
Manages pronunciation rules.

*   **Goal**: Fix mispronounced words (e.g., names, fantasy terms).
*   **Logic**: Applies a list of replacement rules to text *before* sending it to the TTS provider.
    *   **Rules**: Supports simple string replacement and **RegExp**.
    *   **Scoping**: Rules can be Global (apply to all books) or Scoped (apply to a specific book ID).
    *   **Order**: Scoped rules take precedence, followed by Global rules.

#### `src/lib/tts/TextSegmenter.ts`
Splits raw text into natural-sounding sentences.

*   **Logic**: Uses `Intl.Segmenter` (browser native) augmented with a custom Rules Engine.
*   **Hardening**:
    *   **Abbreviation Handling**: Merges splits caused by common abbreviations (e.g., "Mr.", "Dr.") using a whitelist.
    *   **Sentence Starters**: Checks if the next segment starts with a lowercase letter (indicating a false split).

#### `src/lib/tts/TTSCache.ts`
Persists synthesized audio to IndexedDB.

*   **Logic**: Generates a cache key based on `text + voiceId + speed + pitch + lexiconHash`.
*   **Benefit**: If you re-listen to a chapter, it plays instantly and costs zero API credits.

#### `src/lib/tts/SyncEngine.ts`
Manages visual "Karaoke" synchronization.

*   **Logic**: Binary search (or optimized scan) through time-alignment data provided by the TTS provider to highlight the current word/sentence.

#### `src/lib/tts/AudioElementPlayer.ts`
Low-level wrapper around the HTML5 `<audio>` element.

*   **Goal**: Abstract resource management for Blob-based playback used by `BaseCloudProvider` (Piper, OpenAI, etc.).
*   **Logic**: Automatically revokes `ObjectURLs` on track end or stop to prevent memory leaks.

#### `src/lib/tts/BackgroundAudio.ts`
*   **Goal**: Prevent mobile operating systems (iOS/Android) from killing the app or pausing audio when the screen is locked or the app is in the background.
*   **Logic**:
    *   **Web**: Plays a silent loop (or optional white noise) to keep the OS Media Session active.
    *   **Android**: Upgrades to a **Foreground Service** (via `@capawesome-team/capacitor-android-foreground-service`) which displays a persistent notification. This signals to Android that the app is "active" and should not be killed.
*   **Trade-off**: "Hack" solution required due to restrictive mobile browser policies (iOS). Foreground Service requires explicit permissions on Android.

#### TTS Processors & Extraction
*   **`Sanitizer.ts` (TTS-Specific)**: Located in `src/lib/tts/processors/`. Cleans text *before* speech generation. Removes page numbers, citations, and URLs to improve listening flow.
*   **`extractSentencesFromNode` (`src/lib/tts.ts`)**: The bridge between the DOM (rendered in `offscreen-renderer`) and the `TextSegmenter`. Traverses the DOM tree to extract text nodes while respecting block-level tags.

#### `src/lib/tts/providers/`
Plugin architecture for TTS backends. All providers implement `ITTSProvider`.
*   **`PiperProvider`**: Runs local WASM models. Use `piper-utils.ts` to manage the Worker.
    *   **Transactional Download**: Downloads model files to memory first, verifies integrity (by attempting a test synthesis), and only *then* commits them to the Cache API. This prevents corrupted partial downloads.
    *   **Stitching**: If a sentence is too long for the model, it is split into chunks, synthesized separately, and the resulting WAV blobs are stitched together (rewriting RIFF headers) into a single seamless audio file.
*   **`CloudProvider`**: Adapts Google/OpenAI APIs.
*   **`LemonFoxProvider`**: Adapts LemonFox.ai API (OpenAI-compatible) for lower cost.
*   **`CapacitorTTSProvider`**: Wraps `@capacitor-community/text-to-speech` for native mobile playback.
*   **`WebSpeechProvider`**: Adapts browser native synthesis.

#### Resilience: `piper-utils.ts` ("Let It Crash")
*   **Goal**: Prevent the application from entering invalid states if the Piper WASM worker crashes.
*   **Logic**: Instead of a complex "Supervisor" that attempts restarts, we use a simple **Error Boundary** pattern. If the worker crashes or errors, the current request rejects immediately. The worker is terminated, and a fresh instance is lazily created on the next request.
*   **Philosophy**: Simplicity > Complex Recovery.

---

### Reader Subsystem (`src/hooks/`)

#### `src/hooks/useEpubReader.ts`
The critical bridge between React and the imperative `epub.js` library.

**Responsibilities:**
*   **Lifecycle**: Initializes/destroys `Book` and `Rendition`.
*   **View Modes**: Handles `paginated` vs `scrolled-doc` flow.
*   **Hardening**:
    *   **ResizeObserver**: Uses debounced resize logic to prevent layout thrashing on window resize.
    *   **Force Font**: Injects high-specificity CSS (`!important`) to override stubborn publisher styles when "Force Font" is enabled.
    *   **Selection Fallback**: Implements a manual `mouseup` listener because `epub.js`'s native `selected` event can be unreliable after DOM manipulation.
    *   **Context Menu**: Blocks the default context menu to improve the mobile long-press experience.
*   **Location**: Generates and caches location data to allow accurate scrollbar progress.

---

### State Management (`src/store/`)

State is managed using **Zustand** with persistence to `localStorage` for preferences.

*   **`useReaderStore`**: Manages the visual reader preferences.
    *   *Persisted*: `currentTheme`, `fontFamily`, `fontSize`, `lineHeight`, `viewMode`, `gestureMode`.
    *   *Transient*: `currentBookId`, `currentCfi` (location is synced to IDB, transient copy here for UI), `toc`.
*   **`useTTSStore`**: Manages TTS configuration and acts as the reactive bridge to `AudioPlayerService`.
    *   *Persisted*: `voice`, `rate`, `pitch`, `apiKeys`, `providerId`, `customAbbreviations`.
    *   *Transient*: `isPlaying`, `queue`, `currentIndex`, `activeCfi` (synced via subscription to `AudioPlayerService`).
    *   *Interaction*: Subscribes to `AudioPlayerService` events to update the UI.
*   **`useGenAIStore`**: Manages AI settings (API key, model) and usage logs.
    *   *Persisted*: `apiKey`, `model`, `isEnabled`, `logs`, `usageStats`.
*   **`useUIStore`**: Manages global UI state (e.g., `isGlobalSettingsOpen`). Transient.
*   **`useToastStore`**: Manages global ephemeral notifications (Success/Error feedback). Transient.
*   **`useReadingListStore`**: Manages the exportable reading list.
    *   *Logic*: Syncs with IDB `reading_list` store. Handles CSV import/export.

### UI Layer

#### Theme Synchronization (`src/components/ThemeSynchronizer.tsx`)
*   **Goal**: Ensure the global UI (Tailwind classes) matches the Reader's theme (Light/Dark/Sepia).
*   **Logic**: Subscribes to `useReaderStore` and toggles classes on `document.documentElement`.

### Common Types (`src/types/db.ts`)
*   **`BookMetadata`**: Includes `fileHash`, `isOffloaded`, `coverBlob`, and playback state (`lastPlayedCfi`).
*   **`Annotation`**: Stores highlights (`cfiRange`, `color`) and notes.
*   **`LexiconRule`**: Regex or string replacement rules for TTS pronunciation.

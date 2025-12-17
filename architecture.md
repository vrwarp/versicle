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
        *   **Search**: Uses a **Web Worker** running `FlexSearch` to build an in-memory index of the book on demand.
        *   **TTS**: Uses client-side logic (`TextSegmenter`) to split text into sentences and caches audio segments locally (`TTSCache`).
        *   **Ingestion**: Parses EPUB files directly in the browser using `epub.js` and `JSZip`.
    *   **Trade-off**: Higher memory and CPU usage on the client device. Large books may take seconds to index for search or parse for ingestion.

3.  **Hybrid Text-to-Speech (TTS)**:
    *   **Why**: To balance quality, cost, and offline availability.
    *   **How**:
        *   **Local**: Uses the Web Speech API (OS native) or local WASM models (Piper) for free, offline reading.
        *   **Cloud**: Integrates with Google/OpenAI for high-quality neural voices, but caches generated audio to minimize API costs and latency on replay.
    *   **Stability**: The system implements a robust fallback mechanism. If a cloud provider fails, it automatically switches to a local provider.

## 2. System Architecture Diagram

```mermaid
graph TD
    subgraph Frontend [React UI]
        App[App.tsx]
        Library[LibraryView]
        Reader[ReaderView]
        TTSController[ReaderTTSController]
        AudioPanel[UnifiedAudioPanel]
        useEpub[useEpubReader Hook]
    end

    subgraph State [Zustand Stores]
        ReaderStore[useReaderStore]
        TTSStore[useTTSStore]
        LibStore[useLibraryStore]
        AnnotStore[useAnnotationStore]
    end

    subgraph Core [Core Services]
        APS[AudioPlayerService]
        Ingestion[ingestion.ts]
        SearchClient[SearchClient]
        Backup[BackupService]
        Maint[MaintenanceService]
    end

    subgraph TTS [TTS Subsystem]
        Segmenter[TextSegmenter]
        Lexicon[LexiconService]
        TTSCache[TTSCache]
        Sync[SyncEngine]
        Providers[ITTSProvider]
        Piper[PiperProvider (WASM)]
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
    Reader --> ReaderStore
    Reader --> TTSController
    Reader --> AudioPanel
    Reader --> useEpub

    AudioPanel --> TTSStore
    TTSStore --> APS

    APS --> Providers
    APS --> Segmenter
    APS --> Lexicon
    APS --> TTSCache
    APS --> Sync
    APS --> Piper

    Library --> LibStore
    LibStore --> DBService
    LibStore --> Ingestion
    LibStore --> Backup
    LibStore --> Maint

    Reader --> SearchClient
    SearchClient --> SearchWorker
    SearchWorker --> SearchEngine

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
    *   *Trade-off*: User must re-import the *exact same file* (verified via SHA-256 hash) to read again.
*   **`restoreBook(id, file)`**: Restores an offloaded book. Verifies `fileHash` matches the original before accepting.
*   **`updateReadingHistory(bookId, newRange)`**: Merges a new CFI range into the book's reading history to track "read" status.

### Core Logic & Services (`src/lib/`)

#### Ingestion (`src/lib/ingestion.ts`)
Handles the complex task of importing an EPUB file.

*   **`processEpub(file)`**:
    1.  **Validation**: Checks ZIP headers (magic bytes) to ensure file validity.
    2.  **Parsing**: Uses `epub.js` to parse the container.
    3.  **Synthetic TOC**: Iterates through the spine to generate a table of contents and calculate character counts (for reading time estimation).
    4.  **Hashing**: Computes a SHA-256 hash of the file incrementally (chunked) to avoid memory spikes. Used for integrity checks during restore.
    5.  **Sanitization**: Checks metadata length. Prompts the user if metadata fields are excessively long (security/UI hardening).
    *   *Returns*: `Promise<string>` (New Book ID).

#### Search (`src/lib/search.ts` & `src/workers/search.worker.ts`)
Implements full-text search off the main thread to prevent UI freezing.

*   **`SearchClient`**: The main-thread interface. Manages the Worker lifecycle and request/response correlation using UUIDs.
*   **`SearchEngine`**: Runs inside the Worker. Uses `FlexSearch` to build an inverted index.
*   **Trade-off**: The index is **transient** (in-memory only). It is rebuilt every time the user opens a book and initiates a search. This avoids storing massive indices in IndexedDB but adds a delay before search is ready for large books.

#### Backup (`src/lib/BackupService.ts`)
Manages data portability.

*   **`createLightBackup()`**: Exports JSON containing metadata, annotations, lexicon, and reading stats.
*   **`createFullBackup()`**: Exports a ZIP file containing the "Light" JSON manifest plus all EPUB files (fetched from IDB).
*   **`restoreBackup(file)`**: Smartly merges data.
    *   **Smart Merge**: If a book already exists, it updates progress only if the backup is newer.
    *   **Sanitization**: Validates and sanitizes metadata from the backup before import.

#### Maintenance (`src/lib/MaintenanceService.ts`)
Handles database health.

*   **`scanForOrphans()`**: Identifies files, annotations, or lexicon rules that reference non-existent books.
*   **`pruneOrphans()`**: Deletes identified orphaned records to reclaim storage space.

---

### TTS Subsystem (`src/lib/tts/`)

This is the most complex subsystem, handling audio generation, synchronization, and playback control.

#### `src/lib/tts/AudioPlayerService.ts`
The singleton controller for TTS. It acts as the "brain" of the audio experience.

**Key Responsibilities:**
*   **State Machine**: Manages states (`playing`, `paused`, `stopped`, `loading`, `completed`).
*   **Queue Management**: Maintains a list of `TTSQueueItem`s (sentences).
*   **Provider Management**: Hot-swaps between providers (Google, OpenAI, Piper, WebSpeech).
*   **Concurrency**: Uses `executeWithLock` (Mutex pattern) to prevent race conditions when the user taps multiple controls rapidly.
*   **Smart Resume**: Resumes playback from `lastPauseTime` if available, or falls back to `lastPlayedCfi`.
*   **Background Audio**: Uses a silent audio track strategy (`BackgroundAudio.ts`) and Capacitor Foreground Service to keep the app alive on Android/iOS when the screen is off.
*   **Error Handling**: Implements automatic fallback from Cloud to Local providers if an API call fails.

#### `src/lib/tts/TextSegmenter.ts`
Splits raw text into natural-sounding sentences.

*   **Logic**: Uses `Intl.Segmenter` (browser native) where available.
*   **Hardening**: Implements a custom post-processing step to merge sentences split incorrectly by abbreviations (e.g., "Mr.", "Dr.", "i.e."). Uses a list of "Always Merge" abbreviations and "Sentence Starters" (pronouns) to make intelligent decisions.

#### `src/lib/tts/SyncEngine.ts`
*   **Purpose**: Manages the visual karaoke-style highlighting.
*   **Logic**: Efficiently searches a sorted list of `AlignmentData` (timepoints) to find the active word/sentence based on current playback time.

#### `src/lib/tts/TTSCache.ts`
*   **Purpose**: Caches generated audio buffers in IndexedDB (`tts_cache` store).
*   **Key Generation**: Hash of `text + voiceId + speed + pitch + lexiconHash`. If any parameter changes (including lexicon rules), a new segment is generated.

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

### Common Types (`src/types/db.ts`)
*   **`BookMetadata`**: Includes `fileHash`, `isOffloaded`, `coverBlob`, and playback state (`lastPlayedCfi`).
*   **`Annotation`**: Stores highlights (`cfiRange`, `color`) and notes.
*   **`LexiconRule`**: Regex or string replacement rules for TTS pronunciation.

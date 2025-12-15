# Versicle Architecture

## 1. High-Level Overview

Versicle is a **Local-First**, **Privacy-Centric** EPUB reader and audiobook player that runs entirely in the browser (or as a Hybrid Mobile App).

### Core Design Principles

1.  **Local-First & Offline-Capable**:
    *   **Why**: To provide zero-latency access, total privacy (no reading analytics sent to a server), and true ownership of data.
    *   **How**: All data—books, annotations, progress, and settings—is stored in **IndexedDB** via the `idb` wrapper. The app is a PWA that functions without an internet connection.
    *   **Trade-off**: Data is bound to the device. Syncing across devices requires manual backup/restore (JSON/ZIP export), as there is no central sync server.

2.  **Heavy Client-Side Logic**:
    *   **Why**: To avoid server costs and maintain privacy. Features typically done on a backend (Text-to-Speech segmentation, Full-Text Indexing, File Parsing) are moved to the client.
    *   **How**:
        *   **Search**: Uses a **Web Worker** running `FlexSearch` to build an in-memory index of the book on demand.
        *   **TTS**: Uses client-side logic (`TextSegmenter`) to split text into sentences and caches audio segments locally (`TTSCache`).
    *   **Trade-off**: Higher memory and CPU usage on the client device. Large books may take seconds to index for search.

3.  **Hybrid Text-to-Speech (TTS)**:
    *   **Why**: To balance quality, cost, and offline availability.
    *   **How**:
        *   **Local**: Uses the Web Speech API or local WASM models (Piper) for free, offline reading.
        *   **Cloud**: Integrates with Google/OpenAI for high-quality neural voices, but caches generated audio to minimize API costs.

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
    end

    subgraph TTS [TTS Engine]
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

    Reader --> SearchClient
    SearchClient --> SearchWorker
    SearchWorker --> SearchEngine

    Ingestion --> DBService
    TTSCache --> DBService

    DBService --> IDB
```

## 3. Detailed Module Reference

### Data Layer (`src/db/`)

The data layer is built on **IndexedDB** using the `idb` library. It is accessed primarily through the `DBService` singleton.

#### `src/db/DBService.ts`
The main database abstraction layer. Handles all read/write operations, transactions, and error handling.

**Class: `DBService`**

*   **`getLibrary()`**
    *   **Purpose**: Retrieves all books in the library.
    *   **Returns**: `Promise<BookMetadata[]>` - List of validated book metadata sorted by import date.
*   **`getBook(id)`**
    *   **Purpose**: Retrieves metadata and binary file for a book.
    *   **Params**: `id: string` - Unique identifier.
    *   **Returns**: `Promise<{ metadata: BookMetadata; file: Blob | ArrayBuffer }>`
*   **`addBook(file)`**
    *   **Purpose**: Imports a new book (delegates to `processEpub`).
    *   **Params**: `file: File`.
    *   **Returns**: `Promise<void>`
*   **`saveProgress(bookId, cfi, progress)`**
    *   **Purpose**: Saves reading progress (Debounced 1s).
    *   **Params**: `bookId: string`, `cfi: string`, `progress: number`.
    *   **Returns**: `void`
*   **`saveTTSState(bookId, queue, currentIndex)`**
    *   **Purpose**: Persists the TTS playback queue to allow session resumption.
    *   **Params**: `bookId: string`, `queue: TTSQueueItem[]`, `currentIndex: number`.
    *   **Returns**: `void`
*   **`updateReadingHistory(bookId, newRange)`**
    *   **Purpose**: Updates the "read" coverage of a book.
    *   **Params**: `bookId: string`, `newRange: string` (CFI Range).
    *   **Returns**: `Promise<void>`
*   **`cacheSegment(key, audio, alignment?)`**
    *   **Purpose**: Stores a generated audio segment in the `tts_cache` store.
    *   **Params**: `key: string` (Hash), `audio: ArrayBuffer`.
    *   **Returns**: `Promise<void>`
*   **`offloadBook(id)`**
    *   **Purpose**: Removes the binary file to save space but preserves metadata.
    *   **Params**: `id: string`.
    *   **Returns**: `Promise<void>`

---

### Core Logic & Services (`src/lib/`)

#### Ingestion (`src/lib/ingestion.ts`)
Handles the parsing and import of EPUB files.

*   **`processEpub(file)`**
    *   **Purpose**: Parses EPUB using `epub.js`, extracts metadata, generates a **Synthetic TOC**, and calculates character counts for every section.
    *   **Params**: `file: File`.
    *   **Returns**: `Promise<string>` (New Book ID).
    *   **Note**: Synthetic TOC generation involves loading every chapter to ensure accurate progress bars and TTS duration estimates.

#### Search (`src/lib/search.ts`)
Client-side interface for the Search Worker.

**Class: `SearchClient`**
*   **`indexBook(book, bookId)`**
    *   **Purpose**: Extracts text from the book spine and sends it to the worker for indexing.
    *   **Params**: `book: Book` (epub.js instance), `bookId: string`.
    *   **Returns**: `Promise<void>`
    *   **Note**: The index is **transient** (in-memory within the worker) and is rebuilt every time the book is loaded.
*   **`search(query, bookId)`**
    *   **Purpose**: Queries the worker.
    *   **Params**: `query: string`, `bookId: string`.
    *   **Returns**: `Promise<SearchResult[]>`

---

### Text-to-Speech Subsystem (`src/lib/tts/`)

#### `src/lib/tts/AudioPlayerService.ts`
The singleton controller for TTS.

**Class: `AudioPlayerService`**
*   **`play()` / `pause()` / `resume()`**
    *   **Purpose**: Controls playback state. Uses `executeWithLock` to prevent race conditions.
*   **`setQueue(items, startIndex)`**
    *   **Purpose**: Updates the playlist and persists it to DB.
    *   **Params**: `items: TTSQueueItem[]`, `startIndex: number`.
*   **`setProvider(provider)`**
    *   **Purpose**: Hot-swaps the TTS provider (e.g., from Google to Piper).
    *   **Params**: `provider: ITTSProvider`.

#### `src/lib/tts/providers/PiperProvider.ts`
**Class: `PiperProvider`**
*   **Purpose**: Implements local Neural TTS using WebAssembly.
*   **`downloadVoice(voiceId)`**
    *   **Purpose**: Downloads ONNX model and config from Hugging Face.
    *   **Params**: `voiceId: string`.
    *   **Returns**: `Promise<void>`
*   **`fetchAudioData(text, options)`**
    *   **Purpose**: Generates audio using the WASM worker.
    *   **Returns**: `Promise<SpeechSegment>`

---

### State Management (`src/store/`)

#### `src/store/useReaderStore.ts`
*   **State**: `currentTheme`, `fontSize`, `viewMode`, `gestureMode`.
*   **Persistence**: Uses `localStorage` for user preferences. Reading location is loaded from `DBService`.

#### `src/store/useTTSStore.ts`
*   **State**: `voice`, `rate`, `apiKeys`.
*   **Behavior**: Subscribes to `AudioPlayerService` to sync playback status (`isPlaying`, `currentIndex`) to the UI.

---

### UI Hooks (`src/hooks/`)

#### `src/hooks/useEpubReader.ts`
*   **Purpose**: Manages `epub.js` lifecycle, rendering, and resizing.
*   **Params**: `bookId`, `viewerRef`, `options`.
*   **Returns**: `rendition`, `book`, `isReady`.
*   **Key Logic**: Injects custom CSS (`shouldForceFont`) to override publisher styles for consistent theming.

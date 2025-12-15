# Versicle Architecture Documentation

## 1. System Overview and Context

**Versicle** is a local-first, privacy-focused Progressive Web App (PWA) designed for advanced EPUB reading and listening. Unlike cloud-centric readers, Versicle operates entirely within the user's browser, ensuring that personal library data, reading progress, and annotations remain private and accessible offline.

### Core Objectives
*   **Privacy & Ownership**: No user data is sent to a central server. The "backend" is the user's own device (IndexedDB).
*   **Performance**: Utilizes Web Workers for heavy tasks (search indexing) and efficient caching strategies for binary assets.
*   **Accessibility**: Features a sophisticated Text-to-Speech (TTS) engine with karaoke-style highlighting, supporting both offline browser voices and high-quality cloud neural voices.
*   **Platform Independence**: Runs as a PWA on desktop/mobile and as a native Android app via Capacitor.

### System Boundaries
*   **Internal**: The application logic resides entirely in the browser client.
*   **External Integration**:
    *   **Cloud TTS APIs**: (Optional) Connects to Google Cloud, OpenAI, or LemonFox for premium voice synthesis.
    *   **Browser APIs**: Heavily relies on IndexedDB, Web Workers, Web Speech API, and Media Session API.
    *   **Capacitor (Mobile)**: Bridges the web app to native Android APIs (Filesystem, Foreground Service, Notifications).

---

## 2. Architectural Decisions and Rationale

### Local-First Data Strategy (IndexedDB)
*   **Decision**: Use **IndexedDB** (via `idb` library) as the primary system of record.
*   **Rationale**: Ensures full offline capability and privacy. Storing large binary EPUB files and audio caches requires more storage than `localStorage` provides. `idb` simplifies the complex native IndexedDB API.

### Rendering Engine (`epub.js`)
*   **Decision**: Adopt `epub.js` for parsing and rendering EPUB files.
*   **Rationale**: It is the industry-standard open-source library for EPUB rendering in the browser, providing robust support for the spine, table of contents, and CFI (Canonical Fragment Identifier) location standards.

### State Management (Zustand)
*   **Decision**: Use **Zustand** with persistence middleware.
*   **Rationale**: React Context is insufficient for frequent updates (like playback progress), and Redux is too boilerplate-heavy. Zustand offers a minimal API, easy integration with `localStorage` for UI preferences, and decouples state logic from UI components.

### Text-to-Speech (TTS) Architecture
*   **Decision**: Implement a **Hybrid Engine** with a custom `AudioPlayerService` singleton.
*   **Rationale**:
    *   **Hybrid**: Users need free/offline options (Web Speech) but want quality (Cloud). The architecture abstracts these providers behind a common `ITTSProvider` interface.
    *   **Singleton**: Audio playback is a global resource that must persist across component unmounts (e.g., navigating from Reader to Library).
    *   **Synchronization**: A dedicated `SyncEngine` is needed to map audio timestamps to text characters for highlighting, which varies by provider.

### Search Implementation
*   **Decision**: Offload full-text search to a **Web Worker** using `FlexSearch`.
*   **Rationale**: Indexing a book is CPU-intensive. Running this on the main thread would freeze the UI. Web Workers allow background processing, and `FlexSearch` is chosen for its speed and memory efficiency.

---

## 3. Technical Specifications

### Technology Stack
*   **Frontend Framework**: React 18, TypeScript, Vite.
*   **UI Library**: Tailwind CSS (styling), Radix UI (primitives - inferred from usage).
*   **State Management**: Zustand.
*   **Database**: IndexedDB (via `idb`).
*   **EPUB Parsing**: `epub.js`.
*   **Search**: `FlexSearch` (in Web Worker).
*   **Mobile Runtime**: Capacitor (Android).
*   **Testing**: Vitest (Unit), Playwright (End-to-End/Visual).

### Data Models (Schema)

The `EpubLibraryDB` (IndexedDB) consists of several object stores:

*   **`books`**: Stores metadata (`BookMetadata`).
    *   Key: `id` (UUID).
    *   Fields: `title`, `author`, `coverUrl`, `addedAt`, `lastRead`, `progress`, `currentCfi`, `isOffloaded`, `fileHash`, `totalChars`, `syntheticToc`.
*   **`files`**: Stores binary EPUB data.
    *   Key: `id` (Book ID).
    *   Value: `Blob` | `ArrayBuffer`.
*   **`annotations`**: User highlights and notes.
    *   Key: `id` (UUID).
    *   Fields: `bookId`, `cfiRange`, `text`, `color`, `type`, `note`, `created`.
*   **`locations`**: Caches `epub.js` location strings for fast pagination.
    *   Key: `bookId`.
*   **`tts_cache`**: Caches synthesized audio segments to reduce cloud costs.
    *   Key: `key` (SHA-256 hash of text+voice+speed).
    *   Value: `audio` (ArrayBuffer), `alignment`, `lastAccessed`.
*   **`tts_queue`**: Persists the current playback queue for seamless resumption.
    *   Key: `bookId`.
*   **`lexicon`**: Custom pronunciation rules.
    *   Fields: `original` (regex/text), `replacement`, `bookId`.
*   **`reading_history`**: Tracks read ranges for analytics.
    *   Fields: `bookId`, `readRanges` (Array of CFIs).
*   **`sections`**: Metadata about book chapters (character counts).
*   **`content_analysis`**: Stores AI-generated summaries/analysis.

---

## 4. Integration Points and Interfaces

### TTS Provider Interface (`ITTSProvider`)
All TTS engines (Local, Google, OpenAI) must implement:
*   `init()`: Initialize resources.
*   `getVoices()`: Return standardized `TTSVoice` objects.
*   `play(text, options)`: Synthesize and play text.
*   `pause()`, `resume()`, `stop()`: Playback controls.
*   `setSpeed(rate)`: Adjust playback rate.

### Web Worker Protocol (Search)
Communication via `postMessage`.
*   **Requests**: `INDEX_BOOK`, `INIT_INDEX`, `ADD_TO_INDEX`, `SEARCH`.
*   **Responses**: `ACK`, `SEARCH_RESULTS`, `ERROR`.

### Capacitor Native Bridge
*   **`ForegroundService`**: Keeps the Android app alive during background playback.
*   **`MediaSession`**: Updates lock-screen controls and metadata.
*   **`BatteryOptimization`**: Checks/Requests exemption from aggressive battery killing.

---

## 5. Detailed Module Reference

### 5.1 Data Layer: `src/db/DBService.ts`

The `DBService` class acts as the singleton gateway to IndexedDB.

*   **`getLibrary()`**
    *   **Purpose**: Retrieves all book metadata records, filtering out corrupted ones.
    *   **Returns**: `Promise<BookMetadata[]>` - Sorted array of valid book metadata.
*   **`getBook(id)`**
    *   **Purpose**: Fetches both metadata and the binary file for a book (for reading).
    *   **Params**: `id` (string) - Book ID.
    *   **Returns**: `Promise<{ metadata: BookMetadata | undefined; file: Blob | ArrayBuffer | undefined }>`
*   **`addBook(file)`**
    *   **Purpose**: Orchestrates the import process (parsing, hashing, saving). Delegates to `ingestion.ts`.
    *   **Params**: `file` (File) - The uploaded EPUB file.
    *   **Returns**: `Promise<void>`
*   **`deleteBook(id)`**
    *   **Purpose**: Cascading delete of a book and all related data (files, annotations, queue, etc.).
    *   **Params**: `id` (string) - Book ID.
    *   **Returns**: `Promise<void>`
*   **`offloadBook(id)`**
    *   **Purpose**: Deletes the large binary file to save space but retains metadata/userdata. Ensures a hash exists for future verification.
    *   **Params**: `id` (string) - Book ID.
    *   **Returns**: `Promise<void>`
*   **`restoreBook(id, file)`**
    *   **Purpose**: Re-attaches a binary file to an offloaded book, verifying the SHA-256 hash matches the original.
    *   **Params**: `id` (string), `file` (File).
    *   **Returns**: `Promise<void>`
*   **`saveProgress(bookId, cfi, progress)`**
    *   **Purpose**: Updates reading position (Debounced 1s).
    *   **Params**: `bookId` (string), `cfi` (string), `progress` (number 0-1).
    *   **Returns**: `void`
*   **`saveTTSState(bookId, queue, currentIndex)`**
    *   **Purpose**: Persists the current playback queue and position (Debounced 1s).
    *   **Params**: `bookId` (string), `queue` (TTSQueueItem[]), `currentIndex` (number).
    *   **Returns**: `void`
*   **`getCachedSegment(key)`**
    *   **Purpose**: Retrieves a cached audio segment and updates its `lastAccessed` time.
    *   **Params**: `key` (string) - Cache key.
    *   **Returns**: `Promise<CachedSegment | undefined>`
*   **`cacheSegment(key, audio, alignment?)`**
    *   **Purpose**: Stores a new audio segment in the cache.
    *   **Params**: `key` (string), `audio` (ArrayBuffer), `alignment` (optional).
    *   **Returns**: `Promise<void>`

### 5.2 Core Logic: `src/lib/ingestion.ts`

Handles the complexity of parsing raw EPUB files.

*   **`processEpub(file)`**
    *   **Purpose**: The main import pipeline.
        1.  Parses EPUB using `epub.js`.
        2.  Extracts metadata (Title, Author, Cover).
        3.  Generates a "Synthetic TOC" by parsing chapter HTML directly (more reliable than manifest TOC).
        4.  Calculates character counts for duration estimation.
        5.  Computes SHA-256 hash of the file.
        6.  Sanitizes metadata if too large.
        7.  Saves everything to `DBService`.
    *   **Params**: `file` (File).
    *   **Returns**: `Promise<string>` - The new Book ID.

### 5.3 TTS Subsystem: `src/lib/tts/`

#### `AudioPlayerService` (`src/lib/tts/AudioPlayerService.ts`)
The central controller for all audio operations.

*   **`setBookId(bookId)`**
    *   **Purpose**: Sets context and restores the persisted queue for the given book.
    *   **Params**: `bookId` (string | null).
*   **`play()`**
    *   **Purpose**: Starts or resumes playback. Handles background service engagement (Android), locks for concurrency, and delegates to the active provider.
    *   **Returns**: `Promise<void>`
*   **`pause()`**
    *   **Purpose**: Pauses playback and saves state.
    *   **Returns**: `Promise<void>`
*   **`next()` / `prev()`**
    *   **Purpose**: Skips to the next or previous item in the queue.
    *   **Returns**: `Promise<void>`
*   **`seek(offset)`**
    *   **Purpose**: Seeks by jumping items in the queue (since accurate time seeking in synthesized audio is complex).
    *   **Params**: `offset` (number) - Positive/Negative direction.
*   **`setProvider(provider)`**
    *   **Purpose**: Hot-swaps the TTS provider (e.g., switching from Local to OpenAI).
    *   **Params**: `provider` (ITTSProvider).
    *   **Returns**: `Promise<void>`
*   **`generatePreroll(chapterTitle, wordCount, speed)`**
    *   **Purpose**: Generates a spoken introduction string (e.g., "Chapter 1. Estimated time: 5 minutes.").
    *   **Params**: `chapterTitle` (string), `wordCount` (number), `speed` (number).
    *   **Returns**: `string`

#### `SyncEngine` (`src/lib/tts/SyncEngine.ts`)
*   **`updateTime(currentTime)`**
    *   **Purpose**: Called by the provider on `timeupdate`. Calculates which character index corresponds to the current audio time based on alignment data.
    *   **Params**: `currentTime` (number) - Seconds.

### 5.4 Search Subsystem

#### `SearchClient` (`src/lib/search.ts`)
The main-thread interface to the worker.

*   **`indexBook(book, bookId, onProgress)`**
    *   **Purpose**: Iterates through the book's spine, loads each section, extracts text, and sends it to the worker in batches.
    *   **Params**: `book` (epub.js Book), `bookId` (string), `onProgress` (callback).
    *   **Returns**: `Promise<void>`
*   **`search(query, bookId)`**
    *   **Purpose**: Sends a search query to the worker.
    *   **Params**: `query` (string), `bookId` (string).
    *   **Returns**: `Promise<SearchResult[]>`

#### `SearchEngine` (`src/lib/search-engine.ts`)
Internal logic (running in Worker or test env).

*   **`initIndex(bookId)`**
    *   **Purpose**: Creates a new `FlexSearch` document index.
*   **`addDocuments(bookId, sections)`**
    *   **Purpose**: Adds a batch of text sections to the index.
*   **`search(bookId, query)`**
    *   **Purpose**: Executes the search and generates text excerpts with context.
    *   **Returns**: `SearchResult[]`.

### 5.5 State Stores (`src/store/`)

#### `useReaderStore`
*   **Purpose**: Manages UI state for the reader view.
*   **State**: `currentTheme`, `fontSize`, `viewMode` (paginated/scrolled), `currentCfi`, `progress`.
*   **Key Actions**: `updateLocation`, `setTheme`, `setFontSize`.
*   **Persistence**: Persisted to `localStorage`.

#### `useTTSStore`
*   **Purpose**: Manages TTS configuration and connects UI to `AudioPlayerService`.
*   **State**: `isPlaying`, `voice`, `rate`, `providerId`, `apiKeys`.
*   **Key Actions**:
    *   `play()`, `pause()`: Delegates to Player.
    *   `setProviderId()`: Switches provider and re-initializes voices.
    *   `loadVoices()`: Fetches available voices from current provider.

### 5.6 Hooks (`src/hooks/`)

#### `useEpubReader` (`src/hooks/useEpubReader.ts`)
*   **Purpose**: Encapsulates the complex lifecycle of an `epub.js` instance.
*   **Functionality**:
    *   Loads book data from IDB.
    *   Renders to a DOM element.
    *   Handles resizing via `ResizeObserver`.
    *   Injects CSS for themes and custom fonts.
    *   Manages event listeners (relocated, selection).
*   **Returns**: `{ book, rendition, isReady, toc, metadata, ... }`

#### `useTTS` (`src/hooks/useTTS.ts`)
*   **Purpose**: Extracts text content for TTS.
*   **Functionality**:
    *   Listens to `rendition.on('relocated')`.
    *   Extracts text from the current chapter/page.
    *   Populates the `AudioPlayerService` queue.
    *   Handles "Empty Chapter" edge cases.
*   **Returns**: `{ sentences }`

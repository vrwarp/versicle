# Versicle Architecture

## Overview

Versicle is a local-first web-based EPUB reader and manager. It utilizes modern web technologies to parse, store, and render EPUB files directly in the browser without requiring a backend server for content processing.

The application is built with **React** and **Vite**, uses **Zustand** for state management, and **IndexedDB** for persistent local storage of books and metadata. **epub.js** is the core engine for rendering EPUB content, and **FlexSearch** powers the full-text search functionality.

## System Architecture

```mermaid
graph TD
    subgraph "Frontend Layer (React)"
        Router[React Router]
        Layout[App Layout]
        Library[Library View]
        Reader[Reader View]
        Settings[Reader Settings]
        TTSControls[TTS Panel]
        AnnotationUI[Annotation List & Popover]
    end

    subgraph "State Management (Zustand)"
        LibStore[useLibraryStore]
        ReaderStore[useReaderStore]
        TTSStore[useTTSStore]
        AnnotationStore[useAnnotationStore]
        CostStore[useCostStore]
    end

    subgraph "Service Layer"
        Ingest[Ingestion Service]
        AudioService[Audio Player Service]
        SearchClient[Search Client]
    end

    subgraph "Core Engines"
        EpubJS[epub.js Rendering Engine]
        TTSProviders[TTS Providers]
    end

    subgraph "TTS Providers"
        WebSpeech[WebSpeechProvider (Local)]
        GoogleTTS[GoogleTTSProvider (Cloud)]
        OpenAITTS[OpenAIProvider (Cloud)]
    end

    subgraph "Background Workers"
        SearchWorker[Search Worker]
    end

    subgraph "Data Layer (IndexedDB)"
        DB[EpubLibraryDB]
        BooksStore[Books Object Store]
        FilesStore[Files Object Store]
        AnnotationsStore[Annotations Store]
        TTSCache[TTS Cache Store]
    end

    %% Routing
    Router --> Layout
    Layout --> Library
    Layout --> Reader

    %% View Dependencies
    Library --> LibStore
    Reader --> ReaderStore
    Reader --> TTSStore
    Reader --> AnnotationStore
    Reader --> TTSControls
    Reader --> Settings
    Reader --> AnnotationUI

    %% Store Actions
    LibStore --> Ingest
    LibStore --> DB
    ReaderStore --> DB
    ReaderStore --> EpubJS
    AnnotationStore --> DB
    AnnotationStore --> EpubJS
    TTSStore --> AudioService
    CostStore --> AudioService

    %% Ingestion Flow
    Ingest --> EpubJS
    Ingest --> DB

    %% Reader Engine Flow
    Reader --> EpubJS
    EpubJS -- "Update Progress/Location" --> ReaderStore
    Reader --> SearchClient
    SearchClient --> SearchWorker
    SearchWorker --> FlexSearch[FlexSearch Engine]

    %% TTS Flow
    AudioService --> TTSProviders
    AudioService --> TTSCache
    TTSProviders --> WebSpeech
    TTSProviders --> GoogleTTS
    TTSProviders --> OpenAITTS
    AudioService -- "Time Updates" --> TTSStore
    TTSStore -- "Highlight Text" --> EpubJS

    %% Data Flow
    DB --> BooksStore
    DB --> FilesStore
    DB --> AnnotationsStore
    DB --> TTSCache
```

## Detailed Component Descriptions

### 1. Frontend Layer
- **Library View (`src/components/library`)**: The main landing page. Displays a virtualized grid of books with skeleton loading states. Handles file uploading and deletions.
- **Reader View (`src/components/reader`)**: The core reading interface. It initializes the `epub.js` `Rendition` object, handles page navigation, and manages sidebars for TOC, Annotations, and Search.
- **TTS Panel**: A dedicated UI for controlling playback, changing voices/providers, and viewing the playback queue.
- **Annotation UI**: Components for creating highlights (`AnnotationPopover`) and listing them (`AnnotationList`).

### 2. State Management
- **`useLibraryStore`**: Manages the list of available books and ingestion status.
- **`useReaderStore`**: Manages reading session state (book ID, CFI location, theme, font settings).
- **`useTTSStore`**: Manages TTS playback state, voice selection, provider configuration, and highlighting synchronization.
- **`useAnnotationStore`**: Manages creation, retrieval, and deletion of user annotations.
- **`useCostStore`**: Tracks character usage for paid TTS providers to estimate costs.

### 3. Service Layer
- **Ingestion Service (`src/lib/ingestion.ts`)**: Parses new EPUB files, extracts metadata and covers, and persists them to IndexedDB.
- **Audio Player Service (`src/lib/tts/AudioPlayerService.ts`)**: A singleton service that orchestrates TTS playback. It handles:
    - Text segmentation (using `Intl.Segmenter`).
    - Queue management.
    - Provider selection (Local vs Cloud).
    - Caching of synthesized audio.
    - Synchronization of audio time with text highighting.
- **Search Client (`src/lib/search.ts`)**: Communicates with the background Search Worker.

### 4. Background Workers
- **Search Worker (`src/workers/search.worker.ts`)**: Runs `FlexSearch` in a separate thread to index book content without blocking the main UI thread.

### 5. Data Layer (IndexedDB)
- **`EpubLibraryDB`**:
  - **`books`**: Metadata (id, title, author, progress, currentCfi).
  - **`files`**: Raw EPUB `ArrayBuffer`.
  - **`annotations`**: User highlights (cfiRange, color, note).
  - **`tts_cache`**: Cached audio segments from cloud providers to reduce API costs.

## Key Workflows

### Book Ingestion
1. User uploads a file.
2. `ingestion.ts` reads the file.
3. `epub.js` parses metadata and cover.
4. Data is stored in `books` and `files` stores.
5. Library UI updates via `useLibraryStore`.

### Reading & Persistence
1. `ReaderView` loads book data from IndexedDB.
2. `epub.js` renders the content.
3. Reading progress (`currentCfi`) is auto-saved to IndexedDB on navigation.
4. Settings (theme, font) are persisted in `localStorage` via Zustand persistence.

### Text-to-Speech (TTS)
1. `ReaderView` extracts text from the current chapter using `rendition.getContents()`.
2. Text is passed to `AudioPlayerService` which splits it into sentences.
3. `AudioPlayerService` requests audio from the selected provider (WebSpeech, Google, or OpenAI).
4. For cloud providers, audio is cached in IndexedDB.
5. As audio plays, `AudioPlayerService` emits events to `useTTSStore` to update the active sentence highlight in `ReaderView`.

### Annotations
1. User selects text in the reader.
2. `epub.js` emits a `selected` event.
3. `AnnotationPopover` appears.
4. User selects a color and optionally adds a note.
5. Annotation is saved to IndexedDB via `useAnnotationStore`.
6. `ReaderView` applies the highlight visual using `rendition.annotations.add`.

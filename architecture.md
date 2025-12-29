# Versicle Architecture

## Overview

Versicle is a web-based e-book reader designed for PWA (Progressive Web App) and Native (via Capacitor) deployment. It focuses on a clean reading experience, robust text-to-speech (TTS) capabilities, and offline functionality.

## Core Stack

*   **Framework**: React (Vite)
*   **Language**: TypeScript
*   **State Management**: Zustand
*   **Routing**: React Router
*   **Styling**: Tailwind CSS
*   **Database**: IndexedDB (via `idb` library)
*   **Native Bridge**: Capacitor

## Key Modules

### 1. Reader Core (`src/components/reader`)

*   **Engine**: `epub.js`
    *   Renders EPUB content in an iframe.
    *   Manages pagination and location (CFI).
*   **Viewer**: `ReaderView.tsx`
    *   Wraps the `epub.js` rendition.
    *   Handles user interactions (tap, swipe, selection).
*   **State**: `useReaderStore`
    *   Tracks current book, location, settings (font, theme).

### 2. Text-to-Speech (TTS) (`src/lib/tts`)

*   **Service**: `AudioPlayerService` (Singleton)
    *   Manages the playback lifecycle (play, pause, stop, next/prev).
    *   Orchestrates text segmentation and audio synthesis.
*   **Providers**: `BaseCloudProvider` (Abstract)
    *   **Implementations**: `GoogleTTSProvider`, `OpenAIProvider`, `PiperProvider` (Local/WASM).
*   **Media Session**: `MediaSessionManager`
    *   **Wraps**: `navigator.mediaSession` (Standard Web API) for all platforms.
    *   Integrates with OS lock screen controls and notifications.
*   **Segmentation**: `TextSegmenter`
    *   Splits text into sentences for granular TTS control.

### 3. Library & Data (`src/db`)

*   **Service**: `DBService` (Singleton)
    *   Centralized access to IndexedDB.
    *   **Stores**:
        *   `books`: Metadata and configuration.
        *   `content`: Extracted text/structure for TTS.
        *   `reading_list`: User's reading list.
        *   `annotations`: User highlights and notes.
*   **Ingestion**: `ingestion.ts`
    *   Parses EPUB files.
    *   Extracts metadata, cover, and structure.
    *   Saves to DB.

### 4. Search (`src/lib/search.ts`, `src/workers/search.worker.ts`)

*   **Client**: `SearchClient`
    *   Interface for the UI.
*   **Backend**: Web Worker
    *   Performs full-text search off the main thread to ensure UI responsiveness.

## Native Integration (Capacitor)

*   **Filesystem**: Used for exporting/importing data (optional).
*   **TTS**: Can use native Android/iOS TTS engines via plugin.
*   **Background Audio**: Managed via `MediaSession` and platform-specific background mode plugins.

## Data Flow

1.  **User opens book**: `ReaderView` loads book from `DBService` -> initializes `epub.js`.
2.  **User starts TTS**:
    *   `AudioPlayerService` fetches text for current chapter from `DBService`.
    *   `TextSegmenter` splits text.
    *   `AudioPlayerService` requests audio from selected `TTSProvider`.
    *   Audio is played; `MediaSessionManager` updates lock screen.
    *   `ReaderView` highlights current sentence.

## Testing Strategy

*   **Unit**: Vitest
*   **E2E**: Playwright (planned)

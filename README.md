# Versicle

> **Note:** **Versicle** is an experimental project implemented almost entirely with **Google Jules**, an advanced AI software engineer agent.

**Versicle** is a local-first, privacy-focused EPUB reader and audiobook player. It runs entirely in your browser (or as a mobile app) and gives you complete ownership of your library.

## Why Versicle?

*   **Local-First**: Your books live on your device. No cloud servers, no tracking, no accounts.
*   **Privacy-Centric**: We don't know what you read. No analytics.
*   **Hybrid Intelligence**:
    *   **Offline TTS**: Use local Neural voices (Piper) for free, unlimited offline listening.
    *   **Cloud TTS**: Connect your own API keys (OpenAI, Google) for studio-quality narration.
    *   **AI Enhanced**: Use Google Gemini to generate smart Tables of Content and filter content.
*   **Data Ownership**: Export your data at any time. Full backups (ZIP) or Metadata (JSON).

## Tech Stack

*   **Framework**: React 19 + Vite 7
*   **Language**: TypeScript
*   **State**: Zustand
*   **Storage**: IndexedDB (via `idb`)
*   **Parsing**: epub.js + PapaParse (CSV)
*   **Audio**: Piper (WASM) / Web Speech API
*   **AI**: Google Gemini 2.5 Flash Lite (via `@google/generative-ai`)
*   **Mobile**: Capacitor 7 (Android)
*   **Workers**: Comlink + Web Workers
*   **Styling**: Tailwind CSS v4 + Radix UI
*   **Compression**: browser-image-compression (Covers) + JSZip

## Features

### Reading (The "Reading Room")
*   **Satellite FAB**: A dedicated floating action button for quick access to playback controls and menu actions.
*   **Customizable**: Fonts, themes, line height, margins via a dedicated Visual Settings interface.
*   **Formats**: EPUB, ZIP (Batch Import), Folder Import (Batch).
*   **Drag & Drop**: Drag files anywhere to import.
*   **Worker Search**: Fast, offline full-text search (RegExp based) running in a background Web Worker to keep the UI buttery smooth.
*   **Annotations**: Highlights and notes.
*   **Table Snapshots**: Complex tables are captured as images for better readability and preservation.

### Listening (The "Listening Room")
*   **Unified Control Bar**: Seamless audio control with the "Compass Pill" UI.
*   **Smart Handoff**: Gapless playback for Native Android TTS using speculative preloading.
*   **Text-to-Speech**: Turn any book into an audiobook.
*   **Smart Segmentation**: Natural pausing at sentence boundaries using Just-In-Time analysis.
*   **AI Content Filtering**: Automatically skip citations, footnotes, and tables during playback using Gemini.
*   **Lexicon**: Fix mispronounced words with custom rules (Regex supported).
*   **Offline Cache**: Generated audio is cached locally to save bandwidth and costs.
*   **Transactional Download**: Piper voice models are downloaded, verified, and cached transactionally to prevent corruption.
*   **Background Play**: Keeps playing when the screen is off (Mobile via Foreground Service) with optional White Noise generation.

### Management (The "Engine Room")
*   **Reading History**: Detailed session tracking with timeline visualization.
*   **Reading List**: Track status (Read, Reading, Want to Read) and Rating. Export to CSV (Goodreads compatible).
*   **Backups**:
    *   **Light**: JSON export of metadata/settings.
    *   **Full**: ZIP archive including all book files.
*   **Smart Offloading**: Delete the heavy book file to save space but keep your reading stats, highlights, and metadata. Re-download or re-import later to restore instantly.
*   **Maintenance**: Built-in tools to scan for and prune orphaned data.

## Setup & Development

### Prerequisites
*   Node.js 20+
*   npm
*   Docker (optional, for verification suite)

### Installation

1.  Clone the repository.
2.  Install dependencies (automatically sets up Piper WASM assets):
    ```bash
    npm install
    ```
    *Note: If Piper assets are missing, run `npm run prepare-piper`.*

3.  (Optional) Read `AGENTS.md` for AI assistant guidelines.

### Running Locally

```bash
npm run dev
```

### Building

```bash
npm run build
```

### Testing

#### Unit Tests (Vitest)
```bash
# Run all tests
npm run test

# Run specific test file
npx vitest src/lib/ingestion.test.ts
```

#### Android Tests (Docker)
We use Docker to run Android unit tests in a consistent environment.

1.  **Build the Image**:
    ```bash
    docker build -t versicle-android -f Dockerfile.android .
    ```

2.  **Run Tests**:
    ```bash
    docker run --rm versicle-android
    ```

#### Verification Suite (Docker)
We use Docker to run end-to-end tests in a consistent environment using Playwright.

1.  **Build the Image**:
    ```bash
    docker build -t versicle-verification -f Dockerfile.verification .
    ```

2.  **Run All Tests**:
    ```bash
    docker run --rm versicle-verification
    ```

3.  **Run Specific Verification Script**:
    ```bash
    # Run a specific verification script (e.g., layout test)
    docker run --rm versicle-verification /app/verification/test_golden_layout.py
    ```

## Contributing

Please see `architecture.md` for a deep dive into the system design.

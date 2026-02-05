# Versicle

> **Note:** **Versicle** is an experimental project implemented almost entirely with **Google Jules**, an advanced AI software engineer agent.

**Versicle** is a local-first, privacy-focused EPUB reader and audiobook player. It runs entirely in your browser (or as a mobile app) and gives you complete ownership of your library.

## Why Versicle?

*   **Local-First**: Your books live on your device. No cloud servers, no tracking, no accounts.
*   **Privacy-Centric**: We don't know what you read. No analytics.
*   **Hybrid Intelligence**:
    *   **Offline TTS**: Use local Neural voices (Piper) for free, unlimited offline listening.
    *   **Cloud TTS**: Connect your own API keys (OpenAI, Google) for studio-quality narration.
    *   **AI Enhanced**: Use Google Gemini to generate smart Tables of Content, filter content, and adapt tables for listening.
*   **Dual Sync**:
    *   **Real-time**: Synchronize progress instantly across devices using Firestore.
    *   **Native Backup**: Seamless integration with Android's built-in backup system.
*   **Data Ownership**: Export your data at any time. Full backups (ZIP) or Metadata (JSON).

## Tech Stack

*   **Framework**: React 19.2.3 + Vite 7.3.0 + React Router 7.11.0
*   **Language**: TypeScript
*   **State**: Zustand + Yjs (CRDT) + `zustand-middleware-yjs` (Custom Fork)
*   **Sync**: `y-cinder` (Custom Fork / Firestore) + Android Backup Service
*   **Storage**: IndexedDB (via `idb`)
*   **Parsing**: epub.js + PapaParse (CSV)
*   **Audio**: Piper (WASM) / Web Speech API
*   **AI**: Google Gemini (Flash Lite / Flash) via `@google/generative-ai`
*   **Mobile**: Capacitor 7.0.0 (Android) + `@capawesome-team/capacitor-android-battery-optimization`
*   **Workers**: Comlink + Web Workers
*   **Styling**: Tailwind CSS v4.1.18 + Radix UI
*   **Tools**: `@zumer/snapdom` (Snapshots), `browser-image-compression`, `JSZip`, `react-lazy-load-image-component`, `react-window`, `dompurify`

## Features

### Reading (The "Reading Room")
*   **Adaptive Contrast**: The UI automatically adapts to your book covers, extracting dominant colors to create beautiful, accessible gradients and text themes.
*   **Satellite FAB**: A dedicated floating action button for quick access to playback controls and menu actions.
*   **Customizable**: Fonts, themes, line height, margins via a dedicated Visual Settings interface.
*   **Formats**: EPUB, ZIP (Batch Import), Folder Import (Batch).
*   **Drag & Drop**: Drag files anywhere to import.
*   **Smart Offloading**: Delete the heavy book file to save space but keep your reading stats, highlights, and metadata.
*   **Ghost Books**: Library items with missing files (offloaded) are preserved as "Ghost Books" and can be instantly restored by re-importing the file (verified via 3-point fingerprint).
*   **High-Performance Rendering**: Uses a two-stage memoization strategy to ensure the library view remains silky smooth (60fps) even with thousands of books.
*   **Worker Search**: Fast, offline full-text search (RegExp based) running in a background Web Worker to keep the UI buttery smooth.
*   **Annotations**: Highlights and notes.
*   **Table Snapshots**: Complex tables are captured as structural images for better readability and preservation.

### Listening (The "Listening Room")
*   **Unified Control Bar**: Seamless audio control with the "Compass Pill" UI.
*   **Optimistic Playback**: Audio starts playing instantly while content filtering (skip masks) and smart adaptations are applied asynchronously in the background.
*   **Table Teleprompter**: Uses Multimodal GenAI to "see" data tables and convert them into natural narrative speech.
    *   **Thinking Budget**: Configurable "Thinking Budget" (default 512 tokens) allows the AI to reason about complex data layouts before speaking.
    *   **Synced Analysis**: AI-generated content (adaptations, semantic maps) is synchronized across devices via Yjs, so you only pay the generation cost once.
*   **Smart Handoff**: Gapless playback for Native Android TTS using speculative preloading.
*   **Text-to-Speech**: Turn any book into an audiobook.
*   **Smart Segmentation**: Natural pausing at sentence boundaries using Just-In-Time analysis.
*   **AI Content Filtering**: Automatically skip citations, footnotes, and tables during playback using Gemini.
*   **Smart Rotation**: Automatically switches between Gemini models (Flash Lite/Flash) to handle rate limits (429) and maximize free quotas.
*   **Lexicon**: Fix mispronounced words with custom rules (Regex supported).
*   **Bible Lexicon**: Specialized pronunciation rules for Bible verses (e.g., "Gen 1:1").
*   **Offline Cache**: Generated audio is cached locally to save bandwidth and costs.
*   **Transactional Download**: Piper voice models are downloaded, verified, and cached transactionally to prevent corruption.
*   **Background Play**: Keeps playing when the screen is off (Mobile via Foreground Service) with optional White Noise generation.
*   **Battery Guard**: Explicitly checks and warns about aggressive Android battery optimizations that might kill background playback.

### Management (The "Engine Room")
*   **Sync & Cloud**:
    *   **Dual Sync**:
        *   **Real-time Sync**: Optional "Cloud Overlay" using **Firestore** for live updates.
        *   **Android Backup**: Native integration with Android's Backup Manager (Cold Path).
    *   **Store-First Architecture**: Uses Yjs CRDTs for robust, conflict-free synchronization.
        *   **Device Mesh**: Real-time visibility of active devices with "Last Active" status.
    *   **Per-Device Progress**: Tracks reading position separately for each device (Phone, Tablet) so you never lose your place, while intelligently aggregating the "furthest read" point.
    *   **Checkpoints**: Automatic "Moral Layer" snapshots (`SyncManifest`) protect against data loss during sync (Last 10 states).
*   **Reading History**: Detailed session tracking with timeline visualization.
*   **Reading List**: Persistent "Shadow Inventory" tracking status (Read, Reading, Want to Read) and Rating for books, even if the file is deleted.
    *   **CSV Import/Export**: Import/Export your reading list via CSV, with intelligent filename matching (ISBN/Title fallback) to restore your library context.
*   **Backups & Export**:
    *   **Light**: JSON export of metadata/settings.
    *   **Full**: ZIP archive including all book files.
    *   **Unified Export**: Share files natively (AirDrop, Nearby Share) or download via browser.
*   **Smart Offloading**: Delete the heavy book file to save space but keep your reading stats, highlights, and metadata. Re-download or re-import later to restore instantly.
*   **Maintenance**: Built-in tools to scan for and prune orphaned data.
*   **Checkpoint Forensics**: Inspect the exact data difference between your live state and any backup checkpoint.
*   **Safe Mode**: A fallback UI that activates on critical database failures, allowing users to export debug info or perform a factory reset to recover usability.

## Setup & Development

### Prerequisites
*   Node.js 22+
*   npm
*   Docker (optional, for verification suite)

### Installation

1.  Clone the repository.
2.  Install dependencies (automatically sets up Piper WASM assets):
    ```bash
    npm install
    ```
    *Note: The `postinstall` script runs `npm run prepare-piper` to copy necessary WASM assets to `public/piper`.*

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

#### Linting
```bash
npm run lint
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
    docker run --rm versicle-verification /app/verification/test_journey_reading.py
    ```

## Contributing

Please see `architecture.md` for a deep dive into the system design.

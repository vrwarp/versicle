# Versicle

**Versicle** is a local-first, privacy-focused EPUB reader and audiobook player. It runs entirely in your browser (or as a mobile app) and gives you complete ownership of your library.

## Why Versicle?

*   **Local-First**: Your books live on your device. No cloud servers, no tracking, no accounts.
*   **Privacy-Centric**: We don't know what you read. No analytics.
*   **Hybrid Intelligence**:
    *   **Offline TTS**: Use local Neural voices (Piper) for free, unlimited offline listening.
    *   **Cloud TTS**: Connect your own API keys (OpenAI, Google) for studio-quality narration.
    *   **AI Enhanced**: Use Google Gemini to generate smart Tables of Content and summaries.
*   **Data Ownership**: Export your data at any time. Full backups (ZIP) or Metadata (JSON).

## Tech Stack

*   **Framework**: React 18 + Vite
*   **Language**: TypeScript
*   **State**: Zustand
*   **Storage**: IndexedDB (via `idb`)
*   **Parsing**: epub.js
*   **Audio**: Piper (WASM) / Web Speech API
*   **Mobile**: Capacitor (Android)
*   **Styling**: Tailwind CSS + Radix UI

## Features

### Reading
*   **Customizable**: Fonts, themes, line height, margins.
*   **Formats**: EPUB, ZIP (Batch Import).
*   **Search**: Fast, offline full-text search (RegExp based).
*   **Annotations**: Highlights and notes.

### Listening (TTS)
*   **Text-to-Speech**: Turn any book into an audiobook.
*   **Smart Segmentation**: Natural pausing at sentence boundaries.
*   **Lexicon**: Fix mispronounced words with custom rules (Regex supported).
*   **Offline Cache**: Generated audio is cached locally to save bandwidth and costs.
*   **Background Play**: Keeps playing when the screen is off (Mobile).

### Management
*   **Reading History**: Detailed session tracking.
*   **Reading List**: Track status (Read, Reading, Want to Read) and Rating. Export to CSV (Goodreads compatible).
*   **Backups**:
    *   **Light**: JSON export of metadata/settings.
    *   **Full**: ZIP archive including all book files.
*   **Space Saver**: "Offload" books to delete the file but keep your stats, then restore later.

## Setup & Development

### Prerequisites
*   Node.js 18+
*   npm
*   Docker (optional, for verification suite)

### Installation

1.  Clone the repository.
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Prepare WASM assets (Piper):
    ```bash
    npm run prepare-piper
    ```

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

#### Verification Suite (Docker)
We use Docker to run end-to-end tests in a consistent environment.

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
    docker run --rm versicle-verification /app/verification/test_golden_layout.py
    ```

## Contributing

Please see `architecture.md` for a deep dive into the system design.

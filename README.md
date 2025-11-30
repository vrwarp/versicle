# Versicle

Versicle is a sophisticated, local-first web-based EPUB reader. It runs entirely in your browser using modern web technologies, ensuring your library stays private and accessible without a backend server.

It features a high-performance reading engine, full-text search, annotation support, and an advanced Text-to-Speech (TTS) system with support for both local and cloud-based voices (Google, OpenAI).

## Features

*   **Local-First Library**: Books are stored in IndexedDB. No server upload required.
*   **Advanced Reader**:
    *   **Customizable**: Light/Dark/Sepia themes, custom fonts, line height, and font size.
    *   **Modes**: Paginated and Scrolled view modes.
    *   **Immersive Mode**: Distraction-free reading.
    *   **Touch Controls**: Swipe gestures for navigation.
*   **Text-to-Speech (TTS)**:
    *   **Sentence Highlighting**: Visual karaoke-style sync.
    *   **Multiple Providers**: Web Speech API (Free), Google Cloud TTS, OpenAI TTS.
    *   **Smart Resume**: Intelligently rewinds context after pauses.
    *   **Pronunciation Lexicon**: Custom replacement rules (Regex support).
*   **Full-Text Search**: Fast search within books using Web Workers.
*   **Annotations**: Highlight text (multiple colors) and add notes.
*   **PWA Support**: Installable as a standalone app.

## Tech Stack

*   **Frontend**: React, Vite, TypeScript
*   **Styling**: Tailwind CSS
*   **State Management**: Zustand
*   **Storage**: IndexedDB (via `idb`)
*   **Rendering**: `epub.js`
*   **Search**: `FlexSearch` (in Web Worker)
*   **Testing**: Vitest, Playwright

## Prerequisites

*   Node.js 18+
*   npm

## Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/your-username/versicle.git
    cd versicle
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

## Usage

### Development

Start the local development server:

```bash
npm run dev
```

Visit `http://localhost:5173`.

### Production Build

Build the application for production:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

### Testing

Run unit tests (Vitest):

```bash
npm test
```

Run visual verification tests (Playwright):

```bash
# Requires python and playwright browsers
pip install pytest pytest-playwright
playwright install
python verification/run_all.py
```

## Project Structure

*   `src/components/`: UI components (Reader, Library).
*   `src/lib/`: Core logic (Ingestion, TTS, Search).
*   `src/store/`: Application state (Zustand).
*   `src/db/`: Database layer.
*   `src/workers/`: Background workers.
*   `verification/`: Playwright visual tests.

## Architecture

For a detailed technical overview, please refer to [architecture.md](architecture.md).

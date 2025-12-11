# Versicle

> **Note:** This repository was almost entirely built using Google Jules and is an exploration of that tool.

**Versicle** is a sophisticated, local-first web-based EPUB reader designed for advanced reading capabilities. It runs entirely in the browser, utilizing IndexedDB for persistent storage, React for the UI, and `epub.js` for rendering. The system is designed for privacy and performance, featuring advanced Text-to-Speech (TTS) capabilities, full-text search, and annotation management without relying on external servers for core functionality.

## Features

*   **Local-First Library**: Books are stored persistently in IndexedDB. No server upload required.
*   **Advanced Reader**:
    *   **Customizable**: Light/Dark/Sepia themes, custom fonts, line height, and font size.
    *   **Modes**: Paginated and Scrolled view modes.
    *   **Immersive Mode**: Distraction-free reading.
    *   **Touch Controls**: Swipe gestures for navigation and audio control.
*   **Text-to-Speech (TTS)**:
    *   **Sentence Highlighting**: Visual karaoke-style synchronization.
    *   **Multiple Providers**: Web Speech API (Free), Google Cloud TTS, OpenAI TTS.
    *   **Smart Resume**: Intelligently rewinds context (2 sentences or 10-60s) after pauses to reorient the listener.
    *   **Pronunciation Lexicon**: Custom replacement rules with Regex support.
    *   **Caching**: Cloud-generated audio is cached locally to save costs and bandwidth.
*   **Full-Text Search**: Fast, off-main-thread search using Web Workers.
*   **Annotations**: Highlight text (multiple colors) and add notes.
*   **Data Management**: Backup and restore your entire library (or just metadata) to JSON/ZIP.
*   **PWA Support**: Installable as a standalone app on desktop and mobile.

## Tech Stack

*   **Frontend**: React, Vite, TypeScript
*   **Styling**: Tailwind CSS
*   **State Management**: Zustand (with persistence)
*   **Storage**: IndexedDB (via `idb`)
*   **Rendering**: `epub.js`
*   **Search**: `FlexSearch` (in Web Worker)
*   **Testing**: Vitest (Unit), Playwright (Visual/Integration)

## Prerequisites

*   **Node.js**: v18 or higher
*   **npm**: v9 or higher
*   **Python**: v3.10+ (Required for running Playwright verification scripts)

## Getting Started

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/vrwarp/versicle.git
    cd versicle
    ```

2.  **Install Node dependencies:**
    ```bash
    npm install
    ```

3.  **Start the development server:**
    ```bash
    npm run dev
    ```
    The application will be available at `http://localhost:5173`.

## Mobile App (Android)

Versicle can be built as a native Android application using Capacitor.

**Prerequisites:**
*   **Android Studio**: Required for building and running the Android app.
*   **Java/JDK**: Compatible version (JDK 17 recommended).

**Setup & Run:**

1.  **Sync Web Assets:**
    Build the web app and copy assets to the Android project:
    ```bash
    npm run build
    npx cap sync
    ```

2.  **Open in Android Studio:**
    ```bash
    npx cap open android
    ```
    From Android Studio, you can run the app on an emulator or physical device.

3.  **Run directly (CLI):**
    To run on a connected device or emulator via command line:
    ```bash
    npx cap run android
    ```

## Usage Guide

### Library Management
*   **Import**: Click "Import Book" or drag-and-drop `.epub` files onto the library view.
*   **View Modes**: Toggle between Grid and List views using the icon in the header.
*   **Management**: Click the "..." menu on a book card to Delete, Offload (remove file but keep data), or Restore a book.

### Reading
*   **Navigation**: Use arrow keys, on-screen buttons, or swipe gestures (if enabled) to turn pages.
*   **Visual Settings**: Click the 'Aa' icon to change font, size, theme (Light/Dark/Sepia), and line height.
*   **Annotations**: Select text to open the highlight menu. Click the highlight icon to view all annotations in the sidebar.

### Text-to-Speech (TTS)
*   **Playback**: Click the Headphones icon to open the Audio Panel. Press Play to start reading from the top of the current page.
*   **Providers**:
    *   **Local**: Uses your browser's built-in voices (Free).
    *   **Cloud**: Configure Google Cloud or OpenAI API keys in Global Settings for high-quality neural voices.
*   **Lexicon**: Fix mispronounced words by adding rules in Global Settings -> Dictionary, or via the "Fix Pronunciation" button in the selection menu.

### Configuration
Access Global Settings via the gear icon in the Library header.
*   **API Keys**: Enter keys for Google Cloud or OpenAI.
*   **Data Management**: Create backups (Light/Full) or prune orphaned data.

## Scripts

*   `npm run dev`: Starts the Vite development server.
*   `npm run build`: Type-checks and builds the application for production.
*   `npm run preview`: Previews the production build locally.
*   `npm test`: Runs unit tests via Vitest.
*   `npm run lint`: Runs ESLint.

## Verification & Testing

This project uses a rigorous testing strategy combining unit tests and visual verification tests.

### Unit Tests
Run standard unit tests (logic, components, stores):
```bash
npm test
```

### Visual Verification (Playwright)
We use Python-based Playwright scripts to verify user journeys and prevent visual regressions.

**Setup:**
1.  Install Python dependencies:
    ```bash
    pip install pytest pytest-playwright
    ```
2.  Install Playwright browsers:
    ```bash
    playwright install chromium
    ```

**Running Tests:**
To run all verification tests:
```bash
python verification/run_all.py
```
Or run a specific test:
```bash
pytest verification/test_journey_reading.py
```

*Note: Verification tests generate screenshots in `verification/screenshots/`. Validated "golden" screenshots are stored in `verification/goldens/`.*

## Architecture & Documentation

The codebase is fully documented with JSDoc (TypeScript) and Google Style Docstrings (Python).
For a detailed deep-dive into the codebase, including comprehensive module references and diagrams, please refer to [architecture.md](architecture.md).

### Directory Structure

*   `src/components`: React UI components (Reader, Library, UI kit).
*   `src/lib`: Core business logic (TTS, Search, Ingestion).
*   `src/store`: Global state management (Zustand).
*   `src/db`: IndexedDB schema and connection logic.
*   `verification`: Playwright visual verification suite.
*   `plan`: Implementation plans and design docs.

## Contributing

1.  **AGENTS.md**: If you are an AI agent or a developer, please read `AGENTS.md` for specific instructions regarding testing and build hygiene.
2.  **Build Hygiene**: Ensure `npm run build` and `npm run lint` pass before submitting changes.
3.  **Visual Verification**: Always run the Playwright verification suite to ensure no regressions.

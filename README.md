# Versicle

> **Note:** This repository was almost entirely built using Google Jules and is an exploration of that tool.

**Versicle** is a sophisticated, local-first web-based EPUB reader designed for advanced reading capabilities. It runs entirely in the browser, leveraging modern web standards (IndexedDB, Web Workers) to manage your library without external servers.

It features a high-performance reading engine, full-text search, annotation support, and an advanced Text-to-Speech (TTS) system with support for both local (Web Speech API) and cloud-based (Google, OpenAI) voices.

## Features

*   **Local-First Library**: Books are stored persistently in IndexedDB. No server upload required.
*   **Advanced Reader**:
    *   **Customizable**: Light/Dark/Sepia themes, custom fonts, line height, and font size.
    *   **Modes**: Paginated and Scrolled view modes.
    *   **Immersive Mode**: Distraction-free reading.
    *   **Touch Controls**: Swipe gestures for navigation.
*   **Text-to-Speech (TTS)**:
    *   **Sentence Highlighting**: Visual karaoke-style synchronization.
    *   **Multiple Providers**: Web Speech API (Free), Google Cloud TTS, OpenAI TTS.
    *   **Smart Resume**: Intelligently rewinds context (2 sentences or 10-60s) after pauses to reorient the listener.
    *   **Pronunciation Lexicon**: Custom replacement rules with Regex support.
    *   **Caching**: Cloud-generated audio is cached locally to save costs and bandwidth.
*   **Full-Text Search**: Fast, off-main-thread search using Web Workers.
*   **Annotations**: Highlight text (multiple colors) and add notes.
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

## Architecture

For a detailed deep-dive into the codebase, including comprehensive module references and diagrams, please refer to [architecture.md](architecture.md).

## Contributing

1.  **AGENTS.md**: If you are an AI agent or a developer, please read `AGENTS.md` for specific instructions regarding testing and build hygiene.
2.  **Build Hygiene**: Ensure `npm run build` and `npm run lint` pass before submitting changes.
3.  **Visual Verification**: Always run the Playwright verification suite to ensure no regressions.

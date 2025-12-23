# Versicle

**Versicle** is a sophisticated, local-first web-based EPUB reader designed for advanced reading capabilities, privacy, and performance. It runs entirely in the browser, utilizing IndexedDB for persistent storage, React for the UI, and `epub.js` for rendering.

It is designed to be a "Forever Reader"—an app that you can rely on for decades, with no server dependencies that can shut down, and full control over your data.

## Features

*   **Local-First Library**: Books, annotations, and reading progress are stored persistently in IndexedDB. No server upload required.
*   **Advanced Reader**:
    *   **Customizable**: Light/Dark/Sepia themes, custom fonts, line height, and font size.
    *   **Modes**: Paginated (Book-like) and Scrolled (Web-like) view modes.
    *   **Force Font**: Option to override publisher styling for consistent readability.
*   **Generative AI**:
    *   **Smart TOC**: Automatically generate clean chapter titles for books with missing or poor tables of contents.
*   **Text-to-Speech (TTS) Powerhouse**:
    *   **Hybrid Engine**: Seamlessly switch between **Local** (Web Speech, Piper WASM, Native Mobile) and **Cloud** (Google, OpenAI, LemonFox) providers.
    *   **Visual Sync**: Karaoke-style sentence and word highlighting.
    *   **Pronunciation Lexicon**: Fix mispronounced words using Regex-based replacement rules.
    *   **Background Playback**: (Android) Continue listening when the screen is off using Media Session API and optional White Noise generation.
*   **Full-Text Search**: Fast, off-main-thread search using Web Workers and FlexSearch.
*   **Data Management**:
    *   **Batch Import**: Import multiple EPUBs at once or upload a ZIP archive containing your library.
    *   **Backup/Restore**: Create **Light** (JSON, metadata only) or **Full** (ZIP, includes EPUB files) backups to keep your data safe.
    *   **Interoperability**: Import/Export reading lists (CSV) compatible with Goodreads.
    *   **Offloading**: Remove large book files to save space on mobile devices while keeping your notes, reading progress, and metadata intact.
    *   **Maintenance**: Run health checks to identify missing files or corrupt data, prune orphaned records, and perform factory resets (Safe Mode) if needed.
*   **PWA & Mobile**: Installable as a standalone app on desktop and mobile. Native Android build via Capacitor.

## Tech Stack

*   **Frontend**: React, Vite, TypeScript
*   **Runtime**: Web (PWA), Android (Capacitor)
*   **UI/Styling**: Tailwind CSS, Radix UI, Shadcn UI
*   **State Management**: Zustand (with persistence)
*   **Storage**: IndexedDB (via `idb`)
*   **Data Portability**: PapaParse, JSZip
*   **Security**: DOMPurify
*   **Rendering**: `epub.js`
*   **Search**: `FlexSearch` (in Web Worker)
*   **TTS**: Piper (WASM), Web Speech API, Google/OpenAI/LemonFox Cloud APIs, Capacitor Native TTS
*   **AI**: Google Gemini (via `@google/generative-ai`)
*   **Testing**: Vitest (Unit), Playwright (Visual/Integration)

## Prerequisites

*   **Node.js**: v18 or higher
*   **npm**: v9 or higher
*   **Python**: v3.10+ (Required for running Playwright verification scripts locally)
*   **Docker**: (Optional but recommended) For running the verification suite in a consistent environment.

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
    *Note: This automatically runs `npm run prepare-piper` to copy necessary WASM files.*

3.  **Start the development server:**
    ```bash
    npm run dev
    ```
    The application will be available at `http://localhost:5173`.

## Architecture Overview

Versicle follows a strict **Local-First** architecture.
*   **Data Layer**: `src/db/DBService.ts` manages all interactions with IndexedDB.
*   **Core Services**: `src/lib/` contains business logic like `AudioPlayerService` (TTS), `SearchClient`, `Ingestion`, and `BackupService`.
*   **UI Layer**: React components in `src/components/` consume data via Zustand stores (`src/store/`) and Custom Hooks (`src/hooks/`).

For a deep dive into the code structure, module relationships, and API documentation, please refer to [architecture.md](architecture.md). It is **essential reading** for understanding the Core Services (TTS, Search, Database) and State Management.

## Development Workflow

### Scripts
*   `npm run dev`: Start local dev server.
*   `npm run build`: Build for production.
*   `npm run preview`: Preview the production build locally.
*   `npm run lint`: Run ESLint.
*   `npm test`: Run unit tests via Vitest.

### Testing Strategy
This project uses a rigorous testing strategy combining unit tests and visual verification tests.

#### 1. Unit Tests
Run standard unit tests (logic, components, stores) using Vitest:
```bash
npm test
```

#### 2. Visual Verification (Playwright)
We use Python-based Playwright scripts to verify user journeys and prevent visual regressions.

**Running with Docker (Recommended):**
The most reliable way to run tests is via the Docker container to ensure consistent rendering.

```bash
# Build the container
docker build -t versicle-verify -f Dockerfile.verification .

# Run tests
mkdir -p verification/screenshots
docker run --rm -v $(pwd)/verification/screenshots:/app/verification/screenshots versicle-verify
```

**Running Locally:**
1.  Install Python dependencies:
    ```bash
    pip install pytest pytest-playwright
    playwright install chromium
    ```
2.  Run tests:
    ```bash
    python verification/run_all.py
    ```

*Note: Verification tests generate screenshots in `verification/screenshots/`. Validated "golden" screenshots are stored in `verification/goldens/`.*

**Updating Goldens:**
If you make UI changes, run the tests, verify the new screenshots in `verification/screenshots/` are correct, and then copy them to `verification/goldens/`.

### Linting & Formatting
Ensure your code follows the project's style guidelines before submitting:

```bash
npm run lint
```

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

3.  **Run directly (CLI):**
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
    *   **Piper**: Downloads high-quality neural voices locally (Offline, Free).
    *   **Cloud**: Configure Google Cloud or OpenAI API keys in Global Settings for high-quality neural voices.
*   **Lexicon**: Fix mispronounced words by adding rules in Global Settings -> Dictionary, or via the "Fix Pronunciation" button in the selection menu.

### Configuration
Access Global Settings via the gear icon in the Library header.
*   **API Keys**: Enter keys for Google Cloud, OpenAI, or LemonFox.
*   **Data Management**: Create backups (Light/Full), prune orphaned data, or clear caches.

## Contributing

1.  **Read `AGENTS.md`**: Specific instructions for AI agents and developers regarding testing and build hygiene.
2.  **Build Hygiene**: Ensure `npm run build` and `npm run lint` pass before submitting changes.
3.  **Update Documentation**: If you modify the architecture or add new features, update `architecture.md` and this README.

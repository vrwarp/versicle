# Versicle

> **Note:** **Versicle** is an experimental project implemented almost entirely with **Google Jules**, an advanced AI software engineer agent.

**Versicle** is a local-first, privacy-focused EPUB reader and audiobook player. It runs entirely in your browser (or as a mobile app) and gives you complete ownership of your library.

## Why Versicle?

*   **Local-First**: Your books live on your device. No cloud servers, no tracking, no accounts.
*   **Privacy-Centric**: We don't know what you read. No analytics.
*   **Hybrid Intelligence**:
    *   **Offline TTS**: Use local Neural voices (Piper) for free, unlimited offline listening.
    *   **Cloud TTS**: Connect your own API keys (OpenAI, Google, LemonFox) for studio-quality narration.
    *   **AI Enhanced**: Use Google Gemini to generate smart Tables of Content, filter content (by identifying reference boundaries), and narrate adapted tables. Includes **Smart Rotation** to maximize free quotas and prevent rate limits.
*   **Dual Sync**:
    *   **Real-time**: Synchronize progress instantly across devices using Firestore.
    *   **Native Backup**: Seamless integration with Android's built-in backup system.
*   **Data Ownership**: Export your data at any time. Full backups (ZIP) or Metadata (JSON).

## Tech Stack

*   **Framework**: React 19.2.3 + Vite 7.3.0 + React Router 7.11.0
*   **Language**: TypeScript 5.9.3
*   **Testing**: Vitest 4.0.16
*   **Linting**: ESLint 9.39.2
*   **State**: Zustand + Yjs (CRDT) + `zustand-middleware-yjs` (github:vrwarp/zustand-middleware-yjs#master)
*   **Sync**: `y-cinder` (github:vrwarp/y-cinder#main / Firestore 11.10.0) + Android Backup Service + Google Drive API
*   **Storage**: IndexedDB (via `idb`) with Web Locks API (`navigator.locks`) for safe cross-context execution and deadlock prevention
*   **Parsing**: epub.js + PapaParse (CSV) + `opencc-js` + `pinyin-pro`
*   **Audio**: Piper (WASM) / Web Speech API / LemonFox.ai
*   **AI**: Google Gemini 2.5 (Flash Lite / Flash) via `@google/generative-ai`
*   **Mobile**: Capacitor 7.1.1 (Android) + `@capacitor/filesystem` + `@capawesome-team/capacitor-android-battery-optimization` + `@jofr/capacitor-media-session` + `@capgo/capacitor-social-login` + `@capacitor-community/text-to-speech`
*   **Workers**: Comlink + Web Workers
*   **Styling**: Tailwind CSS v4.1.18 + Radix UI
*   **Tools**: `browser-image-compression`, `JSZip`, `lucide-react`, `react-lazy-load-image-component`, `react-window`, `dompurify`, `@google/generative-ai`, `y-cinder`, `y-indexeddb`, `piper-wasm`, `uuid`
*   **Dev Tools**: `vite-plugin-mkcert` (Local HTTPS)

## Features

### Reading (The "Reading Room")
*   **Adaptive Contrast**: The UI automatically adapts to your book covers using **Weighted K-Means Clustering** to extract dominant colors, creating beautiful gradients and text themes.
*   **Satellite FAB**: A dedicated floating action button for quick access to playback controls and menu actions.
*   **Customizable**: Fonts, themes, line height, margins via a dedicated Visual Settings interface.
*   **Formats**: EPUB, ZIP (Batch Import via JSZip), Folder Import (Batch).
*   **Drag & Drop**: Drag files anywhere to import.
*   **Smart Offloading**: Delete the heavy book file to save space but keep your reading stats, highlights, and metadata.
*   **Ghost Books**: Library items with missing files (offloaded) are preserved as "Ghost Books" using synced metadata. Importing a file with matching metadata will automatically link it to the existing record instead of creating duplicates.
*   **Chinese Language Support**: Native support for Chinese readers, featuring on-the-fly conversion to Traditional Chinese and dynamic Pinyin pronunciation overlays that render cleanly without breaking text selection or text-to-speech. Features **Smart Pinyin Filtering** allowing users to mark characters as "known" to progressively hide Pinyin as they learn.
*   **High-Performance Rendering**: Uses a two-stage memoization strategy to ensure the library view remains silky smooth (60fps) even with thousands of books.
*   **Zero-Latency Parsing**: Uses a specialized zero-allocation text scanner (`TextScanningTrie`) to process text instantly without garbage collection pauses.
*   **Instant Resume**: Remembers the last open book and restores your place immediately on launch, bypassing heavy sync checks.
*   **Worker Search**: Fast, offline full-text search (RegExp based) running in a background Web Worker. Features smart offloading of XML parsing and direct EPUB archive extraction (with rendering fallback) to keep the UI buttery smooth during indexing.
*   **Worker TTS**: Background TTS processing (e.g. WASM inference) decoupled from the main thread UI to maximize performance and avoid UI freezes. The monolithic `AudioPlayerService` has been replaced by an isolated `PlaybackController` using dependency injection for worker portability.
*   **Annotations**: Full support for text highlighting and adding notes. Includes **Markdown Annotation Export** to easily extract all notes for a book to a `.md` file or copy directly to the clipboard.

### Listening (The "Listening Room")
*   **Unified Control Bar**: Seamless audio control with the "Compass Pill" UI.
*   **Optimistic Playback**: Audio starts playing instantly while content filtering (skip masks) and smart adaptations are applied asynchronously in the background.
*   **Smart Handoff**: Gapless playback for Native Android TTS using speculative preloading.
*   **Chapter Pre-roll**: Optional announcements (Title, Author) at the start of each new chapter.
*   **Text-to-Speech**: Turn any book into an audiobook.
*   **Reactive Segmentation**: Natural pausing at sentence boundaries using Just-In-Time analysis. Updates instantly when Lexicon settings change (e.g., toggling Bible mode).
*   **AI Content Filtering**: Automatically skip citations, footnotes, and tables during playback using Gemini. Optimizes API usage by finding the boundary where references begin rather than analyzing individual elements.
*   **Smart Rotation**: Automatically switches between Gemini models (Flash Lite/Flash) to handle rate limits (429) and maximize free quotas.
*   **Lexicon**: Fix mispronounced words with custom rules (Regex supported). Includes "Trace Mode" for debugging rule application.
*   **Bible Lexicon**: Specialized pronunciation rules for Bible verses (e.g., "Gen 1:1"), enabled by default in settings.
*   **Offline Cache**: Generated audio is cached locally to save bandwidth and costs.
*   **Transactional Download**: Piper voice models are downloaded, verified, and cached transactionally to prevent corruption.
*   **Hardware Acceleration**: Uses WebGPU via ONNX Runtime Web for fast, local Piper voice generation, falling back to WebAssembly (WASM) when unavailable.
*   **Background Play**: Keeps playing when the screen is off (Mobile via Foreground Service) with optional White Noise generation.
    *   **Background Audio Mode**: Configurable options (Silence, White Noise, Off) to ensure the OS keeps the app alive during playback.
*   **Battery Guard**: Explicitly checks and warns about aggressive Android battery optimizations that might kill background playback using `BatteryOptimization`.
*   **Lock Screen Controls**: Full support for OS-level media controls (Play, Pause, Seek, Artwork) via Media Session API.

### Management (The "Engine Room")
*   **Sync & Cloud**:
    *   **Dual Sync**:
        *   **Real-time Sync**: Optional "Cloud Overlay" using **Firestore** for live updates.
        *   **Android Backup**: Native integration with Android's Backup Manager (Cold Path).
        *   **Cloud Library**: Connect your Google Drive to scan and import EPUBs directly from the cloud. Uses a smart **Heuristic Sync** (`viewedByMeTime` vs `lastScanTime`) to skip unnecessary expensive API scans, and optimizes memory by mapping heavy API objects to a lightweight file indexing strategy to speed up "New Book" diffing. Forces a full scan if the Cloud Index is empty. Automatically syncs recursive folders.
    *   **Workspace Context Switching**: Safely handles migrating states between remote workspaces, securely bridging page reloads and offering recovery from dangling backups.
    *   **Store-First Architecture**: Uses Yjs CRDTs for robust, conflict-free synchronization.
        *   **Sync Mesh**: Real-time visibility of active devices in the network with "Last Active" status and peer awareness.
    *   **Per-Device Progress**: Tracks reading position separately for each device (Phone, Tablet) so you never lose your place, while intelligently aggregating the most recent position across the mesh.
    *   **Checkpoints**: Automatic "Moral Layer" snapshots (`SyncManifest`) protect against data loss during sync (Last 10 states).
*   **Smart TOC Generation**: Uses GenAI to analyze book structure and generate meaningful Table of Contents for books with missing or poor metadata.
*   **Reading History**: Detailed session tracking with timeline visualization. Includes **Smart Session Merging** to intelligently group related reading events.
*   **Reading List**: Persistent "Shadow Inventory" tracking status (Read, Reading, Want to Read) and Rating for books, even if the file is deleted.
    *   **CSV Import/Export**: Import/Export your reading list via CSV, with intelligent filename matching (ISBN/Title fallback) to restore your library context.
    *   **Entity Resolution**: A deterministic normalization pipeline that seamlessly matches your reading list entries to library books even when filenames disagree (stripping extensions, brackets, and structural punctuation from titles/authors).
*   **Lexicon Management**:
    *   **CSV Import/Export**: Bulk manage pronunciation rules using CSV files.
*   **Backups & Export**:
    *   **Light Backup**: Fast JSON export of your `user_` metadata, settings, and Yjs snapshot (without heavy book files).
    *   **Full Backup**: ZIP archive including all book files (optimizing space by ignoring offloaded books), powered by a **V2 Binary Snapshot** (`Y.encodeStateAsUpdate(yDoc)`) that perfectly preserves the Yjs state without merge conflicts. Restores destructively by clearing `yjsPersistence.clearData()`.
    *   **Unified Export**: Share files natively (AirDrop, Nearby Share) or download via browser.
*   **Smart Offloading**: Delete the heavy book file to save space but keep your reading stats, highlights, and metadata. Re-download or re-import later to restore instantly.
*   **Maintenance**: Built-in tools to scan for and prune orphaned data.
*   **Checkpoint Forensics**: Inspect the exact data difference between your live state and any backup checkpoint.
*   **Flight Data Recorders**: Captures "Black Box" snapshots of application state (Zustand) during unexpected errors or manually via the Diagnostics UI for post-mortem debugging.
*   **Safe Mode**: A fallback UI that activates on critical database initialization failures, allowing users to export debug info or perform a factory reset to recover usability.
*   **Schema Quarantine (`ObsoleteLockView`)**: A safety mechanism that locks the app and severs cloud connections if a remote database with a newer schema version (currently V9 for CRDT schema, and V28 for local IndexedDB) is detected, preventing outdated clients from corrupting upgraded data structures.

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

#### Self-hosting and the Content-Security-Policy

The CSP is **strict** (no `https:` wildcard since Phase 8) and **generated**
from the egress destination registry (`src/kernel/net/destinations.ts`). The
committed `nginx.conf` carries the generated policy; the vite preview headers
and the build-time `index.html` meta tag render it from the same source, and
`src/kernel/net/csp.test.ts` fails CI if any copy drifts.

If you self-host with your **own Firebase project**: the policy enumerates
the standard `*.googleapis.com` / `*.firebaseio.com` endpoints, and Firebase
auth is proxied same-origin via `/__/auth/` (see `nginx.conf`). A custom
`authDomain` contacted *directly* (not through that proxy) is not in the
generated policy — keep the proxy, or extend the registry and regenerate the
committed copy:

```bash
npm run generate:csp   # rewrites nginx.conf from the registry
```

Remote images inside EPUBs are stripped at sanitize time (privacy: no
tracking pixels) and additionally blocked by the strict `img-src` — book
covers and embedded EPUB resources are unaffected (they are local
blob/data URLs).

### Testing

**`TESTING.md` is the canonical testing document** — all commands below and
more (typechecking, boundary/coverage ratchets, the emulator-gated suites,
a11y scans) are specified and kept current there.

```bash
npm test                                   # unit/integration tests (vitest)
npx vitest run src/lib/ingestion.test.ts   # a single test file
npm run lint                               # eslint
npx tsc -b                                 # typecheck (app + tests + e2e)
npm run docs:generate                      # drift gate test for generated documentation
```

#### Android Tests (Docker)
```bash
docker build -t versicle-android -f Dockerfile.android .
docker run --rm versicle-android
```

#### Verification Suite (Playwright E2E, Docker)
The end-to-end suite is Playwright specs in `verification/*.spec.ts`, run
hermetically in Docker:

```bash
./run_verification.sh                                      # desktop + mobile projects
./run_verification.sh verification/test_journey_reading.spec.ts
./run_verification.sh --help                               # full usage
```

## Contributing

Please see `architecture.md` for a deep dive into the system design.

## Licenses & Attributions

### CC-CEDICT Chinese-English Dictionary
Versicle integrates a compiled and optimized key-value version of the **[CC-CEDICT](https://cc-cedict.org/)** Chinese-to-English dictionary database compiled and hosted by **[MDBG](https://www.mdbg.net/chinese/dictionary?page=cc-cedict)**. 

The CC-CEDICT database is licensed under the **[Creative Commons Attribution-ShareAlike 4.0 International License (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/)**. In accordance with the ShareAlike terms, our custom-compiled offline JSON database (`public/dict/cedict.json`) and polyphone-merged adaptations are distributed under the same license terms.

### Versicle Sans Narrow (Modified for Pinyin Support)
Versicle bundles **Versicle Sans Narrow** (Regular & Bold, `public/fonts/VersicleSansNarrow-*.ttf`), a Modified Version of the **[PT Sans Narrow](https://fonts.google.com/specimen/PT+Sans+Narrow)** font family originally created by **[ParaType](https://www.paratype.com/)** (Alexandra Korolkova, Olga Umpeleva, and Vladimir Yefimov) under the **[SIL Open Font License 1.1](https://openfontlicense.org/)**.

**Modifications**:
- Lacking native support for Hanyu Pinyin characters with tone marks, we programmatically injected the missing 3rd-tone (caron/hacek) composite glyphs (**`ǎ`**, **`ǐ`**, **`ǒ`**, **`ǔ`**, **`ǚ`**) into the local TrueType font binaries using Python `fonttools` to perfectly align and center the caron accent (`caron`) over their respective base vowel glyphs (`a`, `dotlessi`, `o`, `u`, `udieresis`).
- Per OFL-1.1's Reserved Font Name condition, the Modified Version is renamed **Versicle Sans Narrow** (name table + filenames; `scripts/build-pinyin-font.py`). The ParaType copyright and full OFL license text remain embedded in the font's name table; full provenance lives in `third-party/inventory.json`.


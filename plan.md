# Plan

- [x] Step 1: **Setup the project structure.**
  - Initialize the project with React, Vite, and TypeScript.
  - Set up `eslint`, `prettier`, and `vitest`.
  - Create the folder structure for `src`, `src/components`, `src/lib`, `src/store`.

- [x] Step 2: **Implement Basic File Ingestion.**
  - Create the `LibraryView` component.
  - Implement the drag-and-drop zone using `react-dropzone` or native API.
  - Parse the EPUB file using `epub.js` to extract metadata (title, author, cover).
  - Store the file and metadata in IndexedDB.
  - Display the list of imported books.

- [x] Step 3: **Implement the Reader View.**
  - Create `ReaderView` component.
  - Setup `epub.js` rendering area.
  - Load the book content from IndexedDB.
  - Implement basic navigation (next/prev page).
  - Implement TOC (Table of Contents) sidebar.
  - Add basic settings (theme, font size).
  - Save reading progress (current CFI) to IndexedDB.

- [x] Step 4: **Implement Text-to-Speech (TTS).**
  - Create `useTTS` hook.
  - Implement sentence extraction from the current chapter.
  - Integrate `window.speechSynthesis`.
  - Implement sentence-level highlighting using `epub.js` annotations.
  - Add playback controls (Play/Pause, Rate, Voice Select).

- [ ] Step 5: **Implement Annotations.**
  - [ ] Design the data model for annotations (highlight range, color, note).
  - [ ] Create `AnnotationManager` or similar logic to handle storage in IndexedDB.
  - [ ] Implement UI for selecting text and creating a highlight.
  - [ ] Show existing highlights on the page.
  - [ ] Add a sidebar/panel to list all annotations for the current book.

- [ ] Step 6: **Advanced Theming.**
  - [ ] Expand settings menu to support font selection (serif, sans-serif, monospace).
  - [ ] Implement custom color themes (beyond light/dark/sepia).
  - [ ] Persist theme preferences.

- [ ] Step 7: **PWA Implementation.**
  - [ ] Configure `vite-plugin-pwa`.
  - [ ] Create manifest file.
  - [ ] Implement service worker for caching app shell.
  - [ ] Verify offline capability (loading cached books).

- [ ] Step 8: **Final Polish & Verification.**
  - [ ] Comprehensive UI review (animations, transitions, responsive design).
  - [ ] Error handling (invalid files, quota exceeded).
  - [ ] Accessibility audit (keyboard nav, screen reader labels).
  - [ ] Final round of end-to-end testing.

## **TTS Enhancement Plan (V2)**

- [ ] **Phase 1: Architecture Refactor** (`plan/tts_phase1.md`)
  - [ ] Refactor `src/lib/tts.ts` into a `WebSpeechProvider` class.
  - [ ] Create `AudioPlayerService` to decouple state from React.
  - [ ] Update `useTTSStore` to use the provider pattern.

- [ ] **Phase 2: Cloud Foundation** (`plan/tts_phase2.md`)
  - [ ] Create `AudioElementPlayer` for playing audio blobs.
  - [ ] Implement `MediaSession` API for background play controls.
  - [ ] Create `SyncEngine` for time-based alignment.

- [ ] **Phase 3: Cloud Integration** (`plan/tts_phase3.md`)
  - [ ] Implement `GoogleTTSProvider` (Text-to-Speech API).
  - [ ] Implement `OpenAIProvider`.
  - [ ] Create `TTSCache` using IndexedDB to store audio/alignments.

- [ ] **Phase 4: Advanced Sync & Polish** (`plan/tts_phase4.md`)
  - [ ] Use `Intl.Segmenter` for better text splitting.
  - [ ] Implement playback queue UI.
  - [ ] Add buffering/prefetching logic.

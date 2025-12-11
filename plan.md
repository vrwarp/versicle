
# **Technical Design Document: Versicle the Web-Based EPUB Manager & Reader**

## **1\. Introduction**

### **1.1 Purpose**

This document details the technical architecture and implementation strategy for a web-based application called Versicle which is designed to ingest, manage, and render EPUB files. The system is built around **epub.js** as the core rendering engine, leveraging its client-side parsing capabilities to deliver a "Local-First" reading experience.

### **1.2 Scope**

The application will function as a Progressive Web App (PWA) capable of:

* **Ingestion:** Parsing .epub files (ZIP archives) completely client-side.
* **Storage:** Persisting large binary files and metadata using IndexedDB.
* **Rendering:** Displaying content using epub.js with support for paginated and scrolled layouts.
* **Management:** Organizing a library with sorting, filtering, and cover grid visualization.
* **Accessibility:** Providing a synchronized Text-to-Speech (TTS) experience with visual sentence highlighting.

## **2\. System Architecture**

### **2.1 High-Level Stack**

* **Frontend Framework:** React 18+ (utilizing Functional Components and Hooks).
* **Rendering Engine:** epub.js (v0.3 branch).
* **TTS Engine:** Web Speech API (SpeechSynthesis).
* **State Management:** Zustand (for transient reader state, TTS controls, and global library state).
* **Persistence Layer:** IndexedDB (via idb wrapper).
* **Search Engine:** FlexSearch (running in a dedicated Web Worker).
* **Virtualization:** react-window (for performant library grid rendering).

### **2.2 Component Diagram**

The application is structured into four primary domains:

1. **Library Manager:** Handles file ingestion, metadata extraction (via epub.js parser), and database synchronization.
2. **Reader Interface:** A wrapper component around the epub.js Rendition object, managing iframe communication and UI overlays.
3. **TTS Synthesizer:** A specialized module for text extraction, sentence chunking, and audio playback synchronization.
4. **Background Services:** Service Workers for offline caching and Web Workers for search indexing.

## **3\. Core Engine Implementation: Epub.js**

### **3.1 Initialization Strategy**

To support offline usage and large file sizes (50MB+), we strictly avoid loading the entire file into browser memory as a Base64 string. Instead, we utilize ArrayBuffer or Blob objects retrieved from IndexedDB.

**Implementation Pattern:**

JavaScript

import ePub from 'epub.js';

// 1\. Retrieve Blob from IndexedDB
const bookData \= await db.files.get(bookId);

// 2\. Initialize Book with Blob (efficient memory usage)
const book \= ePub(bookData);

// 3\. Render to a specific DOM node
const rendition \= book.renderTo("viewer", {
  width: "100%",
  height: "100%",
  flow: "paginated", // or "scrolled-doc"
  manager: "default" // "continuous" for infinite scroll
});

// 4\. Display
await rendition.display(lastSavedCfi);

Ref: 1

### **3.2 Pagination and Locations**

epub.js does not know the total page count by default because HTML content flows dynamically based on screen width. We must explicitly generate locations to provide a progress bar.

* **Process:** Call book.locations.generate(1000) (splitting content every 1000 characters) in the background.
* **Storage:** The generated location JSON string should be cached in IndexedDB to avoid re-calculating on every book open.
* **Navigation:** Use rendition.display(cfi) for jumping to chapters and rendition.next() / rendition.prev() for turning pages.

### **3.3 Theming and Styling**

We utilize the rendition.themes API to inject user preferences without reloading the book. This ensures Style isolation within the iframe.

JavaScript

// Register themes once
rendition.themes.register("dark", {
  body: { background: "\#1a1a1a", color: "\#f5f5f5" },
  p: { "font-family": "Helvetica, sans-serif" }
});

// Apply dynamic updates
rendition.themes.select("dark");
rendition.themes.fontSize("120%");

## **4\. Data Persistence Layer**

### **4.1 Database Schema (IndexedDB)**

We use idb to wrap the native API with Promises. The database EpubLibraryDB (v1) contains three object stores:

| Store Name | Key Path | Value Description |
| :---- | :---- | :---- |
| **books** | id (UUID) | Metadata: Title, Author, Cover (Blob), addedAt. |
| **files** | bookId | Raw ArrayBuffer of the EPUB file. Separated from metadata to keep the UI snappy. |
| **annotations** | id (UUID) | CFI Range, color, notes, and bookId. |

Ref: 3

### **4.2 Handling Large Files**

Storing large Blobs in IndexedDB is supported by modern browsers (hundreds of MBs to GBs). However, we must ensure we rely on ArrayBuffer rather than FileReader.readAsDataURL to prevent main-thread blocking during I/O operations.

## **5\. Security & Isolation**

### **5.1 The Iframe Risk**

epub.js renders content inside an \<iframe\>. Because EPUBs utilize HTML and can technically contain malicious JavaScript.

* **Vulnerability:** XSS risks exist if the EPUB content is not sanitized.
* **Mitigation Strategy:**
  1. **Content Security Policy (CSP):** The hosting page must have a strict CSP.
  2. **Iframe Sandbox:** epub.js requires allow-scripts to perform layout calculations. We must **not** set allow-same-origin if possible, to prevent the book from accessing the parent's LocalStorage/Cookies.
  3. **Sanitization:** Before rendering, we should ideally intercept the HTML (hooks available in epub.js v0.3) and strip \<script\> tags and on\* event handlers using DOMPurify.

\*Ref: \*

## **6\. Text-to-Speech (TTS) Implementation**

### **6.1 Architecture: The "Walk and Highlight" Strategy**

Directly reading the entire chapter text via SpeechSynthesis fails to provide visual context. We must implement a synchronized system that highlights text as it is spoken. Since epub.js renders into an iframe, the TTS engine must "walk" the DOM inside that iframe.

### **6.2 The TTS Engine (Web Speech API)**

We utilize the browser's native window.speechSynthesis API. It is offline-capable and supports standard playback controls.

* **State Store (useTTSStore):** Tracks isPlaying, currentVoice, rate (speed), and activeCfi (for highlighting).

### **6.3 Sentence-Level Chunking**

Attempting to highlight every word in real-time often causes performance jitter and audio desynchronization. **Sentence-level highlighting** is the industry standard for stability.

**The Pipeline:**

1. **Extraction:** When a chapter loads, access the iframe document: rendition.getContents().document.
2. **Walking:** Use a TreeWalker to iterate over all Node.TEXT\_NODE elements.
3. **Segmentation:** Aggregate text nodes into a buffer. Use Intl.Segmenter (modern browsers) or regex splitting to detect sentence boundaries (., ?, \!).
4. **Range Creation:** For each sentence found, create a DOM Range object that encompasses the start and end nodes of that sentence.
5. **CFI Generation:** Convert the DOM Range into an EPUB CFI using epub.js:
   JavaScript
   const cfi \= rendition.currentLocation().start.cfi;
   const sentenceCfi \= new ePub.CFI(range, cfi).toString();

6. **Queueing:** Push an object { text: string, cfi: string } into the playback queue.

### **6.4 Synchronization & Highlighting**

The playback loop manages the sync between audio and visual:

1. **Play:** Create a SpeechSynthesisUtterance(sentence.text).
2. **Highlight:** On the start event of the utterance, call epub.js to highlight the specific CFI:
   JavaScript
   utterance.onstart \= () \=\> {
      rendition.annotations.add("highlight", sentence.cfi, {}, null, "tts-active-class");
   };

3. **Cleanup:** On the end event, remove the annotation:
   JavaScript
   utterance.onend \= () \=\> {
      rendition.annotations.remove(sentence.cfi, "highlight");
      playNextSentence();
   };

*Ref:*

## **7\. Detailed Feature Specifications**

### **7.1 Library Management (Virtualization)**

Rendering a grid of 500+ book covers will cause DOM thrashing. We implement **react-window** FixedSizeGrid.

* **Cell Data:** Only the metadata (title, cover blob URL) is passed to the cell renderer.
* **Cover Images:** Covers extracted during parsing are stored as Blobs. To display them, we generate URL.createObjectURL(coverBlob). **Critical:** These URLs must be revoked (URL.revokeObjectURL) when the component unmounts to prevent memory leaks.

### **7.2 Full-Text Search**

Client-side search is implemented using **FlexSearch**.

1. **Indexing:** A Web Worker extracts text from each spine item (book.spine.get(id).load().then(...)).
2. **Querying:** The UI sends a message to the Worker; the Worker queries the index and returns the CFI of the match.
3. **Highlighting:** rendition.annotations.add("highlight", cfiRange) is used to visually mark search results.

Ref: 5

### **7.3 Annotations (Highlighting)**

epub.js provides a robust annotation API based on **Canonical Fragment Identifiers (CFI)**.

* **Selection:** Listen for selected events on the rendition object.
* **Storage:** Capture the cfiRange from the selection event. Store this string in IndexedDB.
* **Hydration:** On book load, query IndexedDB for all CFIs associated with the bookId and call rendition.annotations.add() for each.

## **8\. Implementation Roadmap**

1. **Phase 1: Skeleton.** Setup React \+ Vite \+ Zustand. Implement IndexedDB wrapper.
2. **Phase 2: Ingestion.** Build the file uploader that parses .epub (using JSZip internal to epub.js) and extracts the cover/metadata.
3. **Phase 3: The Reader.** Implement the Viewer component. Handle basic pagination and Chapter navigation.
4. **Phase 4: TTS & Optimization.** Implement the TreeWalker logic for sentence extraction and connect the Web Speech API. Add Virtualization for the library.
5. **Phase 5: Annotations.** Implement the backend and frontend for user highlights and notes.
6. **Phase 6: Advanced Theming.** Add font selection and custom color themes.
7. **Phase 7: PWA.** Add manifest and service worker for offline capability and installability.
8. **Phase 8: Polish & Verification.** Final UI refinements, error handling, and comprehensive testing.

#### **Works cited**

1. futurepress/epub.js: Enhanced eBooks in the browser. \- GitHub, accessed November 25, 2025, [https://github.com/futurepress/epub.js/](https://github.com/futurepress/epub.js/)
2. epubjs 0.3.73 | Documentation, accessed November 25, 2025, [http://epubjs.org/documentation/0.3/](http://epubjs.org/documentation/0.3/)
3. IndexedDB \- The Modern JavaScript Tutorial, accessed November 25, 2025, [https://javascript.info/indexeddb](https://javascript.info/indexeddb)
4. How to store data with IndexedDB | Shailesh Codes | JavaScript in Plain English \- Medium, accessed November 25, 2025, [https://medium.com/javascript-in-plain-english/how-to-store-data-client-side-with-indexeddb-7d924bebe8f3](https://medium.com/javascript-in-plain-english/how-to-store-data-client-side-with-indexeddb-7d924bebe8f3)
5. Use epub.js to extract contents from .EPUB · Issue \#659 · futurepress/epub.js \- GitHub, accessed November 25, 2025, [https://github.com/futurepress/epub.js/issues/659](https://github.com/futurepress/epub.js/issues/659)
6. Use flexsearch instead of lunr · Issue \#2441 · TypeStrong/typedoc \- GitHub, accessed November 25, 2025, [https://github.com/TypeStrong/typedoc/issues/2441](https://github.com/TypeStrong/typedoc/issues/2441)

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

- [x] Step 6: **Advanced Theming.**
  - [x] Expand settings menu to support font selection (serif, sans-serif, monospace).
  - [x] Implement custom color themes (beyond light/dark/sepia).
  - [x] Persist theme preferences.

- [x] Step 7: **PWA Implementation.**
  - [x] Configure `vite-plugin-pwa`.
  - [x] Create manifest file.
  - [x] Implement service worker for caching app shell.
  - [x] Verify offline capability (loading cached books).

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

## **Capacitor Transition Plan**

- [x] **Phase 1: Capacitor Transition (Project Setup)**
  - [x] Install Capacitor Core & CLI.
  - [x] Initialize Capacitor Config.
  - [x] Add Android Platform.

- [x] **Phase 2: The Android Compliance Triad (Dependencies)**
  - [x] Install `capacitor-android-foreground-service`
  - [x] Install `capacitor-media-session`
  - [x] Install `text-to-speech`
  - [x] Install `capacitor-android-battery-optimization`
  - [x] Sync Native Project (`npx cap sync`)

- [x] **Phase 3: Android Manifest Configuration**
  - [x] Update `AndroidManifest.xml` with permissions.
  - [x] Add Foreground Service & Receiver to Manifest.
  - [x] Add Notification Icon (`ic_stat_versicle.png`).

- [ ] **Phase 4: Code Implementation (The Hybrid Bridge)**
  - [x] Implement `CapacitorTTSProvider`.
  - [x] Implement `MediaSessionManager`.
  - [x] Update `AudioPlayerService` for atomic start sequence.
  - [x] Update App Initialization.

- [ ] **Phase 5: Verification**
  - [ ] Build & Sync.
  - [ ] Run on Android Device/Emulator.
  - [ ] Verify Background Playback & Compliance.

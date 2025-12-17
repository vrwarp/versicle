# **Step 4: TTS, Search & Virtualization (Completed)**

## **4.1 Overview**
This phase implemented advanced features: Text-to-Speech (TTS) with synchronized highlighting, full-text search using a Web Worker, and library performance optimization.

## **4.2 Text-to-Speech (TTS)**

### **Implementation**
*   **`src/lib/tts.ts`**: Implemented `extractSentences` using a `TreeWalker` to traverse text nodes and split them into sentences. Each sentence is mapped to an EPUB CFI using `rendition.currentLocation().start.cfi` as a base (simplified for MVP).
*   **`useTTSStore`**: Added `activeCfi` state to track the currently spoken sentence.
*   **`src/hooks/useTTS.ts`**: Created a hook that manages the `SpeechSynthesisUtterance` queue. It iterates through extracted sentences, speaks them, and updates `activeCfi` on `onstart`.
*   **Highlighting**: In `ReaderView.tsx`, an effect listens to `activeCfi` changes and uses `rendition.annotations.add('highlight', cfi)` to apply a visual highlight class (`.tts-highlight`).

## **4.3 Full-Text Search (Web Worker)**

### **Implementation**
*   **`src/workers/search.worker.ts`**: Implemented a Web Worker using `flexsearch`. It handles `INDEX_BOOK` (adding content to index) and `SEARCH` (querying the index) messages.
*   **`src/lib/search.ts`**: Created a singleton `searchClient` that interfaces with the worker. It abstracts the `postMessage` communication.
*   **Indexing**: When a book is opened in `ReaderView`, the client iterates through the book's spine, loads each document, extracts text, and sends it to the worker for indexing.
*   **UI**: Added a Search Sidebar in `ReaderView`. Users can search, view results with excerpts, and click to navigate to the location.

## **4.4 Library Virtualization**

### **Implementation**
*   **`react-window`**: Replaced the CSS Grid in `LibraryView` with `FixedSizeGrid`.
*   **Responsiveness**: Used `useLayoutEffect` to calculate the container dimensions and dynamically determine the number of columns (`columnCount`) and `columnWidth`.
*   **Performance**: Only visible book cards are rendered, significantly improving performance for large libraries.

## **4.5 Verification**
*   **Tests**:
    *   `src/lib/tts.test.ts`: Verifies sentence extraction logic.
    *   `src/lib/search.test.ts`: Verifies search client-worker communication (mocked).
    *   `src/components/library/LibraryView.test.tsx`: Verifies virtualization rendering.
    *   `src/components/reader/tests/ReaderView.test.tsx`: Verified integration of new features.

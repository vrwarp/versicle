# **Step 4: TTS, Search & Virtualization**

## **4.1 Overview**
This phase focuses on advanced features: Text-to-Speech (TTS) with synchronized highlighting, full-text search using a Web Worker, and library performance optimization.

## **4.2 Text-to-Speech (TTS)**

### **Challenge**
`epub.js` renders in an iframe. Standard `SpeechSynthesis` reads text but doesn't provide easy visual mapping. We need to "walk" the DOM in the iframe, extract sentences, and map them to CFIs for highlighting.

### **Implementation Strategy**

1.  **Sentence Extraction (The "Walker")**
    *   Create a helper `extractSentences(rendition)`.
    *   Access `rendition.getContents()[0].document`.
    *   Use `TreeWalker` to find text nodes.
    *   Reconstruct sentences and calculate their CFI range.
    *   *Note:* This is complex. A simpler MVP approach is to extract text by paragraph (`<p>`) or block elements.

2.  **TTS Store (`useTTSStore`)**
    *   State: `isPlaying`, `rate`, `pitch`, `voice`, `currentSentenceCfi`.
    *   Actions: `play`, `pause`, `stop`, `setSettings`.

3.  **Synchronization**
    *   Use `window.speechSynthesis`.
    *   Create `SpeechSynthesisUtterance`.
    *   `utterance.onboundary` (word level) is often unreliable.
    *   *Better approach:* Speak one sentence/block at a time.
    *   **Loop:**
        1.  Get next sentence object `{ text, cfi }`.
        2.  Highlight `cfi` using `rendition.annotations.add('highlight', cfi)`.
        3.  Speak `text`.
        4.  `onend`: Remove highlight, move to next sentence.

## **4.3 Full-Text Search (Web Worker)**

### **Why Web Worker?**
Parsing the entire book text to search for a query is CPU intensive. Blocking the UI is unacceptable.

### **FlexSearch Implementation**
1.  **Worker (`search.worker.ts`):**
    *   Import `FlexSearch`.
    *   Listen for `message` events: `INDEX_BOOK`, `SEARCH`.
    *   **Indexing:**
        *   Receive book data (text content per spine item).
        *   Add to FlexSearch index: `index.add(spineIndex, text)`.
        *   Store serialized index in IndexedDB (optional, for persistent search index).

2.  **Client-Side Integration:**
    *   In `ReaderView`:
        *   `book.spine.each` -> load section -> `section.load().then(doc => doc.body.innerText)`.
        *   Send text to Worker.
    *   **Search UI:**
        *   Input box.
        *   Send query to Worker.
        *   Receive results (spine index + match context).
        *   On click: `rendition.display(spineItemHref)`. *Refinement:* FlexSearch gives document ID. We need to map Document ID (Spine Index) -> Href.

## **4.4 Library Virtualization**

### **Problem**
Rendering 100+ book covers with heavy DOM elements will lag.

### **Solution: `react-window`**
*   Replace standard CSS Grid in `LibraryView` with `FixedSizeGrid` (or `VariableSizeGrid` if responsive needs are complex).
*   **GridItem Component:**
    *   Receives `style` prop from `react-window`.
    *   Renders `BookCard`.
    *   *Crucial:* Ensure efficient image loading/unloading (revoke object URLs).

## **4.5 Verification**
*   **TTS:** Press play. Audio starts. Text is highlighted sentence-by-sentence.
*   **Search:** Type query. Results appear instantly. Clicking result jumps to correct chapter.
*   **Performance:** Library scrolls smoothly with dummy data (simulate 100 books).

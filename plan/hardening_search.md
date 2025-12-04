# Search Subsystem Hardening Design

## 1. Current Architecture & Weaknesses

### Current Implementation
- **Client:** `SearchClient.indexBook` iterates through *all* spine items of a book.
- **Extraction:** It calls `book.load(href)` for every chapter sequentially. This renders the chapter to a DOM (hidden) to extract text via `innerText`.
- **Transmission:** It accumulates all text into a massive JSON object and sends it to `search.worker.ts` via a single `postMessage`.
- **Worker:** The worker receives the full payload and indexes it synchronously using `FlexSearch`.

### Vulnerabilities
- **Main Thread Blocking:** `book.load()` is expensive. Doing it for 50 chapters in a loop freezes the UI or causes dropped frames, even though it's "async" (microtasks dominate).
- **Message Size Limits:** `postMessage` with a 10MB+ text payload can crash the worker or the main thread due to structured cloning overhead.
- **Worker Instability:** If the worker throws (OOM or parse error), the `SearchClient` promise hangs indefinitely.

## 2. Hardening Strategy

### 2.1. Batch Processing & Incremental Indexing (Implemented)
Instead of "all-at-once", data is streamed to the worker.

- **Action:** Refactored `indexBook` to use a chunked loop.
  - Process chapters in batches of 5.
  - After each batch, sends an `ADD_TO_INDEX` message to the worker.
  - Yields to the main thread via `setTimeout(..., 0)` between batches.
- **Worker Update:**
  - Handles `ADD_TO_INDEX` by calling `index.add()` (FlexSearch supports incremental addition).
  - Handles `INIT_INDEX` to start a fresh index.

### 2.2. Optimized Text Extraction
- **Action:** Avoid full `book.load()` (rendering) if possible.
  - Investigate `book.archive.getText(href)` (if using `epub.js` v0.3+ with zip access) which might return raw HTML.
  - Use a lightweight HTML-to-Text parser (DOMParser) on the string content instead of full rendering logic.
  - *Fallback:* If we must use `load()`, ensure we destroy/unload the view to free memory.

### 2.3. Robust Worker Communication (Implemented)
- **Action:** Implement a strict request/response protocol with IDs.
- **Action:** Add `worker.onerror` handler in `SearchClient` to reject pending promises.
- **Action:** Wrap worker message handling in `try-catch` and post `ERROR` messages back to client.

### 2.4. Memory Management
- **Action:** Explicitly `terminate()` the worker when the book is closed (in `ReaderView` cleanup).
- **Action:** Check if `FlexSearch` index is too large. If so, limit results or warn.

## 3. Implementation Plan

1.  **Modify `search.worker.ts`** (Done):
    - Added `ADD_TO_INDEX` and `INIT_INDEX` message types.
    - Added `ACK` and `INDEX_COMPLETE` response types.
    - Implemented global error handling with `try-catch`.
2.  **Refactor `SearchClient.ts`** (Done):
    - Changed `indexBook` to iterate and dispatch batches.
    - Added logic to handle progress updates via callback.
    - Implemented `sendMessage` with Promise-based response handling.
    - Added `worker.onerror` to handle crashes gracefully.
3.  **Update `ReaderView.tsx`**:
    - Listen for "Indexing..." status to show a spinner or non-intrusive indicator.

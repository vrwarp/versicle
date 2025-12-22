# General Hardening Plan

This document outlines a technical design for hardening the core subsystems of the application. The goal is to improve resilience, error handling, performance with large data, and type safety.

## 1. Ingestion & Persistence

### Current State
- `src/lib/ingestion.ts` loads the entire EPUB file into memory (`file.arrayBuffer()`) before processing.
- `src/db/DBService.ts` handles database interactions but `restoreBook` also reads full files into memory.
- Error handling during parsing is basic.

### Weaknesses
- **Memory Exhaustion**: Loading large EPUBs (e.g., >100MB) into memory can crash the browser tab, especially on mobile devices.
- **Parsing Failures**: Malformed EPUBs may cause unhandled exceptions during `epub.js` parsing.
- **Storage Limits**: `QuotaExceededError` is caught but recovery strategies are limited.

### Hardening Plan
1.  **Memory Optimization**:
    - Investigate if `epub.js` supports streaming or chunked loading for parsing metadata/cover without loading the full buffer.
    - If not possible with `epub.js` v0.3, strictly enforce file size limits or warn users.
    - For `restoreBook`, use `FileReader` with slicing if hash calculation allows, or stream the hash calculation to avoid holding the whole buffer.
2.  **Robust Error Handling**:
    - Wrap `epub()` parsing in a robust `try-catch` block that identifies specific parsing errors (e.g., missing container.xml, invalid manifest).
    - Return user-friendly error messages from `processEpub`.
3.  **Data Integrity**:
    - Implement a database integrity check on startup (already partially present in `getLibrary` with `validateBookMetadata`) to flag or clean up orphaned file records (files without books) or books without files.

## 2. Search Subsystem

### Current State
- `src/lib/search.ts` iterates through all spine items, loads them via `book.load()`, and extracts text.
- It sends the *entire* extracted text of the book to the worker in a single `postMessage`.
- `src/workers/search.worker.ts` indexes everything at once.

### Weaknesses
- **Performance Bottleneck**: `book.load()` parses HTML for every chapter, which is slow. Doing this sequentially for a whole book blocks the "indexing" process for a long time.
- **Message Size Limits**: Sending a huge JSON payload (all book text) to a worker can crash the browser or cause significant jank due to structured cloning overhead.
- **Worker Stability**: No error handling inside the worker; if indexing fails, the promise hangs.

### Hardening Plan
1.  **Batch Processing**:
    - Modify `indexBook` to process chapters in chunks (e.g., 5 chapters at a time).
    - Send text to the worker in batches rather than one huge payload.
    - Worker should append to the index incrementally.
2.  **Worker Error Handling**:
    - Wrap worker message handlers in `try-catch`.
    - Post `ERROR` messages back to the main thread so `SearchClient` can reject promises.
3.  **Optimization**:
    - Use `book.spine.get(href).document` if available to avoid re-parsing if the book is already rendered? (Likely not safe due to memory).
    - Consider only indexing "text content" and stripping tags more efficiently before sending to worker.

## 3. TTS & Audio Resilience

### Current State
- `AudioPlayerService` manages complex state (`playing`, `paused`, `loading`) with potential race conditions.
- Relies on `setTimeout` for listener updates.
- `WebSpeechProvider` voice loading is flaky.

### Weaknesses
- **Race Conditions**: Rapidly clicking Play/Pause or Next/Prev can leave the state machine in an inconsistent state (e.g., `loading` forever).
- **Voice Loading**: `getVoices` might return empty arrays on some browsers/OSs initially.
- **Error Recovery**: If a cloud provider fails, fallback to local is implemented but might be jarring.

### Hardening Plan
1.  **State Machine Robustness**:
    - Implement a more formal state machine transition logic (e.g., using XState concepts or strict transition guards) to prevent illegal moves (e.g., `loading` -> `playing` if stopped in between).
    - Use `AbortController` for all async operations (synthesis, fetching) to cancel pending requests on state change.
2.  **WebSpeech Stability**:
    - Improve `getVoices` polling mechanism. Use `onvoiceschanged` event more reliably.
    - Add specific error handling for `interrupted` events which are normal during navigation vs actual errors.
3.  **SyncEngine Optimization**:
    - Implement binary search for `updateTime` in `SyncEngine` instead of linear scan (small optimization, but good for long chapters).

## 4. Reader Engine Stability

### Current State
- `ReaderView.tsx` is a complex component handling rendering, events, UI overlays, and state syncing.
- Uses `setTimeout` for resizing and selection handling.
- Direct DOM manipulation for search highlighting.

### Weaknesses
- **`epub.js` Fragility**: The library is old and prone to layout shifts or rendering errors.
- **DOM Access**: Accessing `iframe` content via `contents.document` is subject to security restrictions (handled via sandbox attributes usually) and timing issues.
- **Event Handling**: `setTimeout` hacks make the UI feel sluggish or unpredictable.

### Hardening Plan
1.  **Hook Abstraction**:
    - Extract `epub.js` lifecycle (init, render, resize, destroy) into a custom hook `useEpubReader` to isolate the logic.
2.  **Highlighting Reliability**:
    - Revisit Search Highlighting. Instead of `window.find` (which is flaky), use `rendition.annotations.add` with a custom type for search results, or improved `TreeWalker`.
3.  **Resize Observer**:
    - Ensure `ResizeObserver` uses `requestAnimationFrame` to throttle resize events properly.

## 5. Global Error Handling

### Hardening Plan
1.  **Error Boundaries**:
    - Ensure `ReaderView` and `LibraryView` are wrapped in React Error Boundaries to catch render crashes (e.g., if `epub.js` throws inside a hook).
2.  **Centralized Logging**:
    - Create a simple logging service that can be extended later (currently using `console.error`).
3.  **Toast System**:
    - Ensure all user-facing errors (DB full, Network error, Parse error) trigger a Toast notification.

## Execution Strategy

The hardening will be executed in the order of the sections above.

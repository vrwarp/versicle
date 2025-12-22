# Reader Engine Stability Design

## 1. Current Architecture & Weaknesses

### Current Implementation
- **Component:** `ReaderView.tsx` handles everything: `epub.js` instantiation, resizing, theming, search highlighting, and event bridging.
- **Rendering:** `epub.js` renders to an iframe.
- **Search:** Uses `window.find` or `TreeWalker` inside the iframe.
- **Resize:** `ResizeObserver` with `setTimeout` debounce.

### Vulnerabilities
- **Component Bloat:** `ReaderView` is too large, making it hard to maintain or test.
- **DOM Access Security:** Accessing `iframe.contentDocument` is fragile and can be blocked by browser security policies (though same-origin blob/srcdoc usually works).
- **Reflow Jank:** `rendition.resize` is expensive.
- **Search Highlighting:** `window.find` is non-standard and flaky. Manual DOM manipulation conflicts with `epub.js` pagination.

## 2. Hardening Strategy

### 2.1. Custom Hook: `useEpubReader` (Completed)
Extract the lifecycle management into a hook to decouple logic from UI.

- **Action:** Create `src/hooks/useEpubReader.ts`.
  - **Inputs:** `file`, `viewerRef`, `options`.
  - **Outputs:** `book`, `rendition`, `isReady`, `error`.
  - **Internal:** Handles `ePub()` creation, `renderTo`, cleanup (`destroy`), and event binding (`relocated`, `selected`).
  - **Status:** Done. Implemented in `src/hooks/useEpubReader.ts` and integrated into `ReaderView.tsx`.

### 2.2. Robust Highlighting
- **Action:** Replace manual DOM manipulation with `rendition.annotations.add`.
  - `epub.js` annotations API is the "correct" way to persist highlights across pagination/reflows.
  - We need to ensure we can "find" the CFIs for search terms first. `book.find(term)` (if available and reliable) or our own search index (from `SearchSubsystem`) returning CFIs is better than `window.find`.
- **Integration:** The `SearchSubsystem` returns `href`. We need to map `href` + `text offset` to CFI. This is complex.
  - *Interim Hardening:* Stick to DOM manipulation but wrap it safely. If `window.find` fails, fallback to a robust text walker. Ensure we clean up DOM changes on page turn (epub.js might do this, but we should verify).

### 2.3. Resize Optimization (Completed)
- **Action:** Use `requestAnimationFrame` for resize events instead of `setTimeout`.
- **Action:** Only call `rendition.resize()` if dimensions changed significantly (>10px) to avoid thrashing on mobile scroll bar appearance/disappearance.
- **Status:** Done. Implemented inside `useEpubReader`.

### 2.4. Error Boundaries
- **Action:** Wrap the `ReaderView` logic in a local Error Boundary (within the component or parent) to catch `epub.js` crashes (e.g. "spine item not found") and show a "Reload Chapter" button instead of crashing the app.

## 3. Implementation Plan

1.  **Create `useEpubReader`**: (Done)
    - Move `bookRef`, `renditionRef` management there.
2.  **Refactor `ReaderView`**: (Done)
    - Use the hook.
    - Simplify the render loop.
3.  **Search Highlighting**:
    - Isolate the `scrollToText` / highlight logic into a separate utility function `DomHighlighter`.

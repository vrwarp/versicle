## 2024-05-22 - Search Indexing Offloading
- **Bottleneck:** Parsing XHTML chapters for search indexing on the Main Thread (`DOMParser`) caused frame drops during initial book load.
- **Solution:** Offloaded XML string parsing to `search.worker.ts`.
- **Learning:** `DOMParser` is available in Web Worker context in modern Capacitor/WebView environments. Sending raw XML strings via Comlink is efficient enough.

## 2024-05-23 - Library Import Rendering Optimization
- **Bottleneck:** `BookListItem` was re-rendering for every book in the library during file imports because `LibraryView` re-renders on every progress tick (0-100%).
- **Solution:** Wrapped `BookListItem` in `React.memo`.
- **Learning:** Even simple list items can become a bottleneck when the parent component has high-frequency state updates (like a progress bar). Always memoize list items in views with active progress indicators.

## 2025-05-25 - Redundant String Normalization
- **Bottleneck:** `TextSegmenter.refineSegments` was calling `normalize('NFKD')` on every sentence segment during playback queue generation, adding 30-40% overhead.
- **Solution:** Removed normalization from the hot path, relying on the guarantee that data is normalized during ingestion.
- **Learning:** When optimizing hot paths involving strings, check if the data source already guarantees the desired format. Avoid defensive programming (redundant sanitization) in performance-critical loops if strict contracts exist upstream.

## 2025-05-26 - Library Search Filter Optimization
- **Bottleneck:** `LibraryView` was calling `searchQuery.toLowerCase()` inside the filter loop for every book. For a library of 1000 books, this redundant operation ran 1000 times per render/keystroke.
- **Solution:** Lifted the query normalization out of the `.filter()` callback.
- **Learning:** React `useMemo` optimizes *when* a calculation runs, but not *how* inefficient the calculation itself is. Always check loop internals inside `useMemo` or `useCallback`.

## 2025-05-27 - Trimless Regex Optimization
- **Bottleneck:** `String.prototype.trim()` was allocating new strings in the `TextSegmenter.refineSegments` loop for every sentence, causing GC pressure.
- **Solution:** Replaced `trim()` + Regex with Regex that handles whitespace directly (e.g., `/(\S+)\s*$/`).
- **Learning:** Regexes can often perform "logic" (like ignoring whitespace) faster than allocating new strings. In hot text-processing loops, always prefer zero-allocation regexes over string mutation methods like `trim()` or `slice()`.

## 2025-05-29 - Selector Granularity Optimization
- **Bottleneck:** `useAllBooks` was being used in `ReaderControlBar` and `AudioReaderHUD` (always mounted components) to find the "Last Read" book. `useAllBooks` iterates and creates new objects for the entire library on every reading progress update.
- **Solution:** Created `useLastReadBook` selector that scans only the `progressMap` (much smaller) to find the target ID, then uses `useBook(id)`.
- **Learning:** Avoid "Catch-All" selectors like `useAllBooks` in always-mounted components. Specialized selectors that scan normalized state (IDs/Map keys) are `O(ActiveItems)` instead of `O(TotalItems)`.

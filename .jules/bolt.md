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

## 2025-05-30 - CFI Merge Optimization
- **Bottleneck:** `TextSegmenter` was calling `generateCfiRange` (and `parseCfiRange`) thousands of times during sentence merging. `generateCfiRange` performs character-by-character string scanning.
- **Solution:** Implemented `tryFastMergeCfi` using string slicing to optimistically merge CFIs that share the same parent path.
- **Learning:** `epubjs` CFI utilities are robust but expensive. For sequential text merging where parent paths are identical, manual string concatenation is ~30% faster than full parsing/regeneration.

## 2025-06-01 - Batch Store Updates
- **Bottleneck:** Importing multiple books caused `O(N)` updates to the `useBookStore`, triggering listeners (like `useAllBooks`) and re-renders for every single book added.
- **Solution:** Implemented `addBooks` action to batch updates into a single `set` call.
- **Learning:** When processing batch operations (like imports), always provide a batch action in Zustand stores. Individual `set` calls trigger middleware (Yjs, Persistence) and listeners immediately, causing unnecessary cascade work.

## 2025-06-03 - Manual String Scanning vs Trim
- **Bottleneck:** `TextSegmenter.mergeByLength` was calling `trimEnd()` and regex testing inside the loop for every merge candidate, causing allocation overhead.
- **Solution:** Implemented a manual backward character scan loop to check for punctuation and determine separation.
- **Learning:** While regex is fast for matching, `trimEnd()` allocates. For high-frequency text loops (like merging thousands of segments), simple manual character scanning (imperative code) can be ~3x faster than declarative string methods. Extract this logic to a helper for readability.

## 2025-06-04 - Unicode-Aware Manual Scanning
- **Bottleneck:** `TextSegmenter.refineSegments` used Regexes (`\s`) in a hot loop, causing overhead.
- **Solution:** Replaced with manual character scanning helpers.
- **Learning:** When optimizing away from Regex `\s`, naïve checks (e.g., `code === 32`) cause regressions for content with Unicode spaces (Em Space, NBSP). Always replicate the full Unicode whitespace range (or relevant subset) when implementing manual scanners for text processing.

## 2025-06-05 - CFI Parent Extraction Optimization
- **Bottleneck:** `getParentCfi` was using regex replace (`/^epubcfi\((.*)\)$/`) and `split`/`filter`/`pop`/`join` logic inside the hot path `AudioContentPipeline` loop (thousands of calls per chapter).
- **Solution:** Replaced regex and array operations with string slicing (`slice(8, -1)`) and `lastIndexOf('/')` to extract the parent component directly. Also optimized `parseCfiRange` to return early if no comma is present.
- **Learning:** For string format parsing in hot loops, avoid allocating intermediate arrays (`split`) or new strings (`replace`) if possible. `indexOf` and `substring`/`slice` are significantly faster (measured ~3.4x speedup).

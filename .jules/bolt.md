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

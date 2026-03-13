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

## 2025-06-06 - CFI Block Root Preprocessing
- **Bottleneck:** `getParentCfi` (used in `AudioContentPipeline`) was sorting and parsing known block roots (tables) for *every* sentence in a chapter, leading to `O(N * M)` expensive string operations.
- **Solution:** Implemented `preprocessBlockRoots` to parse roots once per section (`O(M)`) and updated `getParentCfi` to accept preprocessed structures.
- **Learning:** When a utility function takes a configuration array (like `knownBlockRoots`) inside a hot loop, consider creating a "compiled" or "preprocessed" version of that configuration to hoist expensive setup work out of the loop.

## 2025-06-07 - UseDeviceStore Isolation
- **Bottleneck:** `BookCard` subscribed to `useDeviceStore` to display a conditional resume badge. Because `useDeviceStore` (Yjs-backed) returns a new object reference on every heartbeat, ALL `BookCard` instances re-rendered every 5 minutes (or on any device change), causing UI jank in large libraries.
- **Solution:** Extracted `ResumeBadge` and `RemoteSessionsSubMenu` into separate components that isolate the `useDeviceStore` subscription.
- **Learning:** When a heavy component (like a list item) needs global state (like `devices`) for a tiny conditional UI element, extract that element. Subscribing to frequently changing global stores in list items is a performance antipattern.

## 2025-06-08 - CFI Merge Optimistic Append
- **Bottleneck:** `mergeCfiRanges` was parsing and resorting the entire list of completed ranges (O(N * ParseCost)) for every sentence read, causing frame drops during long reading sessions.
- **Solution:** Implemented an "Optimistic Append" check: if the new range starts after the last existing range, only merge the tail.
- **Learning:** For sorted list maintenance in hot paths (like reading progress), always check for the "Sequential Append" case (O(1)) before falling back to full resort (O(N)). Sequential access is the dominant pattern in reading apps.

## 2025-02-23 - [Oversized String Accumulation in GenAI Pipeline]
**Learning:** The `AudioContentPipeline` was accumulating the full text of every sentence in a logical group (potentially an entire chapter) into a single string (`fullText`), solely to pass a 200-character sample to the GenAI service for content type detection. This resulted in unnecessary memory allocation (megabytes per chapter) and string concatenation overhead.
**Action:** When preparing data for partial consumption (like sampling), always bound the accumulation logic. In this case, capping `fullText` at 1000 characters avoided the bottleneck without affecting the downstream consumer.

## 2025-02-23 - Selector Granularity & Logic Unification
- **Bottleneck:** `BookCard` was subscribing individually to `useBookProgress` (1000 listeners) while `LibraryView` was already calculating progress via `useAllBooks`. Also, the logic between the two was inconsistent (Max vs Recent).
- **Solution:** Updated `useAllBooks` to use the correct "Local > Recent" logic (by exporting helpers from `useReadingStateStore`) and removed the subscription from `BookCard`, passing `book.progress` directly.
- **Learning:** When a list item component needs data that the parent list already has access to (or can easily compute), pass it as a prop instead of creating a new subscription. This reduces selector overhead from O(N) to O(1) (parent only).

## 2025-06-11 - Optimized CFI Processing
- **Bottleneck:** `getParentCfi` was using `regex.replace` to clean CFI strings, and `AudioContentPipeline.groupSentencesByRoot` was doing the same inside a hot loop (thousands of sentences per chapter).
- **Solution:** Replaced regex operations with `startsWith`/`endsWith` and string slicing. Introduced `currentParentBase` caching in the grouping loop to avoid redundant string operations.
- **Learning:** For high-frequency string manipulation (like processing thousands of CFIs), basic string methods (`slice`, `startsWith`) are significantly faster (~4-9x) than regex. Always check for `endsWith` before slicing to ensure safety.

## 2025-03-01 - Reading List Dialog Row Memoization
- **Bottleneck:** `ReadingListDialog.tsx` subscribed to the global `entries` map from `useReadingListStore`. Any update to *any* reading list entry (e.g. background progress updates via Yjs sync) caused the entire dialog and all its mapped `<tr>` rows to re-render in `O(N)` time. This caused UI jank for large reading lists.
- **Solution:** Extracted the inline `<tr>` into a new `ReadingListRow` component wrapped in `React.memo`. Converted the inline arrow functions for row events (`onToggleSelection`, `onEdit`, `onDelete`) inside `ReadingListDialog` to `useCallback` functions that receive the entry ID, ensuring stable props.
- **Learning:** When mapping large lists of data derived from a frequently updating global store, *always* extract the list item into a memoized component and ensure parent event handlers are stable. Simply shallow-comparing the store map is insufficient if the map's derived values are used for inline rendering.

## 2025-06-12 - Selector Granularity Optimization (useBook)
- **Bottleneck:** `useBook` (used by `ReaderView`, `BookCard`, etc.) was subscribing to the *entire* `books`, `staticMetadata`, `progressMap`, and `readingListEntries` maps. This caused `O(N)` re-renders of any component using `useBook` whenever *any* book in the library was updated (e.g., from background sync).
- **Solution:** Refactored `useBook` to use fine-grained Zustand selectors (e.g., `useBookStore(state => id && state.books ? state.books[id] : null)`).
- **Learning:** When a hook takes an ID parameter to fetch a specific item from a global store, *always* use fine-grained selectors targeting that specific ID. Subscribing to the entire collection map and indexing it later destroys React performance in large lists.

## 2025-06-13 - [Selector Granularity Optimization (Object Fallback)]
**Learning:** The `useAllBooks` selector had an inline object fallback (`useReadingListStore(state => state.entries) || {}`) that created a new empty object reference on every render when the state was nullish. This caused downstream `useMemo` blocks (like the O(N) progress merge loop) to re-evaluate unnecessarily.
**Action:** When creating global selectors, avoid returning inline object literals (e.g. `|| {}`) if they are used in downstream dependency arrays. Either memoize them with `useMemo` or use a module-level constant (e.g., `const EMPTY_OBJ = {}`) to preserve reference stability and prevent cascaded re-renders.
\n## 2026-03-04 - EpubCFI Instantiation Overhead in Loops\n**Learning:** The `epubjs` library's `EpubCFI.compare()` method accepts strings, but calling it with strings inside a loop forces internal recompilation (`new EpubCFI(string)`) on every iteration. In `AudioContentPipeline.mapSentencesToAdaptations`, this caused severe `O(N * M)` string parsing overhead.\n**Action:** When comparing CFIs inside a hot path or nested loop, always pre-parse the strings into `EpubCFI` objects and pass the object references to `compare()`.

## 2025-02-13 - [React List Re-rendering Optimization]
**Learning:** Even when using `React.memo` on list item components and debouncing search input states, putting the search state (`useState`) and the list mapping logic inside the same parent component causes the entire list mapping (`O(N)` VDOM creations) to re-evaluate on *every single keystroke* before the debounce even triggers.
**Action:** When a parent component holds rapid-firing state (like an un-debounced input text) alongside a large list, use `useMemo` on the actual `Array.map` VDOM output to cache the React elements. This entirely bypasses the `O(N)` list iteration during the "typing" phase, saving significant CPU time.
## 2026-03-04 - EpubCFI Instantiation Overhead in Loops
- **Bottleneck:** The `epubjs` library's `EpubCFI.compare()` method accepts strings, but calling it with strings inside a loop (like sorting or merging) forces internal recompilation (`new EpubCFI(string)`) on every iteration. In `cfi-utils.ts`, this caused severe string parsing overhead during `mergeCfiRanges`.
- **Solution:** Modified `mergeCfiRanges` to instantiate `EpubCFI` objects upfront during the initial parsing loop, storing them in the `CfiRangeData` interface, and passing the pre-parsed objects directly to `compare()`.
- **Learning:** When comparing CFIs inside a hot path or nested loop, always pre-parse the strings into `EpubCFI` objects and pass the object references to `compare()`. Use `@ts-expect-error` if TypeScript definitions strictly expect strings, as the underlying `epubjs` implementation handles `EpubCFI` instances natively.
## 2026-03-09 - Selector Ref Caching Pattern Fix\n**Learning:** When trying to maintain referential stability for derived objects across renders, manually managing a WeakMap cache with `useRef` and conditionally invalidating it directly in the render body triggers `react-hooks/refs` errors and violates React's strict mode rules against side-effects during render.\n**Action:** Instead of manually invalidating a `useRef` based on previous dependency tracking, instantiate the WeakMap directly inside a `useMemo` hook (e.g., `useMemo(() => new WeakMap(), [deps])`). This naturally flushes the cache when dependencies change and strictly adheres to React Hook rules without any lint suppressions.

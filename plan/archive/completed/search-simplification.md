Technical Design Doc: Search Architecture Simplification
========================================================

1\. Introduction
----------------

### 1.1 Context

The current search architecture within the Versicle application relies on `FlexSearch`, a highly performant but complex inverted index library that is executed inside a dedicated Web Worker. This design borrows patterns from large-scale distributed systems, where indexing is necessary to search across thousands of documents efficiently. While this approach is theoretically robust, it introduces significant "enterprise-grade" overhead when applied to the constrained scope of a client-side e-reader. In our specific context---searching a single book which typically contains less than 1MB of text---the complexities of maintaining a full search index outweigh the benefits. The architecture prioritizes scalability for a problem size that does not require it, leading to a system that is heavier than necessary.

### 1.2 Problem

The existing implementation suffers from several critical inefficiencies that degrade both performance and maintainability:

1.  **Redundant Processing (The "Double Scan" Problem):** The system currently performs two expensive passes over the text. First, `FlexSearch` scans the entire content to tokenize words, apply stemming, and build an internal hash map structure. Then, during the actual query execution, the system performs a second pass using a standard `RegExp` to locate the specific indices needed to generate text excerpts for the UI. This effectively means we are paying the CPU cost of indexing without fully utilizing the index for retrieval.

2.  **Resource Waste (Transient Lifecycle):** Unlike a server-side search engine where an index is built once and queried millions of times, our search index is **transient**. It is rebuilt from scratch every time the user opens a book or refreshes the page. This compels the user's device to expend significant CPU cycles and memory allocation (RAM) to construct a complex data structure that is often used for only a single search query, or sometimes not at all, before being discarded.

3.  **Functional Mismatch (Fuzzy vs. Exact):** There is a fundamental disconnect between the search logic and the display logic. `FlexSearch` is designed for fuzzy matching (e.g., matching "running" when the user types "run"). However, the snippet generation logic relies on a precise `RegExp` scan. This leads to broken user experiences where the search engine reports a "hit" (because of a fuzzy match), but the excerpt generator fails to find the exact string, resulting in a fallback or empty snippet.

### 1.3 Goal

The primary objective is to radically simplify the search engine by replacing the heavy inverted index strategy with a lightweight, linear scan ("grep-style") approach using native JavaScript `RegExp`. This aligns with the "Local-First" philosophy by optimizing for the specific constraints and capabilities of the browser environment.

2\. Proposed Design: The "Grep" Refactor
----------------------------------------

### 2.1 Core Concept

The new design abandons the concept of a "search index" entirely. Instead of transforming text into a complex searchable data structure, the worker will simply hold the data in its rawest form: a `Map<href, content>`.

When a search is initiated, the system will iterate through this map and apply a global, case-insensitive Regular Expression to find matches. This leverages the browser's built-in text processing capabilities rather than implementing them in JavaScript userland.

**Key Benefits:**

-   **Performance:** Modern JavaScript engines (like V8 in Chrome and SpiderMonkey in Firefox) have incredibly optimized Regex engines (e.g., Irregexp) that compile patterns directly to machine code. Scanning a standard novel (approx. 100k words) takes negligible time (often <10ms), which is significantly faster than the initialization time required to build an inverted index.

-   **Memory Efficiency:** This approach removes the memory overhead associated with maintaining the inverted index structure (dictionaries, token maps, etc.). The worker only needs to hold the raw string data, which the browser handles efficiently using string interning and ropes.

-   **Consistency and Correctness:** By using the exact same `RegExp` for both detecting the match and extracting the surrounding context (excerpt), we guarantee 100% consistency. Every search result returned will have a valid, highlighted snippet that matches exactly what the user typed.

### 2.2 Architecture Changes

-   **Storage:** Transitioning from a complex `FlexSearch.Document` instance to a simple `Map<string, string>` (href -> text). This implies a drastic reduction in memory usage and initialization time.

-   **Ingestion:** Moving from tokenization and index building to storing raw text directly in a Map. This removes the heavy CPU "startup tax" when opening a book.

-   **Query Strategy:** Changing from a two-step process (index search + separate Regex scan) to a single-step `RegExp.exec()` loop that handles detection and extraction simultaneously. This eliminates synchronization bugs between search hits and visual highlights.

-   **Dependencies:** Removing the `flexsearch` external library in favor of the standard library. This reduces the application bundle size and maintenance surface area.

3\. Implementation Details
--------------------------

### 3.1 SearchEngine Class (`src/lib/search-engine.ts`)

The `SearchEngine` class acts as the core logic provider within the worker. It will undergo a complete rewrite to remove the `FlexSearch` dependency.

-   **Storage Mechanism:** The class will maintain a private `Map<string, string>`. The key will be the section ID or file path (href), and the value will be the sanitized plain text content of that section.

-   **Ingestion Logic (`addDocuments`):** This method becomes a simple setter. Crucially, it will retain the existing XML parsing capability using `DOMParser`.

    -   *Why retain DOMParser?* E-book chapters are essentially XHTML files. Extracting `innerText` from the main thread can cause UI jank (stuttering). By performing the XML-to-Text conversion inside the worker using `DOMParser`, we ensure that the ingestion process remains non-blocking, even for massive chapters.

-   **Search Logic (`search`):** The search algorithm will be implemented as follows:

    1.  **Input Sanitization:** Escape special regex characters in the user's query (e.g., `?`, `*`, `+`) to treat them as literal characters.

    2.  **Pattern Compilation:** Construct a `new RegExp(query, 'gi')` (Global, Case-Insensitive).

    3.  **Iteration:** Loop through each entry in the `documents` Map.

    4.  **Execution Loop:** Use a `while ((match = regex.exec(text)) !== null)` loop. This is the standard, high-performance way to find multiple occurrences of a substring in JavaScript.

    5.  **Context Extraction:** For every valid match, immediately calculate the `start` and `end` indices for the excerpt (e.g., +/- 40 characters).

    6.  **Safety Capping:** Implement a hard limit (e.g., 50 results total). This prevents the search from flooding the UI with thousands of results for common words like "the," which would degrade rendering performance.

### 3.2 Search Client (`src/lib/search.ts`)

The `SearchClient` serves as the bridge between the React UI (Main Thread) and the Search Worker. This file will remain largely unchanged to preserve the existing API contract.

-   **Comlink Interface:** It will continue to use `Comlink` to transparently wrap the worker interactions. This abstraction ensures that from the UI's perspective, calling `searchClient.search()` feels like a standard async function, hiding the complexity of message passing.

-   **API Stability:** Keeping the method signatures for `indexBook` and `search` identical ensures that no React components (like `SearchDialog`) need to be refactored during this migration.

### 3.3 Worker (`src/workers/search.worker.ts`)

This entry point file remains the "dumb" host for the engine. Its only responsibility is to instantiate the updated `SearchEngine` class and expose it via `Comlink`. No structural changes are required here.

4\. Migration Plan
------------------

### Phase 1: Preparation & Safety

1.  **Audit Test Coverage:** Before touching any code, run `src/lib/search-engine.test.ts`. Verify that it covers edge cases such as:

    -   Queries with regex special characters (e.g., "Why?").

    -   Case sensitivity checks.

    -   Unicode characters (to ensure the regex engine handles diverse languages correctly).

    -   No-match scenarios.

### Phase 2: Execution (The "Rip and Replace")

1.  **Uninstall:** Run `npm uninstall flexsearch`. This will immediately shrink the `node_modules` and the final build size.

2.  **Rewrite:** Completely replace the contents of `src/lib/search-engine.ts` with the new Map-based implementation described in Section 3.1.

3.  **Type Check:** Verify `src/types/search.ts`. While the `SearchResult` interface (href, excerpt) should remain compatible, we need to ensure that the internal types used for indexing match the new `SearchSection` requirements.

### Phase 3: Validation & QA

1.  **Unit Testing:** Run the test suite again. The goal is for all tests to pass without modification to the test files themselves (preserving behavior).

2.  **Manual Verification:**

    -   Load a standard EPUB (e.g., *Alice in Wonderland*).

    -   Search for a unique phrase. Confirm the excerpt is centered correctly on the match.

    -   Search for a common word. Confirm the results are capped at 50.

    -   Search for a term that spans a line break or contains punctuation.

5\. Risks & Mitigations
-----------------------

-   **Risk: Performance on "Mega-Books":** While rare, some users may load omnibus editions (e.g., *Complete Works of Shakespeare*, >5MB text). A synchronous regex scan over a string this size might take 200-300ms.

    -   **Mitigation:** Since the scan occurs entirely within a **Web Worker**, the main thread (UI) will remain completely responsive. The user might see a spinner for a fraction of a second, which is standard behavior for search operations.

-   **Risk: Loss of "Fuzzy" Search:** The previous engine allowed for typo tolerance (e.g., finding "banana" if the user typed "bananna").

    -   **Mitigation:** In the context of document search (Ctrl+F), users generally expect **exact** matching. The previous fuzzy implementation was actually a source of bugs because it would return a result ID without being able to highlight the text (since the regex couldn't find the typo). Removing fuzzy search is essentially a "bug fix" that aligns system behavior with user expectations for this specific tool.

6\. Success Metrics
-------------------

-   **Bundle Size:** A measurable reduction in the vendor bundle size due to the removal of `flexsearch`.

-   **Test Stability:** 100% pass rate on existing search unit tests.

-   **User Experience:** Zero instances of "ghost results" (search hits where the excerpt is empty or shows the wrong text), providing a robust and trustworthy search tool.

7\. Implementation Status
-------------------------

### 7.1 Completed Actions
-   **Dependencies:** `flexsearch` has been uninstalled.
-   **Code Rewrite:** `src/lib/search-engine.ts` has been rewritten to use `Map<string, Map<string, string>>` and native `RegExp` scanning. The logic simplifies storage and querying as planned.
-   **Verification:**
    -   Existing tests in `src/lib/search-engine.test.ts` passed.
    -   New tests covering edge cases (regex special chars, unicode, result capping, multiple matches) were added to `src/lib/search-engine.test.ts` and passed.
    -   Manual verification scenarios described in Phase 3 are covered by the automated tests.

### 7.2 Discoveries
-   The linear scan approach with `RegExp` is performant and significantly simplifies the code.
-   Handling `lastIndex` in `RegExp` with the global flag (`'gi'`) requires careful reset or fresh instantiation per search to avoid state leakage, which was implemented correctly.
-   The `SearchEngine` class now cleanly separates storage (Map) and search logic without external dependencies.

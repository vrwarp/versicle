Design Doc: Reactive Abbreviation Segmentation
==============================================

Problem Statement
-----------------

Currently, text segmentation (splitting text into sentences for TTS) occurs exclusively during the book ingestion phase. The `TextSegmenter` uses the abbreviation exception list available at the moment of import to decide where to break sentences. These segments and their corresponding Canonical Fragment Identifiers (CFIs) are then statically stored in the database.

As a result, if a user adds a new abbreviation to their settings (e.g., adding "Bros." to prevent "Super Bros. Melee" from splitting), the change does not affect existing books in the library. Users are forced to delete and re-import their books to see the changes, which is a poor user experience.

Goal
----

Make the abbreviation segmentation feature **reactive**. Changes to the global abbreviation and "Always Merge" lists should immediately impact the TTS playback queue for all books in the library without requiring re-ingestion.

High-Level Approach
-------------------

We will shift the "Abbreviation Exception" logic from a static ingestion-time process to a dynamic load-time process.

1.  **Ingestion**: Modify the ingestion pipeline to perform "Maximal Splitting" (ingest with an empty abbreviation list). This stores the most granular possible fragments and their CFIs in the database.

2.  **Section Loading**: When a chapter is loaded into the `AudioPlayerService`, we will perform a "Dynamic Refinement" pass. This pass will merge adjacent text segments and their CFIs based on the *current* user settings.

3.  **CFI Merging**: Use existing CFI utility logic to join the CFI ranges of merged segments, ensuring visual highlighting remains accurate.

Detailed Explanation & Implementation Plan
------------------------------------------

### 1\. Ingestion Refactor

We need to ensure the database contains the "atomic" building blocks of sentences.

-   **File**: `src/store/useLibraryStore.ts` and `src/lib/ingestion.ts`

-   **Change**: In `addBook` and `addBooks`, override the `ttsOptions` passed to `dbService.addBook`. Specifically, pass `abbreviations: []` and `alwaysMerge: []`.

-   **Result**: The `tts_content` table will now store "Mr." and "Smith" as two separate entries if they were split by the default `Intl.Segmenter` logic.

### 2\. Dynamic Merging Logic

We need a high-performance utility to join these atomic segments back together.

-   **File**: `src/lib/tts/TextSegmenter.ts` (or a new utility)

-   **New Method**: `refineSegments(segments: TTSContentSentence[], abbreviations: string[], alwaysMerge: string[], sentenceStarters: string[])`.

-   **Logic**:

    -   Iterate through the array of sentences.

    -   Peek at the current sentence: does it end with a word in `abbreviations` or `alwaysMerge`?

    -   If yes, check the first word of the *next* sentence against `sentenceStarters`.

    -   If a merge is required:

        1.  Concatenate the `text` strings.

        2.  Merge the `cfi` ranges using `cfi-utils.ts`.

### 3\. CFI Range Joining

To merge two CFI ranges, we leverage the structure of EPUB CFIs.

-   **Utility**: `generateCfiRange(start, end)` in `src/lib/cfi-utils.ts`.

-   **Mechanism**: Given Segment A (`startA`, `endA`) and Segment B (`startB`, `endB`), the merged range is simply `generateCfiRange(startA, endB)`. This creates a valid range CFI that `epubjs` can use for highlighting.

### 4\. AudioPlayerService Integration

The `AudioPlayerService` is the consumer of segmented text.

-   **File**: `src/lib/tts/AudioPlayerService.ts`

-   **Change**: In `loadSectionInternal`, after fetching `ttsContent` from the database:

    ```
    const settings = useTTSStore.getState();
    const refinedSentences = TextSegmenter.refineSegments(
        ttsContent.sentences,
        settings.customAbbreviations,
        settings.alwaysMerge,
        settings.sentenceStarters
    );
    // Proceed to build the queue using refinedSentences

    ```

### 5\. Chosen Migration Strategy: Clean Slate

To transition to the reactive model, existing books must be converted to the "Maximal Splitting" format. We will implement a one-time automated re-ingestion pass.

-   **Implementation**:

    -   **Database Versioning**: Increment the IndexedDB version or add a global `app_metadata` store to track the current `segmentation_format_version`.

    -   **Background Migration**: On application startup, detect if the stored version is lower than the current version.

    -   **Re-ingestion Pass**: For each book in the library, trigger a blocking task that performs the "Maximal Splitting" ingestion logic. Since the book file (blob) is already in the `files` store, this does not require user action or networking.

    -   **UI Feedback**: Show a **blocking interstitial** (full-screen overlay) with a progress bar during the migration to prevent user interaction/race conditions.

    -   **Safety**: This migration only affects the `tts_content` table; annotations and reading history (CFI-based) remain valid as the base structure of the EPUB has not changed.

Technical Considerations
------------------------

### Performance

-   Merging strings and CFIs for ~100 sentences in a chapter takes negligible time (< 5ms).

-   This avoids the heavy DOM-based offscreen rendering pass during playback, keeping chapter transitions instant.

### Case Sensitivity

-   The lookup for abbreviations should be normalized (e.g., `.toLowerCase()`) in the `refineSegments` utility to prevent user errors in the settings UI from breaking the feature.

### Contiguity

-   This design relies on the fact that `tts_content` is stored in the correct reading order. The current `extractSentencesFromNode` traversal already guarantees this.

Implementation Notes (Deviations and Discoveries)
-------------------------------------------------

### 1. CFI Merging Complexity
While `generateCfiRange` works well for segments that share a common parent (most cases within a paragraph), merging segments across different block-level elements (which might happen if "Maximal Splitting" is very aggressive or if abbreviations span blocks) is more complex.
*   **Discovery**: `epub.js` CFI range syntax (`epubcfi(P, S, E)`) assumes a common parent path `P`. If two segments have different parents, a simple "common prefix" extraction might fail or produce invalid CFIs if not handled carefully.
*   **Solution**: The implemented `TextSegmenter.refineSegments` attempts to parse and match parents. If they match, it uses `generateCfiRange` with the precise start/end offsets. If they don't (rare edge case), it falls back to `generateCfiRange` on the full raw CFI strings, relying on its internal common-prefix logic to find the highest common ancestor, which is robust enough for `epub.js`.

### 2. Migration Service & Strategy Change
A dedicated `MigrationService` was created to handle the transition.
*   **Blocking Strategy**: Based on PR feedback, the migration strategy was updated from background to **blocking**. This ensures no race conditions occur if a user tries to play a book while it is being re-segmented.
*   **UI Implementation**: `App.tsx` renders a blocking full-screen overlay with a progress bar when migration is active.
*   **App Metadata**: Added `app_metadata` object store to `EpubLibraryDB` (v14) to track `segmentation_version` separate from the schema version.
*   **Flow**: On startup (`App.tsx`), the service checks the version. If outdated (< 1), it iterates all books, retrieves the source file from the `files` store, and re-runs `extractContentOffscreen` with empty abbreviation lists.
*   **Offloaded Books**: Books that have been "offloaded" (binary removed to save space) cannot be migrated immediately. The service logs a warning and skips them. These books will naturally be "migrated" (re-ingested) when the user restores them, as the restore process uses the new ingestion logic.

### 3. Testing
*   Added `src/lib/tts/TextSegmenter.refine.test.ts` to verify the merging logic, ensuring that:
    *   Standard abbreviations (Mr., Dr.) trigger merges.
    *   "Always Merge" overrides sentence starters.
    *   Sentence starters prevent merges for ambiguous abbreviations.
    *   CFIs are correctly joined.

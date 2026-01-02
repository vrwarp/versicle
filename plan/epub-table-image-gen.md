Design Document: EPUB Table Image Ingestion
===========================================

1\. Overview
------------

EPUB files often contain complex HTML tables that are difficult to render consistently across different devices, especially in a mobile-first, reflowable environment. By capturing these tables as images during the ingestion phase, we can provide a stable, high-performance visual representation that bypasses CSS layout issues.

This plan details the integration of `@zumer/snapdom` into the `Versicle` ingestion pipeline to generate WebP versions of tables with specific optimization parameters (0.5 quality, 0.5 scale).

2\. Goals
---------

-   **Consistency**: Ensure tables look the same regardless of the reader's current font size or theme settings.

-   **Performance**: Reduce the computational overhead of rendering complex tables at runtime.

-   **Storage Efficiency**: Utilize WebP compression and scaling to minimize the impact on IndexedDB size.

-   **Persistence**: Store table-to-image mappings reliably using CFIs.

-   **Seamless Migration**: Upgrade existing books in the library without requiring a blocking bulk-reprocessing operation.

-   **Observability**: Provide visual verification of captured tables within the internal debug tools.

3\. Technical Architecture
--------------------------

### 3.1 Dependencies

-   **Library**: `@zumer/snapdom`

-   **Purpose**: To take "snapshots" of DOM elements and export them as image blobs.

### 3.2 Database Schema Updates

We need a new object store to hold the binary image data for each table.

**Store Name**: `table_images`

-   **KeyPath**: `id` (string) - Format: `${bookId}-${cfi}`

-   **Indexes**: `by_bookId` (for bulk deletion when a book is removed)

-   **Value Structure**:

    ```
    {
      id: string;
      bookId: string;
      cfi: string;
      imageBlob: Blob;
    }

    ```

### 3.3 The Ingestion Pipeline

#### Phase 1: Detection & Capture (`offscreen-renderer.ts`)

The `extractContentOffscreen` function currently renders the book spine items one by one. We will inject the table capturing logic here:

1.  **DOM Selection**: After `rendition.display(item.href)` resolves, query the document for all `<table>` elements.

2.  **CFI Generation**: For each table, generate a unique CFI.

3.  **Snapdom Integration**:

    -   Call `snapdom.toBlob` on the table element.

    -   **Settings**:

        -   `type`: `'webp'`

        -   `quality`: `0.5`

        -   `scale`: `0.5`

4.  **Data Aggregation**: Return the list of captured blobs and their CFIs as part of the `ProcessedChapter` object.

#### Phase 2: Persistence (`ingestion.ts`)

The `processEpub` function manages the database transaction. It will be updated to:

1.  Flatten the `tables` arrays from all processed chapters.

2.  Add the images to the `table_images` store within the existing `readwrite` transaction.

4\. Migration Strategy: Interstitial On-Open Reprocessing
---------------------------------------------------------

To avoid a heavy migration that reprocesses every book at once, we will implement an "On-Demand" upgrade path triggered when a book is selected for reading.

### 4.1 Feature Detection

A new metadata flag, `tablesProcessed: boolean`, will be added to the `BookMetadata` interface.

-   New books will have this set to `true` upon successful ingestion.

-   Existing books will implicitly have this as `undefined` or `false`.

### 4.2 Trigger: The Library Selection

When a user clicks/taps to open a book from the Library:

1.  The app checks the `tablesProcessed` flag for that specific book.

2.  If the flag is missing or `false`:

    -   The app intercepts the transition to the Reader.

    -   A blocking **Reprocessing Interstitial** is shown.

### 4.3 UI: Blocking Interstitial

The interstitial view will include:

-   A centered layout with a loading spinner.

-   Informative text: "Enhancing book layout... This only happens once per book."

-   A progress percentage derived from the spine items being processed.

-   An optional "Cancel" button to return to the library (stopping the task).

### 4.4 Completion and Transition

Once the offscreen task finishes:

1.  The results are persisted to `table_images`.

2.  `BookMetadata` is updated to set `tablesProcessed: true`.

3.  The UI automatically proceeds to the `ReaderView`.

5\. Gen AI Debug Enhancement: Table Carousel
--------------------------------------------

To verify the quality and correctness of captured tables, the Gen AI debug panel will be enhanced.

### 5.1 Carousel Component

We will add a horizontal carousel to the debug panel that specifically queries the `table_images` store for the currently active section.

-   **Context**: When the reader is in a specific chapter, the debug panel will show all tables snapped for that chapter.

-   **Visualization**:

    -   Display the captured WebP image.

    -   Overlay the CFI string for reference.

    -   Show the original blob size (KB).

### 5.2 Retrieval Logic

-   The component will listen to the `useReaderStore` to track the current `sectionId`.

-   It will perform a range query or filtered fetch from the `table_images` store using the `by_bookId` index, filtering for CFIs that belong to the current section's href.

6\. Implementation Notes
---------------------------------

### Done: Type Definition & Database Migration

-   Updated `src/types/db.ts` with the `TableImage` interface and the `tablesProcessed` flag in `BookMetadata`.

-   Updated `src/db/db.ts` to version `15`.

-   Implemented the `upgrade` logic to create the `table_images` object store and index.

### Done: Offscreen Capture Logic

-   Modified `ProcessedChapter` in `src/lib/offscreen-renderer.ts`.

-   Integrated `@zumer/snapdom` into the loop with the specified WebP settings.

### Done: Transaction Logic

-   Updated `src/lib/ingestion.ts` to handle the storage of `table_images`.

### Done: Interstitial UI Component

-   Created `src/components/reader/ReprocessingInterstitial.tsx`.

-   Implemented logic to fetch book file directly from `files` store using `dbService.getBookFile`.

-   Implemented logic to manage the `extractContentOffscreen` lifecycle specifically for enhancement.

-   Added logic to mark book as processed even on cancel to prevent repeated prompts.

### Done: Debug Carousel Integration

-   Modified `ContentAnalysisLegend` to fetch table images.

-   Implemented the UI in the Gen AI debug drawer with a "Table Preview" section using a scrollable carousel.

-   Implemented correct lifecycle management for Object URLs to prevent memory leaks.

### Done: Cleanup Logic

-   Updated `DBService.deleteBook` to clean up `table_images` entries.

### Deviations

-   **Reprocessing File Retrieval**: The original plan implied using `getBook` which returns both metadata and file, but types suggested `BookMetadata` doesn't have `file`. Used `dbService.getBookFile` in `ReprocessingInterstitial` to correctly fetch the binary data.
-   **Cancel Behavior**: To improve UX and prevent nagging, cancelling the reprocessing interstitial now marks the book as `tablesProcessed: true` (skipping table generation) so the user is not prompted again.
-   **Dependency Change**: Switched from `snapdom` to `@zumer/snapdom` as `snapdom` was incorrect.

7\. Optimization & Constraints
------------------------------

-   **Storage Limit**: The 0.5 scale/quality reduction is the primary strategy for minimizing space usage.

-   **Ingestion Time**: Snapping is an asynchronous operation. The blocking interstitial makes this trade-off explicit.

-   **Style Injection**: Tables must be snapped with the EPUB's internal CSS correctly applied.

Technical Design: Library Image Optimization
============================================

1\. Problem Statement
---------------------

The current implementation of the Library View in `versicle` suffers from a significant performance bottleneck related to image handling.

### Current Architecture

-   **Storage**: Book metadata and cover images are stored in a single IndexedDB object store (`books`).

-   **Data Structure**: The `BookMetadata` interface includes a `coverBlob` field which holds the full-resolution image extracted from the EPUB file.

-   **Retrieval**: The `useLibraryStore` hook calls `db.getAll('books')`. This operation loads the entire dataset into memory.

### The Bottleneck

If a user imports 50 books, and each cover is approximately 2MB:

1.  **Memory Impact**: The app attempts to load ~100MB of binary data into JavaScript memory immediately upon opening the library.

2.  **UI Blocking**: Deserializing large Blobs from IndexedDB can block the main thread.

3.  **Rendering Overhead**: The browser attempts to decode and render these high-resolution images simultaneously in the `BookCard` grid, causing frame drops and stuttering during scrolling.

2\. Library Recommendations
---------------------------

To address these issues without reinventing complex image processing logic, we will utilize two established libraries.

### A. browser-image-compression

-   **Purpose**: Client-side image resizing and compression.

-   **Justification**:

    -   **Web Worker Support**: Critical for offloading the CPU-intensive compression task from the main thread, ensuring the UI remains responsive during batch ingestion.

    -   **Simplicity**: Provides a high-level API to specify target size (MB) and dimensions (px) while maintaining aspect ratios.

    -   **Format Handling**: Automatically handles conversion (e.g., to JPEG) to maximize compression.

### B. react-lazy-load-image-component

-   **Purpose**: Efficient rendering and viewport detection.

-   **Justification**:

    -   **Intersection Observer**: Only renders the `<img>` element when it is approaching the viewport.

    -   **UX Polish**: Includes built-in support for "blur-up" effects or opacity transitions, smoothing the visual experience as images load.

    -   **Resource Management**: By deferring the rendering, we prevent the browser's image decoder from being overwhelmed by off-screen content.

3\. Architecture & Data Flow
----------------------------

The core solution involves splitting the **View Data** (Thumbnails) from the **Source Data** (Full Covers) and decoupling their storage.

### 3.1 Database Schema Updates

We will introduce a separation of concerns in IndexedDB:

1.  **`books` Store (Modified)**

    -   **Role**: Fast access for Library View.

    -   **Change**: The `coverBlob` field will now store a **compressed thumbnail** (e.g., 300px width, ~50KB) instead of the original file.

    -   **Impact**: Loading 100 books now consumes ~5MB instead of ~100MB+.

2.  **`covers` Store (New)**

    -   **Role**: On-demand access for the Reader and detailed views.

    -   **Structure**: Key-Value pair where Key = `bookId` and Value = `Blob` (Original High-Res).

    -   **Access Pattern**: Accessed only when a specific book is opened or the "Edit Metadata" dialog is triggered.

### 3.2 Ingestion Pipeline (`src/lib/ingestion.ts`)

The ingestion process needs to be updated to generate the derived asset immediately upon file drop.

1.  **Extraction**: Extract the raw cover image from the EPUB (existing logic).

2.  **Bifurcation**:

    -   **Path A (Source)**: Keep the raw blob reference.

    -   **Path B (Thumbnail)**: Pass the raw blob to `browser-image-compression` running in a Web Worker. Target a max width of 300px and a max size of 50KB.

3.  **Storage**:

    -   Write the **Thumbnail Blob** to the `BookMetadata` object in the `books` store.

    -   Write the **Source Blob** to the new `covers` store.

### 3.3 Lifecycle Management in UI (`BookCard.tsx`)

Even with small thumbnails, creating hundreds of object URLs (via `URL.createObjectURL`) can cause memory leaks if not managed.

1.  **Lazy Creation**: The component should only generate the Object URL when the image is about to be rendered (controlled by the lazy load component).

2.  **Strict Revocation**: The `useEffect` hook must strictly revoke the Object URL (`URL.revokeObjectURL`) when the component unmounts or the blob changes to free up browser heap memory.

4\. Implementation Details
--------------------------

### Phase 1: Database Migration

-   Update `src/db/db.ts` to increment the version number.

-   In the upgrade callback, create the `covers` object store.

-   *Note*: For existing users, a migration script may be needed to move existing large blobs from `books` to `covers` and generate thumbnails. Alternatively, we can treat existing blobs as "thumbnails" until the next update, accepting the performance hit for legacy data until re-imported.

### Phase 2: Ingestion Logic

Modify `src/lib/ingestion.ts`:

-   Import `browser-image-compression`.

-   Inside `processEpub`, add a step to compress `coverUrl` (if it exists) into `thumbnailBlob`.

-   Modify the transaction to write to both `books` (metadata + thumbnail) and `covers` (original).

### Phase 3: UI Component Refactor

Refactor `BookCard.tsx`:

-   Replace the standard `<img>` tag with `LazyLoadImage`.

-   Implement `useState` to hold the ephemeral Object URL.

-   Implement `useEffect` to generate the URL from `book.coverBlob`.

-   Apply CSS transitions to handle the loading state gracefully.

### Phase 4: Reader Integration

Update `src/hooks/useEpubReader.ts` or the relevant context loader:

-   Currently, the reader might rely on the EPUB file (`files` store) to extract images. If it relies on metadata, it must now fetch from the `covers` store specifically ensuring high-quality cover display in the "start of book" view.

5\. Security & Stability Considerations
---------------------------------------

-   **CSP (Content Security Policy)**: Ensure `blob:` is allowed in `img-src` directives.

-   **Ingestion Failure**: If compression fails (e.g., obscure image format), the system must fallback gracefully---either storing the original as the thumbnail (sacrificing performance for correctness) or a generic placeholder.

-   **Blob Detachment**: Ensure that Blobs stored in IndexedDB are correctly cloned/persisted and not lost when the ingestion worker terminates.

6\. Verification Plan
---------------------

1.  **Ingestion Test**: Import a large (>5MB) EPUB. Verify `books` store has a small blob and `covers` store has the large blob.

2.  **Performance Test**: Duplicate the book entry 50 times in the DB. Scroll the library. Verify 60fps performance and low memory footprint in Chrome DevTools.

3.  **Reader Test**: Open the book. Verify the cover page displays the high-resolution image, not the pixelated thumbnail.

---

## Implementation Log

### Changes Executed

1.  **Database Upgrade**:
    *   Incremented IndexedDB version to 12 in `src/db/db.ts`.
    *   Created `covers` object store for high-resolution images.
    *   Added `getCover` method to `DBService` to retrieve high-res covers.
    *   Updated `deleteBook` and `offloadBook` to manage data in the `covers` store.

2.  **Ingestion Optimization**:
    *   Integrated `browser-image-compression` in `src/lib/ingestion.ts`.
    *   Implemented dual-storage strategy:
        *   **Thumbnails**: Compressed (max 300px, ~50KB) and stored in `books` (metadata).
        *   **Originals**: Stored in `covers` store.
    *   Added fallback: If compression fails, the original image is stored as the thumbnail to ensure data integrity.

3.  **UI Refactoring**:
    *   Refactored `src/components/library/BookCard.tsx` to use `LazyLoadImage` from `react-lazy-load-image-component`.
    *   Implemented object URL management (creation and strict revocation) within `useEffect` to prevent memory leaks.
    *   Added CSS styling for the blur-up effect.

4.  **Verification**:
    *   **Unit Testing**: Created `src/lib/ingestion_images.test.ts` to verify the bifurcation logic (thumbnail vs original) and fallback mechanisms using mocks.
    *   **Integration Testing**: Ran `verification/test_journey_library.py` via Docker/Playwright. Confirmed that the library loads correctly with the new image handling logic.
    *   **Reader Verification**: Confirmed that `useEpubReader` utilizes the original EPUB file (containing full-res images) for rendering, preserving reading quality without requiring changes to the hook.

### Discoveries & Deviations

*   **Reader Integration**: The original plan suggested updating `useEpubReader.ts` to fetch from the `covers` store. Investigation revealed that the reader initializes `epub.js` with the full EPUB file (from `files` store), which inherently contains the high-resolution cover. Therefore, no changes were needed in the reader hook to maintain quality.
*   **Offloading Strategy**: When offloading a book, we chose to remove the high-res cover from the `covers` store to maximize space savings, as the thumbnail remains in the `books` metadata for library display.
*   **Restore Logic**: Restoring a book puts the file back. We do not automatically re-extract the high-res cover to the `covers` store upon restore, as the reader uses the file directly. If high-res metadata access is needed in the future, a re-import or explicit extraction step would be required.

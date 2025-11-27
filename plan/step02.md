# **Step 2: Ingestion Engine**

## **2.1 Overview**
This step covers the mechanism for importing `.epub` files into the application. This involves reading the file from the user's filesystem, parsing it using `epub.js` to extract metadata (title, author, cover), and storing the data in IndexedDB.

## **2.2 Technical Challenge**
The main challenge is handling large files without freezing the main thread and efficiently extracting the cover image, which is often embedded inside the ZIP archive of the EPUB.

## **2.3 Component: `FileUploader`**

*   **UI:** A drag-and-drop zone or a simple "Import Book" button.
*   **Logic:**
    1.  Accepts `.epub` files.
    2.  Reads the file as an `ArrayBuffer`.
    3.  Passes the buffer to the `IngestionService`.

## **2.4 Service: `IngestionService` (`src/lib/ingestion.ts`)**

We will create a service that encapsulates the parsing logic.

### **Parsing Logic using `epub.js`**

```typescript
import ePub from 'epub.js';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db'; // Helper to access IndexedDB

export async function processEpub(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const book = ePub(arrayBuffer);

  // Wait for the book to be ready
  await book.ready;

  // Extract Metadata
  const metadata = await book.loaded.metadata;
  // metadata usually contains: title, creator, description, etc.

  // Extract Cover
  // epub.js has book.coverUrl() but that returns a URL relative to the internal structure.
  // We often need to use book.archive.createUrl(coverPath) or similar.
  // A more robust way in v0.3:
  let coverBlob = null;
  const coverUrl = await book.coverUrl();
  if (coverUrl) {
    // resolve coverUrl to a Blob
    // book.archive.getBlob(coverUrl) might work if available,
    // or fetch(coverUrl) if the book is "opened".
    // Since we initialized with ArrayBuffer, epub.js treats it as an archive.
    // We can use `book.archive.getBlob(coverUrl)` if available.
    // Fallback: Use `book.loaded.cover` to get the path, then `book.archive.getBlob(path)`.
    coverBlob = await book.archive.getBlob(coverUrl);
  }

  // Generate ID
  const bookId = uuidv4();

  // Transaction to save to DB
  await db.addBook({
    id: bookId,
    title: metadata.title,
    author: metadata.creator,
    description: metadata.description,
    coverBlob: coverBlob, // We might store the Blob directly in 'books' or convert to Base64?
                          // Storing Blob in IDB is supported and efficient.
    addedAt: Date.now(),
  }, arrayBuffer);

  return bookId;
}
```

*Correction:* In `step01.md`, we defined `files` store for `ArrayBuffer`. The `books` store holds metadata. `coverBlob` should be stored in `books`.

### **Handling Covers**
*   `epub.js` provides `book.coverUrl()`. When using `ePub(ArrayBuffer)`, the internal archiving mechanism (JSZip) is used.
*   We need to ensure we can extract the image as a Blob to store it (or just store the URL if we were keeping the book open, but we are persisting).
*   *Design:* Store the cover image as a `Blob` in the `books` object store. When displaying, use `URL.createObjectURL(blob)`.

## **2.5 Store Updates: `useLibraryStore`**
*   Add `addBook` async action that calls `IngestionService.processEpub`.
*   Handle loading states (`isImporting`).
*   Error handling (invalid files).

## **2.6 UI Implementation**
*   **`LibraryView`**: Displays a grid of books.
    *   Fetch all books from `db.books`.
    *   Map to `BookCard` components.
    *   `BookCard` takes a `BookMetadata` object. It creates an object URL for the cover blob.
    *   **Important:** Implement `useEffect` in `BookCard` to `URL.revokeObjectURL` when the component unmounts to prevent memory leaks.

## **2.7 Verification**
*   Import an EPUB file.
*   Verify it appears in the Library Grid.
*   Verify the Cover image is displayed correctly.
*   Verify data exists in IndexedDB (`books` has metadata + cover blob, `files` has arraybuffer).
*   Reload page: Book should persist.

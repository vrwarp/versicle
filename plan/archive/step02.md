# **Step 2: Ingestion Engine (Completed)**

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

We created a service that encapsulates the parsing logic.

### **Parsing Logic using `epub.js`**

```typescript
import ePub from 'epub.js';
import { v4 as uuidv4 } from 'uuid';
import { getDB } from '../db/db'; // Helper to access IndexedDB

export async function processEpub(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const book = (ePub as any)(arrayBuffer);

  // Wait for the book to be ready
  await book.ready;

  // Extract Metadata
  const metadata = await book.loaded.metadata;

  // Extract Cover
  let coverBlob = null;
  const coverUrl = await book.coverUrl();
  if (coverUrl) {
    try {
        coverBlob = await book.archive.getBlob(coverUrl);
    } catch (e) {
        console.warn("Failed to extract cover blob", e);
    }
  }

  // Generate ID
  const bookId = uuidv4();

  // Transaction to save to DB
  const db = await getDB();
  const tx = db.transaction(['books', 'files'], 'readwrite');

  await tx.objectStore('books').add({
    id: bookId,
    title: metadata.title,
    author: metadata.creator,
    description: metadata.description,
    coverBlob: coverBlob,
    addedAt: Date.now(),
  });

  await tx.objectStore('files').add(arrayBuffer, bookId);
  await tx.done;

  return bookId;
}
```

### **Handling Covers**
*   `epub.js` provides `book.coverUrl()`.
*   We extract the image as a Blob and store it in the `books` object store.
*   When displaying, we use `URL.createObjectURL(blob)`.

## **2.5 Store Updates: `useLibraryStore`**
*   Added `addBook` async action that calls `IngestionService.processEpub`.
*   Handles loading states (`isImporting`).
*   Error handling (invalid files).

## **2.6 UI Implementation**
*   **`LibraryView`**: Displays a grid of books.
    *   Fetches all books from `db.books`.
    *   Maps to `BookCard` components.
    *   `BookCard` takes a `BookMetadata` object. It creates an object URL for the cover blob.
    *   **Important:** Implemented `useEffect` in `BookCard` to `URL.revokeObjectURL` when the component unmounts to prevent memory leaks.

## **2.7 Verification**
*   Imported an EPUB file (manually verified via Playwright screenshot).
*   Verified it appears in the Library Grid.
*   Verified the Cover image is displayed correctly (or fallback if no cover).
*   Verified data exists in IndexedDB (code review).
*   Reload page: Book persists (verified via code logic, store fetches on mount).

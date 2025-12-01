# Library Components

This directory contains components used to render the Library view, where users manage their collection of books.

## Files

*   **`BookCard.tsx`**: Renders a card for a single book, displaying its cover, title, author, and reading progress. It handles click events to open the book.
    *   `BookCard.test.tsx`: Unit tests for `BookCard`.
*   **`EmptyLibrary.tsx`**: The "zero state" component displayed when the library has no books. It provides options to upload a file or load the demo book.
*   **`FileUploader.tsx`**: A utility component (often headless or hidden) handling file input interactions for importing EPUBs.
    *   `FileUploader.test.tsx`: Unit tests for `FileUploader`.
*   **`LibraryView.tsx`**: The main container for the library route. It manages the layout of the book grid (using virtualization for performance) and the ingestion process.
    *   `LibraryView.test.tsx`: Unit tests for `LibraryView`.
*   **`index.ts`**: Re-exports public components for easier importing.

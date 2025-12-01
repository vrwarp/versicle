# Type Definitions

This directory contains global TypeScript type definitions and interfaces used throughout the application.

## Files

*   **`db.ts`**: Defines the interfaces for the application's data models as they are stored in the database. This includes:
    *   `Book`: Metadata for a book.
    *   `Annotation`: Structure for highlights and notes.
    *   `BookLocation`: Cached location data.
    *   `LexiconRule`: Rules for pronunciation replacement.
    *   `TTSCacheEntry`: Structure for cached audio segments.
*   **`epubjs.d.ts`**: A custom type declaration file for the `epubjs` library. It augments and corrects the official types to expose missing properties and methods required by the advanced reader implementation (e.g., `Rendition` hooks, `Book` properties).

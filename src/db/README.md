# Database

This directory contains the logic for interacting with IndexedDB, the browser's persistent local storage. The application follows a "Local-First" architecture, storing all user data (books, annotations, settings) locally.

## Files

*   **`db.ts`**: Defines the `EpubLibraryDB` schema, handles versioning, and provides the connection logic using the `idb` library. It initializes the following object stores:
    *   `books`: Metadata for imported books.
    *   `files`: Binary book content (EPUB files).
    *   `annotations`: User highlights and notes.
    *   `locations`: Cached pagination data for books.
    *   `lexicon`: Pronunciation replacement rules.
    *   `tts_cache`: Cached synthesized audio segments.
*   **`index.ts`**: Re-exports the database connection accessor (`getDB`) and other utilities.

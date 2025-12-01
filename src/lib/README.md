# Library

This directory contains the core business logic of the application, designed to be independent of the React UI components where possible.

## Directories

*   **`tts/`**: Contains the complete Text-to-Speech architecture, including the Audio Player Service, Providers (WebSpeech, Cloud), caching, and text segmentation.

## Files

### Ingestion
*   **`ingestion.ts`**: Manages the import process for EPUB files. It utilizes `epub.js` to parse the book content, extracts metadata (title, author) and the cover image, and generates a Book object for the database.
    *   `ingestion.test.ts`: Unit tests for ingestion logic (mocked).
    *   `ingestion.integration.test.ts`: Integration tests verifying parsing of real files.

### Search
*   **`search.ts`**: The main entry point for the search feature on the main thread. It instantiates the Web Worker and manages the message passing protocol (requests/responses) for search queries.
    *   `search.test.ts`: Unit tests for the search client.
    *   `search.repro.test.ts`: Regression tests for specific search bugs.
*   **`search-engine.ts`**: The logic that runs inside the Web Worker. It wraps the `FlexSearch` library to build indexes and execute queries against book content.
    *   `search-engine.test.ts`: Unit tests for the search engine.

### Text Processing
*   **`tts.ts`**: Contains the `extractSentences` function and related logic for parsing DOM nodes into speakable text segments.
    *   `tts.test.ts`: Unit tests for sentence extraction and processing.

### Utilities
*   **`utils.ts`**: General purpose utility functions, including the `cn` helper for merging Tailwind classes.
    *   `utils.test.ts`: Unit tests for utility functions.

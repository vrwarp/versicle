# State Management (Stores)

This directory contains the global state management logic for the application, implemented using `zustand`. Most stores include middleware for persistence (saving to `localStorage` or `IndexedDB`) and devtools integration.

## Files

*   **`useAnnotationStore.ts`**: Manages the state of user annotations (highlights and notes). It handles the CRUD operations, syncing changes to IndexedDB.
    *   `useAnnotationStore.test.ts`: Unit tests.
*   **`useLibraryStore.ts`**: Manages the user's library of books. It handles actions for importing books, deleting books, and loading the metadata list from the database.
    *   `useLibraryStore.test.ts`: Unit tests.
*   **`usePreferencesStore.ts`**: Manages persistent user preferences like theme, font size, and line height.
    *   `usePreferencesStore.test.ts`: Unit tests.
*   **`useReaderUIStore.ts`**: Manages ephemeral UI state for the reader, such as menu visibility and current section title.
    *   `useReaderUIStore.test.ts`: Unit tests.
*   **`useReadingStateStore.ts`**: Manages the persistent reading progress (CFI, completion percentage) for each book.
    *   `useReadingStateStore.test.ts`: Unit tests.
*   **`useTTSStore.ts`**: Manages the configuration for the Text-to-Speech system. This includes the selected provider/voice, playback rate, API keys for cloud providers, and segmentation settings.
    *   `useTTSStore.test.ts`: Unit tests.
*   **`useUIStore.ts`**: Manages global UI state that doesn't fit into domain-specific stores, such as the visibility of the Global Settings dialog.
*   **`index.ts`**: Re-exports the store hooks for convenient access.

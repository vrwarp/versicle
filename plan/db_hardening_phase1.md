# Phase 1: Architecture & Error Handling - Completed

## Summary of Changes
Implemented central `DBService` to handle all IndexedDB interactions, replacing scattered `getDB()` calls. Introduced global error handling for `QuotaExceededError` and improved data integrity.

### 1. Created `src/db/DBService.ts`
- **Singleton Pattern**: Ensures a single entry point for DB operations.
- **Methods Implemented**:
    - `getLibrary()`: Fetches all books.
    - `getBook(id)`: Fetches metadata and binary.
    - `addBook(file)`: Handles parsing (via logic moved from `ingestion.ts` inside `DBService` or used by `DBService` indirectly? Actually `DBService` implements `addBook` logic directly copying from `ingestion.ts`).
    - `deleteBook(id)`: Cascading delete for files, annotations, locations, and lexicon.
    - `saveProgress(id, cfi, progress)`: Debounced update (500ms).
    - `saveLocations(id, locations)`: Cache generated locations.
    - `addAnnotation`/`deleteAnnotation`: Atomic operations.
    - `cleanupCache()`: LRU-like cleanup for `tts_cache` (max 500 entries).
- **Error Handling**: Wraps `QuotaExceededError` into `StorageFullError` and generic errors into `DatabaseError`.

### 2. Global Error Types
- Created `src/types/errors.ts` defining `AppError`, `DatabaseError`, `StorageFullError`, and `NotFoundError`.

### 3. Refactored Components
- **`useLibraryStore.ts`**: Delegates all DB logic to `DBService`. Stores `error` state which can be "Storage full...".
- **`ReaderView.tsx`**: Uses `dbService.getBook`, `dbService.saveProgress`, and `dbService.saveLocations`. Removed direct `epubjs` -> `getDB` logic.
- **`TTSCache.ts`**: Updated to use `dbService` or at least handle `QuotaExceededError` by triggering `dbService.cleanupCache()`.

### 4. Verification
- **Unit Tests**: `src/db/DBService.test.ts` covers all methods including debouncing and cache cleanup.
- **Integration**: `verification/` suite passed, ensuring no regression in user journeys (Reading, Library, etc.).

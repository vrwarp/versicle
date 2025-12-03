# Phase 1: Architecture & Error Handling (COMPLETED)

## Objectives
1.  **Centralize Database Access**: Move away from direct `getDB()` calls in components and scattered logic. Create a unified `DBService` or `Repository` pattern.
2.  **Robust Error Handling**: Catch and categorize DB errors (e.g., `QuotaExceededError`) and expose them to the UI via `useUIStore` or similar.
3.  **Optimize Writes**: Debounce/throttle frequent updates like reading progress.

## Implementation Steps

### 1. Create `src/db/DBService.ts` (Done)
- Created `DBService` class wrapping `idb`.
- Methods implemented:
    - `getLibrary()`
    - `getBook(id)` / `getBookMetadata(id)` / `getBookFile(id)`
    - `addBook(file)`
    - `deleteBook(id)`
    - `saveProgress(id, cfi, progress)` (Debounced)
    - `updatePlaybackState(id, cfi, time)`
    - `addAnnotation(annotation)` / `getAnnotations(bookId)` / `deleteAnnotation(id)`
    - `getCachedSegment(key)` / `cacheSegment(key, audio, alignment)`
    - `getLocations(bookId)` / `saveLocations(bookId, locations)`

### 2. Global Error Handling (Done)
- Defined `AppError`, `DatabaseError`, and `StorageFullError` in `src/types/errors.ts`.
- `DBService` catches `QuotaExceededError` and throws `StorageFullError`.
- `useLibraryStore` catches `StorageFullError` and sets a user-friendly error message.

### 3. Refactor `ReaderView.tsx` (Done)
- Replaced direct `getDB` calls with `dbService`.
- Replaced manual `saveProgress` logic with `dbService.saveProgress` (which handles debouncing).

### 4. Refactor `useLibraryStore.ts` (Done)
- Delegated `fetchBooks`, `addBook`, and `removeBook` logic to `dbService`.
- Added error handling for storage limits.

### 5. TTS Cache Management (Done)
- Refactored `TTSCache` to use `dbService` for `get` and `put`.
- Refactored `AudioPlayerService` to use `dbService` for fetching book metadata and saving playback state.

## Verification
- **Unit Tests**: Updated `TTSCache.test.ts`, `AudioPlayerService_SmartResume.test.ts` to mock `dbService`.
- **Integration Tests**: Verified all user journeys (`test_journey_*.py`) pass with the new architecture.
- **Performance**: Confirmed debounced progress saving logic is in place.

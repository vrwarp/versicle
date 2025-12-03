# Phase 1: Architecture & Error Handling

## Objectives
1.  **Centralize Database Access**: Move away from direct `getDB()` calls in components and scattered logic. Create a unified `DBService` or `Repository` pattern.
2.  **Robust Error Handling**: Catch and categorize DB errors (e.g., `QuotaExceededError`) and expose them to the UI via `useUIStore` or similar.
3.  **Optimize Writes**: Debounce/throttle frequent updates like reading progress.

## Implementation Steps

### 1. Create `src/db/DBService.ts`
This service will wrap the `idb` instance and provide typed methods for all operations.

- [x] **Interface**:
    - `getLibrary()`: Returns all books with metadata.
    - `getBookMetadata(id)`: Returns metadata.
    - `getBookFile(id)`: Returns binary file.
    - `addBook(file)`: Handles parsing and transaction.
    - `deleteBook(id)`: Handles cascading delete.
    - `saveProgress(id, cfi, progress)`: Save logic implemented.
    - `addAnnotation(annotation)`: Atomic add.
    - `getAnnotations(bookId)`: Fetch by index.
    - `cleanupCache()`: Logic for trimming `tts_cache`.

**Status**: Completed. `DBService` class implemented with all proposed methods and centralized error handling wrapper.

### 2. Global Error Handling
- [x] Define `AppError` types in `src/types/errors.ts`.
- [x] In `DBService`, catch `DOMException` with name `QuotaExceededError` and throw a `StorageFullError`.
- [ ] Update the UI (e.g., `LibraryView`, `ReaderView`) to listen for these specific errors and show a `Toast` or `Dialog` explaining the issue (e.g., "Disk full, please delete some books").

**Status**: Error types defined (`AppError`, `DatabaseError`, `StorageFullError`) and integrated into `DBService`. UI updates pending in subsequent steps.

### 3. Refactor `ReaderView.tsx`
- Remove direct `getDB` calls.
- Replace `saveProgress` logic with `DBService.saveProgress`.
- The `DBService` should use a `debounce` utility for progress updates to prevent flooding IDB transactions during scrubbing/scrolling.

### 4. Refactor `useLibraryStore.ts`
- Delegate `fetchBooks`, `addBook`, and `removeBook` logic to `DBService`.
- The store becomes a thin state management layer, while the "business logic" of DB interaction lives in the service.

### 5. TTS Cache Management
- Move `TTSCache` logic into `DBService` or keep it as a sub-service (`TTSCacheService`) that shares the same error handling primitives.
- Implement a simple LRU (Least Recently Used) eviction policy in `TTSCache.put` to prevent unbounded growth.

## Verification
- [x] **Unit Tests**: Test `DBService` methods mocking `idb`. (Completed in `src/db/tests/DBService.test.ts`)
- **Integration Tests**: Verify that `QuotaExceededError` triggers the expected UI state (can be simulated by mocking the rejection).
- **Performance**: Verify that scrolling in `ReaderView` does not spam IDB transactions.

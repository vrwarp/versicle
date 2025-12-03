# Database Robustness and Backup Design Plan

## 1. Vulnerability Analysis & Current Fragility

The current database implementation relies on IndexedDB (via `idb`) with a scattered access pattern. While functional, several areas present risks regarding data integrity, error handling, and recovery from unexpected states.

### 1.1. Lack of Centralized Access & Error Handling
- **Scattered Implementation**: Database interactions occur in `src/db/db.ts`, `src/lib/ingestion.ts`, `src/store/useLibraryStore.ts`, `src/components/reader/ReaderView.tsx`, and `src/lib/tts/TTSCache.ts`. This makes it difficult to apply uniform error handling or logging.
- **Silent Failures**: Most DB operations catch errors and log them to `console.error` without notifying the user. For example, `saveProgress` in `ReaderView.tsx` fails silently, which could lead to data loss (user thinks they are at page 100, reload puts them at page 1).
- **Quota Exceeded**: There is no handling of `QuotaExceededError`. If the device runs out of space, write operations (like importing a book or caching TTS) will fail, potentially leaving the database in an inconsistent state.

### 1.2. Concurrency & Race Conditions
- **Progress Saving**: `ReaderView.tsx` triggers `saveProgress` on every `relocated` event. If a user navigates rapidly, multiple asynchronous write transactions may be fired. While IDB serializes transactions, this creates unnecessary overhead and potential logic races if `put` operations resolve out of order in the application layer (though IDB guarantees write order for the same store).
- **Tab Closing**: If a user closes the tab during a multi-step transaction (like `processEpub`), the browser *should* abort the transaction if it wasn't committed. However, logical multi-step operations that aren't in a single transaction (if any exist) would be vulnerable. Currently, `processEpub` uses a single transaction for `books` and `files`, which is good.

### 1.3. Data Integrity & Orphans
- **Orphaned Data**: `removeBook` manually deletes from `books`, `files`, `locations`, `annotations`, and `lexicon` in a single transaction. This is robust *if* it runs. However, if a previous import failed or a delete was interrupted (e.g., power loss), we might have orphaned annotations or binary files.
- **Reference Integrity**: IndexedDB does not enforce foreign key constraints. The application logic must assume responsibility for ensuring that every annotation points to a valid book.
- **Blob Corruption**: There is no checksum verification for stored EPUB files. If `files` store data is corrupted, the reader will simply fail to load the book.

### 1.4. No Backup / Restore Capability
- **Single Point of Failure**: All data resides in the browser's IndexedDB. If the user clears their browser data, uses a "cleaning" tool, or if the IDB implementation encounters a fatal corruption, **all library data, reading progress, and annotations are irretrievably lost.**
- **No Portability**: Users cannot move their library to another device or browser.

## 2. Robustness Improvement Plan

We will address these issues in three phases.

### Phase 1: Architecture & Error Handling (COMPLETED)
**Goal**: Centralize database access to ensure consistent error handling, logging, and connection management.
- **Done**: Created `src/db/DBService.ts` to wrap `idb`.
- **Done**: Implemented `DatabaseError` and `StorageFullError` in `src/types/errors.ts`.
- **Done**: Refactored `useLibraryStore.ts` to use `DBService` and handle errors appropriately.
- **Done**: Refactored `ReaderView.tsx` to use `DBService` and debounced progress saving.
- **Done**: Refactored `TTSCache.ts` and `AudioPlayerService.ts` to use `DBService`.
- **Done**: Updated tests to mock `DBService` instead of direct DB access.

### Phase 2: Integrity & Maintenance
**Goal**: Ensure data consistency and provide tools to fix "broken" states.
- Implement a "Health Check" routine that runs on startup (or on demand) to identify and clean orphaned records (e.g., annotations for non-existent books).
- Add a "Safe Mode" for the app if the DB fails to open, allowing the user to export data or reset the DB.
- Validate data structures on read (Schema Validation) to prevent runtime crashes due to malformed data.

### Phase 3: Backup & Restore (Snapshots)
**Goal**: Enable full data portability and disaster recovery.
- **Snapshot Generation**: Create a mechanism to export the entire database (or subsets) into a portable format.
    - **Light Snapshot**: JSON export of metadata, annotations, lexicon, and progress (no binary books).
    - **Full Snapshot**: ZIP archive containing the Light Snapshot JSON + all EPUB files.
- **Snapshot Restoration**: A strict import process that validates the snapshot integrity, handles conflicts (e.g., book already exists), and restores the library.

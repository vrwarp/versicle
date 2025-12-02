# Phase 2: Integrity & Maintenance

## Objectives
1.  **Data Consistency**: Ensure no orphaned records exist in the database.
2.  **Schema Validation**: Verify that data read from IDB matches the expected runtime types.
3.  **Startup Checks**: Run a lightweight health check on application boot.

## Implementation Steps

### 1. Schema Validation (Runtime)
- Introduce a lightweight validation library (like `zod`) or write custom type guards.
- In `DBService.getLibrary()`, validate that each record matches the `BookMetadata` schema.
- If a record is malformed, log it and potentially mark it as "corrupted" in the UI rather than crashing the app.

### 2. Orphan Detection Routine
- Create a `MaintenanceService`.
- **Function**: `scanForOrphans()`
    - Get all `bookIds` from `books` store.
    - Check `files` store: Ensure every file has a corresponding book.
    - Check `annotations`: Ensure every annotation's `bookId` exists in `books`.
    - Check `lexicon`: Ensure rule `bookId`s exist.
- **Action**: Provide a "Repair" button in Global Settings -> Data Management that runs this scan and deletes orphans.

### 3. Safe Mode
- If `initDB` fails (e.g., version error, corruption), the app should not white-screen.
- Wrap the main app initialization in a `try/catch`.
- If DB fails to open, render a `SafeModeView` instead of `App`.
    - Options in Safe Mode:
        - "Reset Database" (Dangerous, wipes everything).
        - "Export Logs" (if available).
        - "Try Again".

### 4. Binary Verification (Optional but recommended)
- When opening a book, check if `files` entry exists and is a valid `ArrayBuffer`.
- If missing/corrupt, flag the book in the Library view (e.g., "File Missing") and disable the "Read" button, offering a "Delete" option instead.

## Verification
- **Manual Testing**: Manually insert bad data (orphaned annotations) via DevTools, run the Repair tool, and verify cleanup.
- **Simulated Corruption**: Modify IDB to remove a binary file, verify the app handles it gracefully (shows error instead of crashing).

# Reading List v2 Plan

## Context
The original Reading List feature (archived in `plan/archive/completed/reading-list.md`) was designed to provide a persistent history of books even after their binary files were deleted. It relied on a separate `reading_list` object store.

In the v18+ architecture (and v20 migration), the `reading_list` store was removed, and data was migrated to `user_inventory` and `user_progress`. However, the current implementation of `upsertReadingListEntry` fails when importing entries for books that do not already exist in the library. This breaks the use case of importing a reading history (e.g., from Goodreads) containing books the user has not yet uploaded.

## Goal
Restore the ability to maintain "Ghost" or "Shell" books—entries that track metadata and progress but lack the actual EPUB file—within the strict v18+ data architecture.

## Strategy: Shell Books
Instead of re-introducing a separate store, we will utilize the existing `static_manifests`, `user_inventory`, and `user_progress` stores to represent these entries.

### 1. Data Structure for Shell Books
A "Shell Book" is defined as:
- **`static_manifests`**: Contains `title`, `author`, `bookId`.
    - `fileHash`: Set to a special sentinel value `'PLACEHOLDER'`.
    - `fileSize`: 0.
    - `totalChars`: 0.
- **`user_inventory`**: Contains `sourceFilename`, `status`, `rating`.
- **`user_progress`**: Contains `percentage` (from CSV).
- **`static_resources`**: **MISSING** (This key will not exist).

### 2. Logic Updates

#### `DBService.upsertReadingListEntry`
- **Current Behavior**: Updates existing inventory if found; logs warning and aborts if not found.
- **New Behavior**:
    1. Check if book exists (by filename match in `user_inventory`).
    2. If found: Update as before.
    3. If **NOT found**:
        - Generate a new UUID for `bookId`.
        - Create `StaticBookManifest` with:
            - `fileHash: 'PLACEHOLDER'`
            - `title`, `author` from entry.
        - Create `UserInventoryItem` with status and rating.
        - Create `UserProgress` with percentage.

#### `DBService.restoreBook`
- **Current Behavior**: Throws error if uploaded file's fingerprint doesn't match `manifest.fileHash`.
- **New Behavior**:
    - If `manifest.fileHash === 'PLACEHOLDER'`:
        - **Allow** the restore.
        - **Update** `manifest.fileHash`, `manifest.fileSize`, `manifest.totalChars` with the new file's real values.
        - Proceed to save file to `static_resources`.

#### `DBService.getLibrary` / `getBook`
- These methods already calculate `isOffloaded` based on the absence of `static_resources`.
- Shell books will naturally appear as `isOffloaded: true`.
- The UI will display them with the cloud icon, which is the desired behavior for "books I don't have on device".

## Implementation Details

### Validation
- **Unit Tests**:
    - `upsertReadingListEntry`: Verify it creates a shell book when one doesn't exist.
    - `restoreBook`: Verify it accepts a file for a shell book and updates the hash.
    - `getLibrary`: Verify shell books appear and are marked `isOffloaded`.

### Migration
- No new migration needed for the DB schema itself. The code changes will handle new imports. Existing "lost" reading list entries from before v20 are already gone (migrated or deleted), so this fixes *future* imports and re-enables the feature.

## Risks
- **Duplicate Shells**: If a user imports a CSV multiple times with different filenames for the same book, we might create duplicates because we only match on `sourceFilename`.
    - *Mitigation*: We could attempt to match on `ISBN` if provided in the CSV, but `user_inventory` doesn't strictly index ISBN. `static_manifests` has it but we'd need to scan all manifests. For now, filename matching is the legacy behavior and acceptable MVP.

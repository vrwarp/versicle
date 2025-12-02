# Phase 3: Backup & Restore (Snapshots)

## Objectives
1.  **Data Portability**: Allow users to export their entire library (or just metadata) to a file.
2.  **Disaster Recovery**: Enable restoring from a backup file.
3.  **Cross-Device Migration**: Facilitate moving the library to a new instance.

## Implementation Steps

### 1. Data Formats
- **Light Backup (`.json`)**:
    - JSON object containing:
        - `version`: Backup schema version.
        - `timestamp`: Date of backup.
        - `books`: Array of `BookMetadata`.
        - `annotations`: Array of `Annotation`.
        - `lexicon`: Array of `LexiconRule`.
        - `locations`: Array of `BookLocations`.
    - **Note**: Does NOT include the actual EPUB binary files. Good for syncing progress/notes if user has the files elsewhere or for "Bookmarks only" backup.

- **Full Backup (`.vbackup` or `.zip`)**:
    - A ZIP archive containing:
        - `manifest.json`: The "Light Backup" JSON.
        - `files/`: Directory containing EPUB files, named by `bookId`.

### 2. Export Functionality
- Add `BackupService`.
- **Method**: `createFullBackup()`
    - Uses `JSZip` (library needs to be added).
    - Fetches all data from IDB.
    - Adds `manifest.json` to zip.
    - Iterates `files` store, adding each `ArrayBuffer` to zip under `files/{id}.epub`.
    - Generates Blob, triggers download.

### 3. Import Functionality
- **Method**: `restoreBackup(file: File)`
    - Reads ZIP file.
    - Parses `manifest.json`.
    - **Conflict Resolution Strategy**:
        - If book ID exists:
            - Option A: Overwrite (default for restore).
            - Option B: Skip.
            - Option C: Duplicate (new ID).
        - For this plan, we will implement **Smart Merge**:
            - If book exists, update `lastRead`, `progress`, and merge annotations (avoid duplicates by ID).
            - If book does not exist, import metadata and file from zip.
    - **Validation**: Ensure `manifest.json` structure is valid before writing anything.

### 4. UI Integration
- Add "Backups" section to `GlobalSettingsDialog` -> "Data Management".
- Buttons: "Export Full Backup", "Export Metadata Only", "Restore Backup".
- Progress indicator for Import/Export (crucial for large libraries).

## Verification
- **Round-Trip Test**: Export library -> Clear DB -> Import library -> Verify all books, progress, and annotations are back.
- **Partial Restore**: Import a backup into an existing library. Verify logic merges correctly without data loss.

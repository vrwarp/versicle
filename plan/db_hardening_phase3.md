# Phase 3: Backup & Restore (Snapshots) (COMPLETED)

## Objectives
1.  **Data Portability**: Allow users to export their entire library (or just metadata) to a file.
2.  **Disaster Recovery**: Enable restoring from a backup file.
3.  **Cross-Device Migration**: Facilitate moving the library to a new instance.

## Implementation Details

### 1. Data Formats
- **Light Backup (`.json`)**:
    - Contains: `version`, `timestamp`, `books` (metadata), `annotations`, `lexicon`, `locations`.
    - Excludes: Binary files (`coverBlob` stripped).
- **Full Backup (`.zip`)**:
    - Archive containing:
        - `manifest.json`: The Light Backup data.
        - `files/`: Directory containing EPUB files named by ID.

### 2. Export Functionality
- **`src/lib/BackupService.ts`**:
    - `createLightBackup()`: Exports sanitized JSON.
    - `createFullBackup()`: Uses `JSZip` to bundle metadata and files.
    - Progress callbacks integrated for UI feedback.

### 3. Import Functionality
- **`restoreBackup(file)`**:
    - Auto-detects JSON vs ZIP.
    - **Smart Merge Strategy**:
        - Updates existing books if backup is newer (`lastRead`).
        - Imports new books.
        - Merges annotations and lexicon rules.
        - Handles missing files by marking books as "Offloaded".
    - **Robust Restore Process**:
        - Decoupled metadata restoration from file decompression to prevent `TransactionInactiveError`.
        - Metadata transaction runs first.
        - File restoration runs in separate, short-lived transactions per file.

### 4. UI Integration
- **`GlobalSettingsDialog`**:
    - Added "Backups" section under "Data Management".
    - Buttons for "Export Full Backup", "Export Metadata Only", "Restore Backup".
    - Status indicators for ongoing operations.

## Verification
- **Unit Tests**: `src/lib/BackupService.test.ts` covers manifest generation, file handling, and merge logic.
- **Integration Tests**: `verification/test_journey_backup.py` validates both Light and Full backup cycles:
    1. Import book & add data.
    2. Export backup (Light & Full).
    3. Delete book.
    4. Restore backup.
    5. Verify data restoration (Offloaded state for Light, Full restoration for ZIP).

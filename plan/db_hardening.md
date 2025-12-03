# Database Robustness and Backup Design Plan

## 1. Vulnerability Analysis & Current Fragility (RESOLVED)

The initial analysis identified several risks which have been addressed:

### 1.1. Lack of Centralized Access & Error Handling (Addressed in Phase 1)
- **Scattered Implementation**: Centralized in `src/db/DBService.ts`.
- **Silent Failures**: Implemented `DatabaseError` and `StorageFullError` handling.
- **Quota Exceeded**: `StorageFullError` now propagated.

### 1.2. Concurrency & Race Conditions (Addressed in Phase 1)
- **Progress Saving**: Debounced saving in `DBService` prevents transaction overload.
- **Tab Closing**: Transactions are atomic where possible.

### 1.3. Data Integrity & Orphans (Addressed in Phase 2)
- **Orphaned Data**: `MaintenanceService` scans and prunes orphans.
- **Reference Integrity**: Validators ensure metadata consistency.
- **Blob Corruption**: SHA-256 hashes used for verification.

### 1.4. No Backup / Restore Capability (Addressed in Phase 3)
- **Single Point of Failure**: Full backup implemented.
- **No Portability**: JSON (metadata) and ZIP (full) export/import implemented.

## 2. Robustness Improvement Plan

We addressed these issues in three phases.

### Phase 1: Architecture & Error Handling (COMPLETED)
**Goal**: Centralize database access to ensure consistent error handling, logging, and connection management.
- **Done**: Created `src/db/DBService.ts` to wrap `idb`.
- **Done**: Implemented `DatabaseError` and `StorageFullError` in `src/types/errors.ts`.
- **Done**: Refactored `useLibraryStore.ts` to use `DBService` and handle errors appropriately.
- **Done**: Refactored `ReaderView.tsx` to use `DBService` and debounced progress saving.
- **Done**: Refactored `TTSCache.ts` and `AudioPlayerService.ts` to use `DBService`.
- **Done**: Updated tests to mock `DBService` instead of direct DB access.

### Phase 2: Integrity & Maintenance (COMPLETED)
**Goal**: Ensure data consistency and provide tools to fix "broken" states.
- **Done**: Implemented `src/db/validators.ts` to validate book metadata on read.
- **Done**: Created `src/lib/MaintenanceService.ts` to scan and prune orphaned files, annotations, locations, and lexicon entries.
- **Done**: Added "Safe Mode" (`src/components/SafeModeView.tsx`) to handle critical DB failures gracefully on startup.
- **Done**: Added "Repair Database" tool in Global Settings -> Data Management.
- **Done**: Verified via `test_safe_mode.py` and `test_maintenance.py`.

### Phase 3: Backup & Restore (Snapshots) (COMPLETED)
**Goal**: Enable full data portability and disaster recovery.
- **Done**: Implemented `BackupService` with `createFullBackup`, `createLightBackup`, and `restoreBackup`.
- **Done**: Added UI controls in `GlobalSettingsDialog`.
- **Done**: Implemented JSON and ZIP export using `jszip` and `file-saver`.
- **Done**: Implemented "Smart Merge" logic for restores.
- **Done**: Verified via `verification/test_journey_backup.py` and `src/lib/BackupService.test.ts`.

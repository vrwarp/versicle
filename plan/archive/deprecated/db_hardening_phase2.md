# Phase 2: Integrity & Maintenance (COMPLETED)

## Objectives
1.  **Data Consistency**: Ensure no orphaned records exist in the database.
2.  **Schema Validation**: Verify that data read from IDB matches the expected runtime types.
3.  **Startup Checks**: Run a lightweight health check on application boot.

## Implementation Details

### 1. Schema Validation (Runtime)
- **Implemented**: `src/db/validators.ts` with `validateBookMetadata`.
- **Integration**: `DBService.getLibrary()` now filters out books that fail validation, logging an error for each corrupted record found. This prevents the library view from crashing due to malformed data.

### 2. Orphan Detection Routine
- **Implemented**: `MaintenanceService` in `src/lib/MaintenanceService.ts`.
- **Functions**:
    - `scanForOrphans()`: Checks `files`, `annotations`, `locations`, and `lexicon` stores for entries referencing non-existent books.
    - `pruneOrphans()`: Deletes identified orphaned records transactionally.
- **UI**: Added "Maintenance" section to `GlobalSettingsDialog` (Data Management tab) with a "Check & Repair Database" button.

### 3. Safe Mode
- **Implemented**: `src/components/SafeModeView.tsx`.
- **Logic**: `App.tsx` now attempts to initialize the database before rendering the main router. If `getDB()` fails (e.g., corruption, version error), it catches the error and renders `SafeModeView`.
- **Features**:
    - Displays the error message.
    - "Try Again" button (reloads).
    - "Reset Database" button (deletes DB and reloads).

### 4. Verification
- **Test Suite**: Added `verification/test_safe_mode.py` and `verification/test_maintenance.py`.
    - `test_safe_mode`: Simulates a DB open failure and verifies the Safe Mode UI appears.
    - `test_maintenance`: Injects orphaned records into IndexedDB and verifies that the Repair tool detects and removes them.

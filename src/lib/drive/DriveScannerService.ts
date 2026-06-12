/**
 * @deprecated Phase 7 façade — scan/index/diff/import orchestration lives at
 * `src/domains/google/drive/DriveLibrarySync.ts` (injected DriveClient +
 * store-backed ports wired in src/app/google/wireGoogle.ts; the
 * `error.message.includes('is not connected')` sniffs became `instanceof
 * GoogleAuthRequiredError`). This module keeps the legacy static surface
 * compiling for its consumers (DriveImportDialog, ContentMissingDialog,
 * SyncSettingsTab, the boot auto-scan task) and forwards the
 * silent/interactive split explicitly.
 *
 * Deletion deadline: Phase 7 exit (migrate consumers to
 * `getDriveLibrarySync()` from '@domains/google').
 */
import { getDriveLibrarySync } from '@domains/google';
import type { DriveFile, DriveFileIndex, DriveRequestOptions } from '@domains/google';

export type { DriveFile, DriveFileIndex };

export class DriveScannerService {
  /** Silent by default (boot policy); pass { interactive: true } from UI. */
  static scanLinkedFolder(opts?: DriveRequestOptions): Promise<DriveFile[]> {
    return getDriveLibrarySync().scanLinkedFolder(opts);
  }

  /** User-gesture import: interactive token acquisition by default. */
  static importFile(
    fileId: string,
    fileName: string,
    options?: { overwrite?: boolean },
    opts: DriveRequestOptions = { interactive: true },
  ): Promise<void> {
    return getDriveLibrarySync().importFile(fileId, fileName, options, opts);
  }

  /** Silent by default (boot policy); pass { interactive: true } from UI. */
  static scanAndIndex(opts?: DriveRequestOptions): Promise<void> {
    return getDriveLibrarySync().scanAndIndex(opts);
  }

  /** Silent by default; the settings "Scan" button passes interactive. */
  static checkForNewFiles(opts?: DriveRequestOptions): Promise<DriveFileIndex[]> {
    return getDriveLibrarySync().checkForNewFiles(opts);
  }

  /** Always silent — never pops UI, never disconnects (GG-2). */
  static shouldAutoSync(): Promise<boolean> {
    return getDriveLibrarySync().shouldAutoSync();
  }
}

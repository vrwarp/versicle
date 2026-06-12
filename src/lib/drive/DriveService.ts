/**
 * @deprecated Phase 7 façade — the Drive REST client lives at
 * `src/domains/google/drive/DriveClient.ts` (typed DriveApiError, gateway
 * egress, silent/interactive token split). This module keeps the legacy
 * static surface compiling for its UI consumers (useDriveBrowser,
 * DriveFolderPicker, DriveImportDialog, ContentMissingDialog) and delegates
 * to the composed DriveClient with `{ interactive: true }` — these are all
 * user-gesture surfaces, so escalating to the login UI on a missing token
 * preserves the pre-Phase-7 popup-on-demand UX without the force-disconnect.
 *
 * Deletion deadline: Phase 7 exit (migrate consumers to
 * `getDriveClient()` from '@domains/google' and pass explicit options).
 */
import { getDriveClient } from '@domains/google';
import type { DriveFile } from '@domains/google';

export type { DriveFile };

const INTERACTIVE = { interactive: true } as const;

export const DriveService = {
  listFolders(parentId = 'root'): Promise<DriveFile[]> {
    return getDriveClient().listFolders(parentId, INTERACTIVE);
  },

  getFolderMetadata(folderId: string): Promise<DriveFile> {
    return getDriveClient().getFolderMetadata(folderId, INTERACTIVE);
  },

  listFiles(parentId: string, mimeType?: string): Promise<DriveFile[]> {
    return getDriveClient().listFiles(parentId, mimeType, INTERACTIVE);
  },

  listFilesRecursive(parentId: string, mimeType?: string): Promise<DriveFile[]> {
    return getDriveClient().listFilesRecursive(parentId, mimeType, INTERACTIVE);
  },

  downloadFile(fileId: string): Promise<Blob> {
    return getDriveClient().downloadFile(fileId, INTERACTIVE);
  },
};

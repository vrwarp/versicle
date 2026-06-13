/** Drive v3 file/folder resource subset used by the app (Phase 7 §G). */
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  size?: string;
  md5Checksum?: string;
  modifiedTime?: string;
  viewedByMeTime?: string;
}

/**
 * Lightweight persisted index entry (the useDriveStore scan index). Owned
 * here so the domain never imports the store (domains-no-store).
 */
export interface DriveFileIndex {
  id: string;
  name: string;
  size: number;
  modifiedTime: string;
  mimeType: string;
}

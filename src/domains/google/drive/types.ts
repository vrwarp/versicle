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
  /**
   * Drive's content MD5 (blob files only; absent for Google-native docs).
   * Fetched by listFiles today but historically dropped by the index mapper.
   * Persisted now as the cache key for partial-fetch previews ({fileId, md5})
   * — a re-uploaded file keeps its fileId but changes md5, so the pair detects
   * a stale preview. Optional: rows scanned before this field existed lack it
   * until the next scan.
   */
  md5Checksum?: string;
}

/**
 * A partial-fetch EPUB preview for a Drive file: metadata + cover extracted by
 * ranged reads without a full download. Domain-owned DTO so neither the
 * service nor the UI imports the data-layer row type. `status:'unextractable'`
 * carries no metadata — it means the file could not be read via ranges (the
 * negative-cache case) and the caller should fall back to filename/size.
 */
export interface DriveEpubPreview {
  fileId: string;
  md5Checksum?: string;
  status: 'ok' | 'unextractable';
  title?: string;
  author?: string;
  description?: string;
  language?: string;
  identifiers?: string[];
  /** Present only for status:'ok' when the EPUB had a resolvable cover. */
  cover?: Blob;
}

/**
 * The outcome of a preview request. `preview` is set only on 'ok'; the other
 * statuses tell the UI why there is nothing to show so it can fall back
 * (filename/size) or offer the right affordance ('auth' → reconnect).
 */
export interface DrivePreviewOutcome {
  status: 'ok' | 'unextractable' | 'auth' | 'offline' | 'unsupported' | 'gone' | 'error';
  preview?: DriveEpubPreview;
}

/** Scheduling priority for a preview request (interactive preempts the rest). */
export type DrivePreviewPriority = 'interactive' | 'viewport' | 'trickle';

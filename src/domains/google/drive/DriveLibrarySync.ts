/**
 * DriveLibrarySync (Phase 7 §G) — scan/index/diff/import orchestration over
 * an injected DriveClient + injected ports (no store imports;
 * domains-no-store is at error — src/app/google/wireGoogle.ts injects the
 * store-backed adapters).
 *
 * Replaces the static DriveScannerService (a deprecated façade until its
 * P9 deletion — consumers now resolve this orchestrator via the holder).
 * The four
 * `error.message.includes('is not connected')` sniffs became `instanceof
 * GoogleAuthRequiredError` checks (GG-7), and the silent/interactive split
 * is explicit per call: the boot auto-scan policy stays silent (it can no
 * longer pop login UI or get the user force-disconnected — GG-2), while
 * user-gesture callers pass { interactive: true }.
 */
import { GoogleAuthRequiredError } from '../auth/errors';
import type { DriveClient, DriveRequestOptions } from './DriveClient';
import type { DriveFile, DriveFileIndex } from './types';

export interface DriveLibrarySyncPorts {
  client: Pick<
    DriveClient,
    'listFilesRecursive' | 'getFolderMetadata' | 'downloadFile'
  >;
  /** useDriveStore adapter. */
  driveIndex: {
    getLinkedFolderId(): string | null;
    getLastScanTime(): number | null;
    getIndex(): DriveFileIndex[];
    setScanning(isScanning: boolean): void;
    setScannedFiles(files: DriveFileIndex[]): void;
  };
  /** useLibraryStore/useBookStore adapter. */
  library: {
    addBook(file: File, options?: { overwrite?: boolean }): Promise<unknown>;
    getLibraryFilenames(): Set<string | undefined>;
  };
  /** The persisted "has connected before" hint (reconnect-affordance copy). */
  hasConnectedBefore(): boolean;
  log?: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
}

const noopLog = { info: () => {}, warn: () => {}, error: () => {} };

export class DriveLibrarySync {
  private readonly log: NonNullable<DriveLibrarySyncPorts['log']>;

  constructor(private readonly ports: DriveLibrarySyncPorts) {
    this.log = ports.log ?? noopLog;
  }

  /** Scan the linked folder for EPUB files. */
  async scanLinkedFolder(opts: DriveRequestOptions = {}): Promise<DriveFile[]> {
    const linkedFolderId = this.ports.driveIndex.getLinkedFolderId();
    if (!linkedFolderId) {
      this.log.warn('No linked folder ID found.');
      return [];
    }
    try {
      return await this.ports.client.listFilesRecursive(
        linkedFolderId,
        'application/epub+zip',
        opts,
      );
    } catch (error) {
      if (error instanceof GoogleAuthRequiredError) {
        this.log.warn(`Failed to scan linked folder: ${error.message}`);
      } else {
        this.log.error('Failed to scan linked folder:', error);
      }
      throw error;
    }
  }

  /** Download a Drive file and import it into the library. */
  async importFile(
    fileId: string,
    fileName: string,
    options?: { overwrite?: boolean },
    opts: DriveRequestOptions = { interactive: true },
  ): Promise<void> {
    try {
      this.log.info(`Downloading file: ${fileName} (${fileId})`);
      const blob = await this.ports.client.downloadFile(fileId, opts);
      const file = new File([blob], fileName, { type: 'application/epub+zip' });
      this.log.info(`Importing file to library: ${fileName}`);
      await this.ports.library.addBook(file, options);
    } catch (error) {
      if (error instanceof GoogleAuthRequiredError) {
        this.log.warn(`Failed to import file ${fileName}: ${error.message}`);
      } else {
        this.log.error(`Failed to import file ${fileName}:`, error);
      }
      throw error;
    }
  }

  private static mapToDriveFileIndex(file: DriveFile): DriveFileIndex {
    return {
      id: file.id,
      name: file.name,
      size: parseInt(file.size || '0', 10),
      modifiedTime: file.modifiedTime || new Date().toISOString(),
      mimeType: file.mimeType,
    };
  }

  /** Full scan of the linked folder; updates the persisted index. */
  async scanAndIndex(opts: DriveRequestOptions = {}): Promise<void> {
    const linkedFolderId = this.ports.driveIndex.getLinkedFolderId();
    if (!linkedFolderId) {
      this.log.warn('No linked folder ID found.');
      return;
    }
    try {
      this.ports.driveIndex.setScanning(true);
      this.log.info('Starting full drive scan...');
      const rawFiles = await this.ports.client.listFilesRecursive(
        linkedFolderId,
        'application/epub+zip',
        opts,
      );
      const index = rawFiles.map(DriveLibrarySync.mapToDriveFileIndex);
      this.log.info(`Scan complete. Indexed ${index.length} files.`);
      this.ports.driveIndex.setScannedFiles(index);
    } catch (error) {
      if (error instanceof GoogleAuthRequiredError) {
        this.log.warn(`Failed to scan and index: ${error.message}`);
      } else {
        this.log.error('Failed to scan and index:', error);
      }
      throw error;
    } finally {
      this.ports.driveIndex.setScanning(false);
    }
  }

  /**
   * Diff the cloud index against the local library; scans first when the
   * index is empty.
   */
  async checkForNewFiles(opts: DriveRequestOptions = {}): Promise<DriveFileIndex[]> {
    let index = this.ports.driveIndex.getIndex();
    if (index.length === 0) {
      await this.scanAndIndex(opts);
      index = this.ports.driveIndex.getIndex();
    }

    const libraryFilenames = this.ports.library.getLibraryFilenames();
    const newFiles = index.filter((f) => !libraryFilenames.has(f.name));
    this.log.info(`Diff logic: Found ${newFiles.length} new files available for import.`);
    return newFiles;
  }

  /**
   * Auto-sync heuristic: linked + connected-before + (never scanned, or the
   * folder was viewed since the last scan). ALWAYS silent: an unavailable
   * token means "don't sync" — never a popup, never a disconnect.
   */
  async shouldAutoSync(): Promise<boolean> {
    const linkedFolderId = this.ports.driveIndex.getLinkedFolderId();
    if (!linkedFolderId) return false;
    if (!this.ports.hasConnectedBefore()) return false;

    const lastScanTime = this.ports.driveIndex.getLastScanTime();
    if (!lastScanTime) return true;

    try {
      const metadata = await this.ports.client.getFolderMetadata(linkedFolderId, {
        interactive: false,
      });
      const viewedTime = metadata.viewedByMeTime
        ? new Date(metadata.viewedByMeTime).getTime()
        : 0;
      return viewedTime > lastScanTime;
    } catch (error) {
      if (error instanceof GoogleAuthRequiredError) {
        this.log.warn(`Auto-sync heuristic: token unavailable (${error.message}).`);
        return false;
      }
      this.log.warn('Failed to check folder metadata for auto-sync heuristic:', error);
      // Default to true on unknown errors to be safe (legacy behavior).
      return true;
    }
  }
}

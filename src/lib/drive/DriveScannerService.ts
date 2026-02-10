import { DriveService, type DriveFile } from './DriveService';
import { useDriveStore } from '../../store/useDriveStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useBookStore } from '../../store/useBookStore';
import { createLogger } from '../logger';

const logger = createLogger('DriveScannerService');

export class DriveScannerService {
    /**
     * Scans the linked folder for EPUB files.
     * @returns A list of DriveFile objects found in the folder.
     */
    static async scanLinkedFolder(): Promise<DriveFile[]> {
        const { linkedFolderId } = useDriveStore.getState();

        if (!linkedFolderId) {
            logger.warn("No linked folder ID found.");
            return [];
        }

        try {
            // List all EPUB files in the linked folder
            return await DriveService.listFilesRecursive(linkedFolderId, 'application/epub+zip');
        } catch (error) {
            logger.error("Failed to scan linked folder:", error);
            throw error;
        }
    }

    /**
     * Downloads a file from Drive and imports it into the library.
     * @param fileId The ID of the file to download.
     * @param fileName The name of the file (used for the File object).
     */
    static async importFile(fileId: string, fileName: string, options?: { overwrite?: boolean }): Promise<void> {
        try {
            logger.info(`Downloading file: ${fileName} (${fileId})`);
            const blob = await DriveService.downloadFile(fileId);

            const file = new File([blob], fileName, { type: 'application/epub+zip' });

            logger.info(`Importing file to library: ${fileName}`);
            await useLibraryStore.getState().addBook(file, options);
        } catch (error) {
            logger.error(`Failed to import file ${fileName}:`, error);
            throw error;
        }
    }

    /**
     * Helper to map DriveFile items to lightweight DriveFileIndex
     */
    private static mapToDriveFileIndex(file: DriveFile): import('../../store/useDriveStore').DriveFileIndex {
        return {
            id: file.id,
            name: file.name,
            size: parseInt(file.size || '0', 10),
            modifiedTime: file.modifiedTime || new Date().toISOString(),
            mimeType: file.mimeType
        };
    }

    /**
     * Full scan of the linked folder.
     * Updates the local `useDriveStore` index.
     * This is the "heavy" operation.
     */
    static async scanAndIndex(): Promise<void> {
        const { linkedFolderId, setScannedFiles, setScanning } = useDriveStore.getState();

        if (!linkedFolderId) {
            logger.warn("No linked folder ID found.");
            return;
        }

        try {
            setScanning(true);
            logger.info("Starting full drive scan...");

            // Fetch all EPUBs
            const rawFiles = await DriveService.listFilesRecursive(linkedFolderId, 'application/epub+zip');

            // Map to index format
            const index = rawFiles.map(this.mapToDriveFileIndex);

            logger.info(`Scan complete. Indexed ${index.length} files.`);
            setScannedFiles(index);
        } catch (error) {
            logger.error("Failed to scan and index:", error);
            throw error;
        } finally {
            setScanning(false);
        }
    }

    /**
     * Checks for new EPUB files by comparing the Cloud Index against Local Library.
     * Returns a list of files that are in the Index but NOT in the Library.
     * 
     * If the index is empty, it triggers a scan first.
     */
    static async checkForNewFiles(): Promise<import('../../store/useDriveStore').DriveFileIndex[]> {
        let { index } = useDriveStore.getState();

        // If index is empty, force a scan
        if (index.length === 0) {
            await this.scanAndIndex();
            // Refetch state
            index = useDriveStore.getState().index;
        }

        const libraryBooks = useBookStore.getState().books;
        const libraryFilenames = new Set(Object.values(libraryBooks).map(b => b.sourceFilename));

        // Diff: In Cloud Index AND NOT in Local Library
        const newFiles = index.filter(f => !libraryFilenames.has(f.name));

        logger.info(`Diff logic: Found ${newFiles.length} new files available for import.`);

        return newFiles;
    }

    /**
     * Heuristic check: Should we sync?
     * Checks if the linked folder has been viewed more recently than the last scan.
     */
    static async shouldAutoSync(): Promise<boolean> {
        const { linkedFolderId, lastScanTime } = useDriveStore.getState();

        if (!linkedFolderId) return false;
        // If never scanned, we definitely need to sync
        if (!lastScanTime) return true;

        try {
            const metadata = await DriveService.getFolderMetadata(linkedFolderId);
            const viewedTime = metadata.viewedByMeTime ? new Date(metadata.viewedByMeTime).getTime() : 0;

            // If viewed time is more recent than last scan time, we should sync
            // Note: If viewedByMeTime is undefined (0), we won't sync based on this heuristic,
            // unless lastScanTime is also somehow 0 (which is handled above).
            return viewedTime > lastScanTime;
        } catch (error) {
            logger.warn("Failed to check folder metadata for auto-sync heuristic:", error);
            // Default to true on error to be safe
            return true;
        }
    }
}

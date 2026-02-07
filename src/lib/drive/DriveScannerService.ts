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
            return await DriveService.listFiles(linkedFolderId, 'application/epub+zip');
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
    static async importFile(fileId: string, fileName: string): Promise<void> {
        try {
            logger.info(`Downloading file: ${fileName} (${fileId})`);
            const blob = await DriveService.downloadFile(fileId);

            const file = new File([blob], fileName, { type: 'application/epub+zip' });

            logger.info(`Importing file to library: ${fileName}`);
            await useLibraryStore.getState().addBook(file);
        } catch (error) {
            logger.error(`Failed to import file ${fileName}:`, error);
            throw error;
        }
    }

    /**
     * Checks for new EPUB files in the linked folder.
     * Does NOT download them automatically.
     * @returns A list of new DriveFile objects that are not yet in the library.
     */
    static async checkForNewFiles(): Promise<DriveFile[]> {
        const driveFiles = await this.scanLinkedFolder();
        const libraryBooks = useBookStore.getState().books;
        const libraryFilenames = new Set(Object.values(libraryBooks).map(b => b.sourceFilename));

        const newFiles = driveFiles.filter(f => !libraryFilenames.has(f.name));

        logger.info(`Found ${driveFiles.length} files. ${newFiles.length} are new.`);

        return newFiles;
    }
}

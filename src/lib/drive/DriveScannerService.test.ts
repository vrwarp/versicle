import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DriveScannerService } from '../../lib/drive/DriveScannerService';
import { DriveService } from '../../lib/drive/DriveService';
import { useDriveStore } from '../../store/useDriveStore';
import { useBookStore } from '../../store/useBookStore';

// Mock dependencies
vi.mock('../../lib/drive/DriveService', () => ({
    DriveService: {
        listFiles: vi.fn(),
        downloadFile: vi.fn(),
    }
}));

describe('DriveScannerService', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        useDriveStore.getState().setLinkedFolder('folder-123', 'My Books');
        useBookStore.setState({ books: {} });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('checkForNewFiles', () => {
        it('returns all files if library is empty', async () => {
            const mockFiles = [
                { id: '1', name: 'Book1.epub', mimeType: 'application/epub+zip' },
                { id: '2', name: 'Book2.epub', mimeType: 'application/epub+zip' }
            ];
            vi.mocked(DriveService.listFiles).mockResolvedValue(mockFiles);

            const newFiles = await DriveScannerService.checkForNewFiles();

            expect(DriveService.listFiles).toHaveBeenCalledWith('folder-123', 'application/epub+zip');
            expect(newFiles).toHaveLength(2);
            expect(newFiles).toEqual(mockFiles);
        });

        it('filters out existing files', async () => {
            const mockFiles = [
                { id: '1', name: 'Book1.epub', mimeType: 'application/epub+zip' },
                { id: '2', name: 'Book2.epub', mimeType: 'application/epub+zip' }
            ];
            vi.mocked(DriveService.listFiles).mockResolvedValue(mockFiles);

            // Add Book1 to library
            useBookStore.setState({
                books: {
                    'book-1': {
                        bookId: 'book-1',
                        title: 'Book 1',
                        author: 'Author',
                        sourceFilename: 'Book1.epub',
                        addedAt: Date.now(),
                        lastInteraction: Date.now(),
                        status: 'unread',
                        tags: [],
                        rating: 0
                    }
                }
            });

            const newFiles = await DriveScannerService.checkForNewFiles();

            expect(newFiles).toHaveLength(1);
            expect(newFiles[0].name).toBe('Book2.epub');
        });

        it('returns empty array if no linked folder', async () => {
            useDriveStore.getState().clearLinkedFolder();

            const newFiles = await DriveScannerService.checkForNewFiles();

            expect(DriveService.listFiles).not.toHaveBeenCalled();
            expect(newFiles).toHaveLength(0);
        });
    });
});

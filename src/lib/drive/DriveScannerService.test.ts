
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { DriveScannerService } from './DriveScannerService';
import { useDriveStore } from '../../store/useDriveStore';
import { useBookStore } from '../../store/useBookStore';
import { DriveService } from './DriveService';

// Mock dependencies
vi.mock('../../store/useDriveStore', () => ({
    useDriveStore: {
        getState: vi.fn()
    }
}));

vi.mock('../../store/useBookStore', () => ({
    useBookStore: {
        getState: vi.fn()
    }
}));

vi.mock('./DriveService', () => ({
    DriveService: {
        listFiles: vi.fn(),
        listFilesRecursive: vi.fn(),
        downloadFile: vi.fn()
    }
}));

describe('DriveScannerService', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Setup default store mocks
        (useDriveStore.getState as unknown as Mock).mockReturnValue({
            linkedFolderId: 'folder-123',
            index: [],
            setScannedFiles: vi.fn(),
            setScanning: vi.fn(),
        });

        (useBookStore.getState as unknown as Mock).mockReturnValue({
            books: {}
        });
    });

    describe('scanAndIndex', () => {
        it('should fetch files from Drive and update the store', async () => {
            const mockFiles = [
                { id: '1', name: 'Book 1.epub', size: 1000, modifiedTime: '2023-01-01', mimeType: 'application/epub+zip' },
                { id: '2', name: 'Book 2.epub', size: 2000, modifiedTime: '2023-01-02', mimeType: 'application/epub+zip' }
            ];

            (DriveService.listFilesRecursive as unknown as Mock).mockResolvedValue(mockFiles);

            const setScannedFilesSpy = vi.fn();
            const setScanningSpy = vi.fn();

            (useDriveStore.getState as unknown as Mock).mockReturnValue({
                linkedFolderId: 'folder-123',
                setScannedFiles: setScannedFilesSpy,
                setScanning: setScanningSpy,
            });

            await DriveScannerService.scanAndIndex();

            expect(DriveService.listFilesRecursive).toHaveBeenCalledWith('folder-123', 'application/epub+zip');
            expect(setScanningSpy).toHaveBeenCalledWith(true);
            expect(setScannedFilesSpy).toHaveBeenCalledWith([
                { id: '1', name: 'Book 1.epub', size: 1000, modifiedTime: '2023-01-01', mimeType: 'application/epub+zip' },
                { id: '2', name: 'Book 2.epub', size: 2000, modifiedTime: '2023-01-02', mimeType: 'application/epub+zip' }
            ]);
            expect(setScanningSpy).toHaveBeenCalledWith(false);
        });

        it('should handle errors gracefully', async () => {
            (DriveService.listFilesRecursive as unknown as Mock).mockRejectedValue(new Error('API Error'));

            const setScanningSpy = vi.fn();
            (useDriveStore.getState as unknown as Mock).mockReturnValue({
                linkedFolderId: 'folder-123',
                setScannedFiles: vi.fn(),
                setScanning: setScanningSpy,
            });

            await expect(DriveScannerService.scanAndIndex()).rejects.toThrow('API Error');
            expect(setScanningSpy).toHaveBeenCalledWith(false);
        });

        it('should do nothing if no linked folder', async () => {
            (useDriveStore.getState as unknown as Mock).mockReturnValue({
                linkedFolderId: null,
                setScannedFiles: vi.fn(),
                setScanning: vi.fn(),
            });

            await DriveScannerService.scanAndIndex();

            expect(DriveService.listFilesRecursive).not.toHaveBeenCalled();
        });
    });

    describe('checkForNewFiles', () => {
        it('should return files present in Drive index but not in local library', async () => {
            const mockIndex = [
                { id: '1', name: 'Book 1.epub', size: 1000, modifiedTime: '', md5Checksum: '' },
                { id: '2', name: 'Book 2.epub', size: 2000, modifiedTime: '', md5Checksum: '' }, // New
                { id: '3', name: 'Book 3.epub', size: 3000, modifiedTime: '', md5Checksum: '' }  // New
            ];

            const mockLibrary = {
                'book-1': { id: 'book-1', title: 'Start', sourceFilename: 'Book 1.epub' }
            };

            (useDriveStore.getState as unknown as Mock).mockReturnValue({
                index: mockIndex,
                linkedFolderId: 'folder-123'
            });

            (useBookStore.getState as unknown as Mock).mockReturnValue({
                books: mockLibrary
            });

            // We mock scanAndIndex to prevent actual call if index was empty (not empty here)
            vi.spyOn(DriveScannerService, 'scanAndIndex').mockResolvedValue();

            const newFiles = await DriveScannerService.checkForNewFiles();

            expect(newFiles).toHaveLength(2);
            expect(newFiles.map(f => f.name)).toEqual(['Book 2.epub', 'Book 3.epub']);
        });

        it('should trigger scanAndIndex if index is empty', async () => {
            // First call returns empty index, scan triggers, second call returns populated index
            const setScannedFilesSpy = vi.fn();

            // Mock state to return empty index first, then populated?
            // Since checkForNewFiles calls getState() twice, we need to mock sequential returns or rely on the side effect of scanAndIndex updating the store.
            // But we mocked useDriveStore, so it won't update state automatically.

            // Easier: Just verify scanAndIndex is called.

            (useDriveStore.getState as unknown as Mock).mockReturnValue({
                index: [],
                linkedFolderId: 'folder-123',
                setScannedFiles: setScannedFilesSpy,
                setScanning: vi.fn()
            });

            const scanSpy = vi.spyOn(DriveScannerService, 'scanAndIndex').mockResolvedValue();

            await DriveScannerService.checkForNewFiles();

            expect(scanSpy).toHaveBeenCalled();
        });
    });
});

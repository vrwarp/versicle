
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDriveService } from '../lib/drive/MockDriveService';
import { DriveScannerService } from '../lib/drive/DriveScannerService';
import { useDriveStore } from '../store/useDriveStore';
import { useBookStore } from '../store/useBookStore';

// Mock the real DriveService with our functional mock
vi.mock('../lib/drive/DriveService', () => ({
    DriveService: {
        listFolders: (parentId?: string) => mockDriveService.listFolders(parentId),
        getFolderMetadata: (folderId: string) => mockDriveService.getFolderMetadata(folderId),
        listFiles: (parentId: string, mimeType?: string) => mockDriveService.listFiles(parentId, mimeType),
        listFilesRecursive: (parentId: string, mimeType?: string) => mockDriveService.listFilesRecursive(parentId, mimeType),
        downloadFile: (fileId: string) => mockDriveService.downloadFile(fileId),
    }
}));

// Mock DBService to prevent actual IndexedDB calls during import
vi.mock('../db/DBService', () => ({
    dbService: {
        addBook: vi.fn().mockResolvedValue({ bookId: 'mock-id', title: 'Mocked Title', author: 'Mocked Author', schemaVersion: '1.0' }),
        getBookStructure: vi.fn().mockResolvedValue({}),
        getContentAnalysis: vi.fn().mockResolvedValue({}),
        getBookMetadata: vi.fn().mockResolvedValue({}),
        getBookIdByFilename: vi.fn().mockResolvedValue(undefined),
        importBookWithId: vi.fn().mockResolvedValue({ bookId: 'mock-id', title: 'Mocked Title', author: 'Mocked Author', schemaVersion: '1.0' }),
        getOffloadedStatus: vi.fn().mockResolvedValue(new Map()),
    }
}));

// Mock extractBookMetadata
vi.mock('../lib/epub/epub-parser', () => ({
    extractBookMetadata: vi.fn().mockResolvedValue({
        title: 'Mocked Title',
        author: 'Mocked Author',
        coverUrl: null
    })
}));

describe('Google Drive Sync & Import E2E', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDriveService.reset();

        // Reset stores
        useDriveStore.setState({
            linkedFolderId: null,
            linkedFolderName: null,
            index: [],
            lastScanTime: null,
            isScanning: false
        });

        useBookStore.setState({
            books: {}
        });
    });

    // User Journey 1: Adding a folder to monitor
    it('User Journey: Add a folder to monitor', async () => {
        const folderId = 'folder-monitor-1';
        mockDriveService.addFolder(folderId, 'Audiobooks');

        // Simulating UI action: User selects a folder
        useDriveStore.getState().setLinkedFolder(folderId, 'Audiobooks');

        const state = useDriveStore.getState();
        expect(state.linkedFolderId).toBe(folderId);
        expect(state.linkedFolderName).toBe('Audiobooks');
    });

    // User Journey 2: Triggering syncing logic
    it('User Journey: Trigger syncing logic (manual and auto)', async () => {
        const folderId = 'folder-sync-1';
        mockDriveService.addFolder(folderId, 'Sync Folder');
        mockDriveService.addFile('file-1', 'Book A.epub', 'application/epub+zip', folderId, 'content');

        useDriveStore.getState().setLinkedFolder(folderId, 'Sync Folder');

        // Manual trigger via DriveScannerService
        await DriveScannerService.scanAndIndex();

        const index = useDriveStore.getState().index;
        expect(index).toHaveLength(1);
        expect(index[0].name).toBe('Book A.epub');
        expect(useDriveStore.getState().lastScanTime).toBeTypeOf('number');

        // Add another file and sync again
        mockDriveService.addFile('file-2', 'Book B.epub', 'application/epub+zip', folderId, 'content');
        await DriveScannerService.scanAndIndex();

        const updatedIndex = useDriveStore.getState().index;
        expect(updatedIndex).toHaveLength(2);
    });

    // User Journey 3a: Import from scratch
    it('User Journey: Import matching file from scratch', async () => {
        const folderId = 'folder-import-1';
        const fileId = 'file-new-1';
        // Setup Drive
        mockDriveService.addFolder(folderId, 'Import Folder');
        mockDriveService.addFile(fileId, 'New Adventure.epub', 'application/epub+zip', folderId, 'epub content');

        // Setup Link & Scan
        useDriveStore.getState().setLinkedFolder(folderId, 'Import Folder');
        await DriveScannerService.scanAndIndex();

        // Verify it's in the index
        const indexFile = useDriveStore.getState().index.find(f => f.id === fileId);
        expect(indexFile).toBeDefined();

        // Perform Import
        await DriveScannerService.importFile(fileId, 'New Adventure.epub');

        const { dbService } = await import('../db/DBService');
        // Expect addBook to be called
        expect(dbService.addBook).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'New Adventure.epub' }),
            expect.anything(),
            expect.anything()
        );
    });

    // User Journey 3b: Import/Restore "Ghost Book"
    it('User Journey: Restore a ghost book (missing content)', async () => {
        const folderId = 'folder-ghost-1';
        const fileId = 'file-ghost-1';
        const bookTitle = 'Ghost Story.epub';
        const ghostBookId = 'ghost-book-id-123';

        // 1. Setup Drive with the file
        mockDriveService.addFolder(folderId, 'Ghost Folder');
        mockDriveService.addFile(fileId, bookTitle, 'application/epub+zip', folderId, 'spooky content');

        useDriveStore.getState().setLinkedFolder(folderId, 'Ghost Folder');
        await DriveScannerService.scanAndIndex();

        // 2. Simulate Ghost Book scenario:
        // Populate useBookStore with the "Ghost Book"
        // This simulates a book that exists in metadata but the file availability isn't checked here (that's DB level)
        useBookStore.setState({
            books: {
                [ghostBookId]: {
                    bookId: ghostBookId,
                    title: 'Ghost Story',
                    author: 'Unknown',
                    sourceFilename: bookTitle, // Filename matches
                    addedAt: Date.now(),
                    lastInteraction: Date.now(),
                    status: 'unread',
                    tags: [],
                    rating: 0
                }
            }
        });

        // 3. User clicks "Restore from Cloud" in the dialog
        // This matches logic in ContentMissingDialog where it finds the file and calls importFile with overwrite: true
        const match = useDriveStore.getState().findFile(bookTitle, bookTitle);
        expect(match).toBeDefined();

        await DriveScannerService.importFile(match!.id, match!.name, { overwrite: true });

        const { dbService } = await import('../db/DBService');

        // Since the book exists in store (matched by filename), and overwrite is true,
        // useLibraryStore calls dbService.importBookWithId to preserve the ID
        expect(dbService.importBookWithId).toHaveBeenCalledWith(
            ghostBookId,
            expect.objectContaining({ name: bookTitle }),
            expect.anything(),
            expect.anything()
        );
    });

    // Edge Case: Download Error
    it('should handle download errors gracefully during import', async () => {
        const folderId = 'folder-error';
        const fileId = 'file-error';
        mockDriveService.addFolder(folderId, 'My Books');

        // Add file to index but NOT to content map (or make download fail)
        mockDriveService.addFile(fileId, 'Corrupt.epub', 'application/epub+zip', folderId, 'content');

        useDriveStore.getState().setLinkedFolder(folderId, 'My Books');
        await DriveScannerService.scanAndIndex();

        // Sabotage the mock
        mockDriveService.deleteFileContent(fileId);

        await expect(DriveScannerService.importFile(fileId, 'Corrupt.epub'))
            .rejects.toThrow('File content not found');
    });
});

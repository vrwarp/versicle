
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockDriveService } from '@test/harness/MockDriveService';
import {
    DriveLibrarySync,
    getDriveLibrarySync,
    setDriveLibrarySync,
    resetDriveHoldersForTesting,
} from '@domains/google';
import { useDriveStore } from '@store/useDriveStore';
import { useBookStore } from '@store/useBookStore';

// Phase 7: Drive imports flow through the library port the composition root
// wires to the ImportOrchestrator (app/google/wireGoogle.ts). The port is
// captured here so the journeys assert the CONTRACT the scanner drives.
const mockLibraryAddBook = vi.fn<(file: File, options?: { overwrite?: boolean }) => Promise<unknown>>()
    .mockResolvedValue(undefined);

// Phase 7/P9: the journeys drive the composed DriveLibrarySync (the
// DriveScannerService facade is deleted) — wire one here over the
// functional MockDriveService (the harness double is DriveClient-shaped)
// + the REAL stores.
function wireMockDriveSync(): void {
    resetDriveHoldersForTesting();
    setDriveLibrarySync(new DriveLibrarySync({
        client: {
            listFilesRecursive: (parentId, mimeType) => mockDriveService.listFilesRecursive(parentId, mimeType),
            getFolderMetadata: (folderId) => mockDriveService.getFolderMetadata(folderId),
            downloadFile: (fileId) => mockDriveService.downloadFile(fileId),
        },
        driveIndex: {
            getLinkedFolderId: () => useDriveStore.getState().linkedFolderId,
            getLastScanTime: () => useDriveStore.getState().lastScanTime,
            getIndex: () => useDriveStore.getState().index,
            setScanning: (isScanning) => useDriveStore.getState().setScanning(isScanning),
            setScannedFiles: (files) => useDriveStore.getState().setScannedFiles(files),
        },
        library: {
            addBook: (file, options) => mockLibraryAddBook(file, options),
            getLibraryFilenames: () =>
                new Set(Object.values(useBookStore.getState().books).map((b) => b.sourceFilename)),
        },
        hasConnectedBefore: () => true,
    }));
}

// Mock the DB layer to prevent actual IndexedDB calls during import
vi.mock('@data/repos/bookContent', () => ({
    bookContent: {
        getBookStructure: vi.fn().mockResolvedValue({}),
        getOffloadedStatus: vi.fn().mockResolvedValue(new Map()),
        getAvailableResourceIds: vi.fn().mockResolvedValue(new Set()),
    }
}));

vi.mock('@app/repositories/BookRepository', () => ({
    bookRepository: {
        getBookMetadata: vi.fn().mockResolvedValue({}),
        getBookMetadataBulk: vi.fn().mockResolvedValue([]),
        getBookIdByFilename: vi.fn().mockReturnValue(undefined),
        deleteBook: vi.fn().mockResolvedValue(undefined),
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
        vi.spyOn(console, 'info').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.clearAllMocks();
        mockDriveService.reset();
        wireMockDriveSync();

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

    afterEach(() => {
        vi.restoreAllMocks();
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

        // Manual trigger via the wired DriveLibrarySync
        await getDriveLibrarySync().scanAndIndex();

        const index = useDriveStore.getState().index;
        expect(index).toHaveLength(1);
        expect(index[0].name).toBe('Book A.epub');
        expect(useDriveStore.getState().lastScanTime).toBeTypeOf('number');

        // Add another file and sync again
        mockDriveService.addFile('file-2', 'Book B.epub', 'application/epub+zip', folderId, 'content');
        await getDriveLibrarySync().scanAndIndex();

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
        await getDriveLibrarySync().scanAndIndex();

        // Verify it's in the index
        const indexFile = useDriveStore.getState().index.find(f => f.id === fileId);
        expect(indexFile).toBeDefined();

        // Perform Import
        await getDriveLibrarySync().importFile(fileId, 'New Adventure.epub', undefined, { interactive: true });

        // Expect the library port (the orchestrator in production) to receive the file.
        expect(mockLibraryAddBook).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'New Adventure.epub' }),
            undefined
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
        await getDriveLibrarySync().scanAndIndex();

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

        await getDriveLibrarySync().importFile(match!.id, match!.name, { overwrite: true }, { interactive: true });

        // Since the book exists in store (matched by filename), and overwrite is
        // true, the scanner asks the library port to replace in place — the
        // orchestrator's replace flow preserves the existing id (ghostBookId).
        expect(mockLibraryAddBook).toHaveBeenCalledWith(
            expect.objectContaining({ name: bookTitle }),
            expect.objectContaining({ overwrite: true })
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
        await getDriveLibrarySync().scanAndIndex();

        // Sabotage the mock
        mockDriveService.deleteFileContent(fileId);

        await expect(getDriveLibrarySync().importFile(fileId, 'Corrupt.epub', undefined, { interactive: true }))
            .rejects.toThrow('File content not found');
    });
});

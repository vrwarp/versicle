import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MaintenanceService } from './MaintenanceService';
import { bookContent } from '@data/repos/bookContent';

// --- Mocks ---

const mockUpdateBook = vi.fn();
const mockGetState = vi.fn();

vi.mock('@store/useBookStore', () => ({
    useBookStore: {
        getState: () => mockGetState(),
        subscribe: vi.fn()
    },
}));

vi.mock('@store/useTTSStore', () => ({
    useTTSStore: {
        getState: () => ({
            sentenceStarters: [],
            sanitizationEnabled: false,
        }),
    },
}));

const mockGetBookFile = vi.fn();
const mockImportBookWithId = vi.fn();

vi.mock('@data/repos/bookContent', () => ({
    bookContent: {
        getBookFile: (...args: unknown[]) => mockGetBookFile(...args),
        ingest: vi.fn(),
        listManifests: vi.fn(),
        putManifests: vi.fn(),
        scanOrphans: vi.fn(),
        pruneOrphans: vi.fn(),
    },
}));

vi.mock('@data/repos/searchText', () => ({
    searchTextRepo: { put: vi.fn() },
}));

// Phase 7: BookImportService died — regeneration runs extract → retarget →
// overwrite ingest. The legacy mock seam is preserved by adapting its
// {title, author, coverPalette} payloads into extraction shapes.
vi.mock('@domains/library', () => ({
    extractBook: async (...args: unknown[]) => {
        const manifest = await mockImportBookWithId(...args);
        return {
            manifest,
            resource: { bookId: 'pending', epubBlob: new Blob(['x']) },
            structure: { bookId: 'pending', toc: [], spineItems: [] },
            ttsContentBatches: [],
            tableBatches: [],
            searchText: { extractionVersion: 3, sections: [] },
        };
    },
    retargetExtraction: (extraction: unknown) => extraction,
}));

describe('MaintenanceService', () => {
    let service: MaintenanceService;
    const onProgress = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        service = new MaintenanceService();
    });

    /**
     * Helper to set up useBookStore mock with a single book.
     */
    function setupBookStore(bookId: string, bookData: Record<string, unknown>) {
        mockGetState.mockReturnValue({
            books: { [bookId]: bookData },
            updateBook: mockUpdateBook,
        });
    }

    describe('regenerateAllMetadata', () => {
        it('should use File.name from the stored blob as sourceFilename', async () => {
            setupBookStore('book-1', {
                title: 'Old Title',
                author: 'Old Author',
                sourceFilename: 'old-name.epub',
            });

            // Return a File (which has .name) from getBookFile
            const storedFile = new File([new ArrayBuffer(10)], 'real-filename.epub', { type: 'application/epub+zip' });
            mockGetBookFile.mockResolvedValue(storedFile);

            mockImportBookWithId.mockResolvedValue({
                title: 'New Title',
                author: 'New Author',
                coverPalette: [1, 2, 3, 4, 5],
            });

            await service.regenerateAllMetadata(onProgress);

            // File.name from the blob takes priority
            expect(mockUpdateBook).toHaveBeenCalledWith('book-1', expect.objectContaining({
                sourceFilename: 'real-filename.epub',
            }));
        });

        it('should fall back to existing sourceFilename when blob is not a File', async () => {
            setupBookStore('book-1', {
                title: 'Old Title',
                author: 'Old Author',
                sourceFilename: 'inventory-name.epub',
            });

            // Return a plain ArrayBuffer (no .name property)
            mockGetBookFile.mockResolvedValue(new ArrayBuffer(10));

            mockImportBookWithId.mockResolvedValue({
                title: 'New Title',
                author: 'New Author',
                coverPalette: [1, 2, 3, 4, 5],
            });

            await service.regenerateAllMetadata(onProgress);

            // Falls back to the existing sourceFilename from inventory
            expect(mockUpdateBook).toHaveBeenCalledWith('book-1', expect.objectContaining({
                sourceFilename: 'inventory-name.epub',
            }));
        });

        it('should construct sourceFilename from title and author when no filename is available', async () => {
            setupBookStore('book-1', {
                title: 'Old Title',
                author: 'Old Author',
                // No sourceFilename set
            });

            // Return a plain ArrayBuffer (no .name)
            mockGetBookFile.mockResolvedValue(new ArrayBuffer(10));

            mockImportBookWithId.mockResolvedValue({
                title: 'Great Expectations',
                author: 'Charles Dickens',
                coverPalette: [1, 2, 3, 4, 5],
            });

            await service.regenerateAllMetadata(onProgress);

            // Constructs filename from manifest metadata
            expect(mockUpdateBook).toHaveBeenCalledWith('book-1', expect.objectContaining({
                sourceFilename: 'Great Expectations - Charles Dickens.epub',
            }));
        });

        it('should also update title, author, and coverPalette from manifest', async () => {
            setupBookStore('book-1', {
                title: 'Old Title',
                author: 'Old Author',
                sourceFilename: 'book.epub',
            });

            mockGetBookFile.mockResolvedValue(new ArrayBuffer(10));

            mockImportBookWithId.mockResolvedValue({
                title: 'Updated Title',
                author: 'Updated Author',
                coverPalette: [10, 20, 30, 40, 50],
            });

            await service.regenerateAllMetadata(onProgress);

            expect(mockUpdateBook).toHaveBeenCalledWith('book-1', {
                title: 'Updated Title',
                author: 'Updated Author',
                coverPalette: [10, 20, 30, 40, 50],
                sourceFilename: 'Updated Title - Updated Author.epub',
            });
        });

        it('should skip books with no stored file', async () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            setupBookStore('book-1', {
                title: 'Ghost Book',
                author: 'Nobody',
            });

            mockGetBookFile.mockResolvedValue(undefined);

            await service.regenerateAllMetadata(onProgress);

            expect(mockImportBookWithId).not.toHaveBeenCalled();
            expect(mockUpdateBook).not.toHaveBeenCalled();
            consoleWarnSpy.mockRestore();
        });

        it('should continue processing remaining books if one fails', async () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            mockGetState.mockReturnValue({
                books: {
                    'book-1': { title: 'Book 1', author: 'A', sourceFilename: 'b1.epub' },
                    'book-2': { title: 'Book 2', author: 'B', sourceFilename: 'b2.epub' },
                },
                updateBook: mockUpdateBook,
            });

            mockGetBookFile.mockResolvedValue(new ArrayBuffer(10));
            mockImportBookWithId
                .mockRejectedValueOnce(new Error('Ingestion failed'))
                .mockResolvedValueOnce({
                    title: 'Book 2',
                    author: 'B',
                    coverPalette: [1, 2, 3, 4, 5],
                });

            await service.regenerateAllMetadata(onProgress);

            // First book failed, second succeeded
            expect(mockUpdateBook).toHaveBeenCalledTimes(1);
            expect(mockUpdateBook).toHaveBeenCalledWith('book-2', expect.objectContaining({
                sourceFilename: 'b2.epub',
            }));
            consoleErrorSpy.mockRestore();
        });
    });

    describe('regression: corrupt {} coverBlob repair (pre-v3 backup restores)', () => {
        const REPAIR_FLAG = 'versicle_cover_blob_repair_v1';

        function setupDb(manifests: Record<string, unknown>[]) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            vi.mocked(bookContent.listManifests).mockResolvedValue(manifests as any);
            return {
                putMock: vi.mocked(bookContent.putManifests),
                listMock: vi.mocked(bookContent.listManifests),
            };
        }

        beforeEach(() => {
            localStorage.removeItem(REPAIR_FLAG);
        });

        it('strips non-binary coverBlob values and leaves healthy rows alone', async () => {
            const healthyCover = new ArrayBuffer(4);
            const { putMock } = setupDb([
                { bookId: 'corrupt', title: 'Corrupt', coverBlob: {} },
                { bookId: 'healthy-buffer', title: 'Healthy', coverBlob: healthyCover },
                { bookId: 'healthy-blob', title: 'Healthy Blob', coverBlob: new Blob([new Uint8Array([1])]) },
                { bookId: 'no-cover', title: 'No Cover' },
            ]);

            const repaired = await service.repairCorruptCoverBlobs();

            expect(repaired).toBe(1);
            expect(putMock).toHaveBeenCalledTimes(1);
            const writtenRows = putMock.mock.calls[0][0];
            expect(writtenRows).toHaveLength(1);
            expect(writtenRows[0].bookId).toBe('corrupt');
            expect('coverBlob' in writtenRows[0]).toBe(false);
        });

        it('is a no-op (no write) when nothing is corrupt', async () => {
            const { putMock } = setupDb([
                { bookId: 'healthy', title: 'Healthy', coverBlob: new ArrayBuffer(4) },
                { bookId: 'no-cover', title: 'No Cover' },
            ]);

            const repaired = await service.repairCorruptCoverBlobs();

            expect(repaired).toBe(0);
            expect(putMock).not.toHaveBeenCalled();
        });

        it('repairCorruptCoverBlobsOnce only scans once per device', async () => {
            const { listMock } = setupDb([
                { bookId: 'corrupt', title: 'Corrupt', coverBlob: {} },
            ]);

            await service.repairCorruptCoverBlobsOnce();
            await service.repairCorruptCoverBlobsOnce();

            expect(listMock).toHaveBeenCalledTimes(1);
            expect(localStorage.getItem(REPAIR_FLAG)).toBe('1');
        });
    });
});

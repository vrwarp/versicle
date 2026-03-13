import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MaintenanceService } from './MaintenanceService';

// --- Mocks ---

const mockUpdateBook = vi.fn();
const mockGetState = vi.fn();

vi.mock('../store/useBookStore', () => ({
    useBookStore: {
        getState: () => mockGetState(),
    },
}));

vi.mock('../store/useTTSStore', () => ({
    useTTSStore: {
        getState: () => ({
            sentenceStarters: [],
            sanitizationEnabled: false,
        }),
    },
}));

const mockGetBookFile = vi.fn();
const mockImportBookWithId = vi.fn();

vi.mock('../db/DBService', () => ({
    dbService: {
        getBookFile: (...args: unknown[]) => mockGetBookFile(...args),
        importBookWithId: (...args: unknown[]) => mockImportBookWithId(...args),
    },
}));

vi.mock('../db/db', () => ({
    getDB: vi.fn(),
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
                sourceFilename: 'book.epub',
            });
        });

        it('should skip books with no stored file', async () => {
            setupBookStore('book-1', {
                title: 'Ghost Book',
                author: 'Nobody',
            });

            mockGetBookFile.mockResolvedValue(undefined);

            await service.regenerateAllMetadata(onProgress);

            expect(mockImportBookWithId).not.toHaveBeenCalled();
            expect(mockUpdateBook).not.toHaveBeenCalled();
        });

        it('should continue processing remaining books if one fails', async () => {
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
        });
    });
});

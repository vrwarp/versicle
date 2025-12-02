import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DBService } from './DBService';
import { StorageFullError } from '../types/errors';

// Mocks need to be hoisted or defined inside vi.mock factory if checking for reference error
// But vitest hoists vi.mock automatically.
// The issue is using 'mockDb' inside vi.mock factory which is hoisted above mockDb declaration.

const mockGet = vi.fn();
const mockPut = vi.fn();
const mockDelete = vi.fn();
const mockGetAll = vi.fn();
const mockGetAllKeys = vi.fn();
const mockAdd = vi.fn();
const mockCount = vi.fn();
const mockGetAllKeysFromIndex = vi.fn();

const mockTransaction = vi.fn().mockReturnValue({
    objectStore: (storeName: string) => ({
        get: mockGet,
        put: mockPut,
        delete: mockDelete,
        add: mockAdd,
        getAll: mockGetAll,
        index: (indexName: string) => ({
             getAllKeys: mockGetAllKeys
        })
    }),
    store: {
        delete: mockDelete,
        get: mockGet,
        put: mockPut
    },
    done: Promise.resolve()
});

// We can define the mock object inside the factory or use vi.hoisted
const { mockDb } = vi.hoisted(() => {
    return {
        mockDb: {
            get: vi.fn(),
            put: vi.fn(),
            delete: vi.fn(),
            getAll: vi.fn(),
            getAllKeysFromIndex: vi.fn(),
            transaction: vi.fn(),
            count: vi.fn()
        }
    };
});

// Re-assign the hoisted mocks to our local variables for easier assertions
mockDb.get.mockImplementation(mockGet);
mockDb.put.mockImplementation(mockPut);
mockDb.delete.mockImplementation(mockDelete);
mockDb.getAll.mockImplementation(mockGetAll);
mockDb.getAllKeysFromIndex.mockImplementation(mockGetAllKeysFromIndex);
mockDb.transaction.mockImplementation(mockTransaction);
mockDb.count.mockImplementation(mockCount);


vi.mock('./db', () => ({
    getDB: vi.fn().mockResolvedValue(mockDb)
}));

describe('DBService', () => {
    let dbService: DBService;

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset singleton instance if possible or just get it
        // Since it's a singleton, we need to be careful.
        // For testing, accessing the instance is fine if we reset mocks.
        dbService = DBService.getInstance();
    });

    it('should be a singleton', () => {
        const instance1 = DBService.getInstance();
        const instance2 = DBService.getInstance();
        expect(instance1).toBe(instance2);
    });

    describe('getLibrary', () => {
        it('should return all books', async () => {
            const mockBooks = [{ id: '1', title: 'Test Book' }];
            mockGetAll.mockResolvedValue(mockBooks);

            const result = await dbService.getLibrary();
            expect(result).toEqual(mockBooks);
            expect(mockGetAll).toHaveBeenCalledWith('books');
        });
    });

    describe('getBook', () => {
        it('should return book metadata and file', async () => {
            const mockMetadata = { id: '1', title: 'Test' };
            const mockFile = new ArrayBuffer(8);
            mockGet.mockImplementation((store, key) => {
                if (store === 'books') return Promise.resolve(mockMetadata);
                if (store === 'files') return Promise.resolve(mockFile);
                return Promise.resolve(undefined);
            });

            const result = await dbService.getBook('1');
            expect(result).toEqual({ metadata: mockMetadata, arrayBuffer: mockFile });
        });

        it('should return null if book not found', async () => {
            mockGet.mockResolvedValue(null);
            const result = await dbService.getBook('1');
            expect(result).toBeNull();
        });
    });

    describe('saveProgress', () => {
        it('should debounce progress updates and ensure last write wins', async () => {
            vi.useFakeTimers();
            const bookId = '1';
            const cfi = 'epubcfi(/6/2!/4/1:0)';
            const progress = 0.5;

            mockGet.mockResolvedValue({ id: bookId, progress: 0 });

            // Call multiple times
            const p1 = dbService.saveProgress(bookId, cfi, progress);
            const p2 = dbService.saveProgress(bookId, cfi, progress + 0.1);
            const p3 = dbService.saveProgress(bookId, cfi, progress + 0.2);

            expect(mockTransaction).not.toHaveBeenCalled();

            vi.advanceTimersByTime(500); // Advance timer to trigger debounce

            // Wait for promises to resolve
            await Promise.all([p1, p2, p3]);

            // Only one transaction should be initiated
            expect(mockTransaction).toHaveBeenCalledTimes(1);
            // The put should be with the latest value (from p3)
            expect(mockPut).toHaveBeenCalledWith(expect.objectContaining({
                progress: progress + 0.2
            }));

            vi.useRealTimers();
        });
    });

    describe('cleanupCache', () => {
        it('should remove oldest entries if cache is full', async () => {
             mockCount.mockResolvedValue(600);
             const mockKeys = Array.from({length: 600}, (_, i) => `key-${i}`);
             mockGetAllKeysFromIndex.mockResolvedValue(mockKeys);

             await dbService.cleanupCache();

             expect(mockTransaction).toHaveBeenCalledWith('tts_cache', 'readwrite');
             // Should delete 100 entries (600 - 500)
             expect(mockDelete).toHaveBeenCalledTimes(100);
        });

        it('should do nothing if cache is under limit', async () => {
            mockCount.mockResolvedValue(400);
            await dbService.cleanupCache();
            expect(mockTransaction).not.toHaveBeenCalled();
        });
    });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dbService, PersistenceMode } from './DBService';
import { crdtService } from '../lib/crdt/CRDTService';
import { getDB } from './db';

// Mock dependencies
vi.mock('./db', () => ({
    getDB: vi.fn()
}));

vi.mock('../lib/crdt/CRDTService', () => {
    const maps = new Map();
    const mockBooksMap = {
        get: vi.fn((id) => maps.get(id)),
        set: vi.fn((key, val) => {}),
        delete: vi.fn(),
        forEach: vi.fn(),
    };

    // Y.Map.get/set behavior simulation for sub-maps
    const books = {
        get: vi.fn((id) => {
            if (!maps.has(id)) maps.set(id, { set: vi.fn(), delete: vi.fn(), get: vi.fn() });
            return maps.get(id);
        }),
        set: vi.fn((id, val) => maps.set(id, val)),
        delete: vi.fn((id) => maps.delete(id)),
        has: vi.fn((id) => maps.has(id)),
    };

    return {
        crdtService: {
            books: books,
            history: {
                get: vi.fn(),
                set: vi.fn(),
                delete: vi.fn(),
            },
            waitForReady: vi.fn().mockResolvedValue(undefined),
            doc: {
                transact: (cb: any) => cb()
            }
        }
    };
});

describe('DBService Persistence Shunt', () => {
    let mockDB: any;
    let mockStore: any;
    let mockTx: any;

    beforeEach(() => {
        mockStore = {
            get: vi.fn(),
            put: vi.fn(),
            delete: vi.fn(),
            getAll: vi.fn(),
            index: vi.fn().mockReturnValue({ openCursor: vi.fn().mockResolvedValue(null) }) // Mock index/cursor for cleanup
        };
        mockTx = {
            objectStore: vi.fn().mockReturnValue(mockStore),
            done: Promise.resolve(),
        };
        mockDB = {
            transaction: vi.fn().mockReturnValue(mockTx),
            get: vi.fn(),
            getAll: vi.fn(),
        };
        (getDB as any).mockResolvedValue(mockDB);

        // Reset DBService mode
        dbService.mode = 'legacy';
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('updateBookMetadata', () => {
        it('should write only to DB in legacy mode', async () => {
            dbService.mode = 'legacy';
            mockStore.get.mockResolvedValue({ id: '1', title: 'Old' });

            await dbService.updateBookMetadata('1', { title: 'New' });

            expect(mockStore.put).toHaveBeenCalledWith({ id: '1', title: 'New' });
            expect(crdtService.books.get).not.toHaveBeenCalled();
        });

        it('should write to both DB and CRDT in shadow mode', async () => {
            dbService.mode = 'shadow';
            mockStore.get.mockResolvedValue({ id: '1', title: 'Old' });
            const mockYMap = { set: vi.fn() };
            (crdtService.books.get as any).mockReturnValue(mockYMap);

            await dbService.updateBookMetadata('1', { title: 'New' });

            expect(mockStore.put).toHaveBeenCalledWith({ id: '1', title: 'New' });
            expect(crdtService.books.get).toHaveBeenCalledWith('1');
            expect(mockYMap.set).toHaveBeenCalledWith('title', 'New');
        });

        it('should write only to CRDT in crdt mode', async () => {
            dbService.mode = 'crdt';
            const mockYMap = { set: vi.fn() };
            (crdtService.books.get as any).mockReturnValue(mockYMap);

            await dbService.updateBookMetadata('1', { title: 'New' });

            expect(mockStore.put).not.toHaveBeenCalled(); // No DB write (except setup if any)
            expect(mockDB.transaction).not.toHaveBeenCalled();
            expect(mockYMap.set).toHaveBeenCalledWith('title', 'New');
        });
    });

    describe('deleteBook', () => {
        it('should clean up Heavy Layer (files) even in crdt mode', async () => {
             dbService.mode = 'crdt';

             await dbService.deleteBook('1');

             // Check that files store was accessed for deletion
             expect(mockTx.objectStore).toHaveBeenCalledWith('files');
             expect(mockStore.delete).toHaveBeenCalledWith('1');

             // Check CRDT deletion
             expect(crdtService.books.delete).toHaveBeenCalledWith('1');
        });
    });
});

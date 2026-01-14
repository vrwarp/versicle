import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { migrateToYjs } from './YjsMigration';
import { dbService } from '../../db/DBService';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useAnnotationStore } from '../../store/useAnnotationStore';
import { useReadingStateStore } from '../../store/useReadingStateStore';

// Mock dependencies
vi.mock('../../store/yjs-provider', () => {
    const doc = new Y.Doc();
    return {
        yDoc: doc,
        waitForYjsSync: vi.fn().mockResolvedValue(undefined)
    };
});

vi.mock('../../db/DBService', () => ({
    dbService: {
        getAllInventoryItems: vi.fn(),
        getDB: vi.fn()
    }
}));

vi.mock('../../db/db', () => ({
    getDB: vi.fn()
}));

// Mock stores
vi.mock('../../store/useLibraryStore', () => ({
    useLibraryStore: {
        getState: vi.fn(),
        setState: vi.fn()
    }
}));

vi.mock('../../store/useAnnotationStore', () => ({
    useAnnotationStore: {
        getState: vi.fn(),
        setState: vi.fn()
    }
}));

vi.mock('../../store/useReadingStateStore', () => ({
    useReadingStateStore: {
        getState: vi.fn(),
        setState: vi.fn()
    }
}));

describe('YjsMigration', () => {
    let yDoc: Y.Doc;

    beforeEach(async () => {
        vi.clearAllMocks();

        // Reset YDoc
        const provider = await import('../../store/yjs-provider');
        yDoc = provider.yDoc;
        yDoc.getMap('preferences').clear();
        yDoc.getMap('library').clear();

        // Mock getDB to return a mock DB object with getAll
        const dbMock = {
            getAll: vi.fn().mockImplementation((storeName) => {
                if (storeName === 'user_annotations') return Promise.resolve([]);
                if (storeName === 'user_progress') return Promise.resolve([]);
                return Promise.resolve([]);
            })
        };

        const { getDB } = await import('../../db/db');
        (getDB as any).mockResolvedValue(dbMock);
    });

    it('should run migration when Yjs is empty and legacy data exists', async () => {
        // Setup legacy data
        const mockInventory = [
            { bookId: 'book1', title: 'Book 1', addedAt: 1000, tags: ['tag1'] }
        ];
        (dbService.getAllInventoryItems as any).mockResolvedValue(mockInventory);

        // Run migration
        await migrateToYjs();

        // Assert stores called
        expect(useLibraryStore.setState).toHaveBeenCalledWith(expect.any(Function));

        // Extract the state update function passed to setState and verify logic
        const updateFn = (useLibraryStore.setState as any).mock.calls[0][0];
        const newState = updateFn({ books: {} }); // Mock existing state

        expect(newState.books['book1']).toBeDefined();
        expect(newState.books['book1'].title).toBe('Book 1');
        expect(newState.books['book1'].tags).toContain('tag1');

        // Assert flag set
        expect(yDoc.getMap('preferences').get('migration_complete')).toBe(true);
    });

    it('should skip migration if already marked complete', async () => {
        yDoc.getMap('preferences').set('migration_complete', true);

        await migrateToYjs();

        expect(dbService.getAllInventoryItems).not.toHaveBeenCalled();
        expect(useLibraryStore.setState).not.toHaveBeenCalled();
    });

    it('should skip migration if Yjs has existing data (sync case)', async () => {
        yDoc.getMap('library').set('book1', { title: 'Existing Book' });

        await migrateToYjs();

        // Should NOT read from DB
        expect(dbService.getAllInventoryItems).not.toHaveBeenCalled();

        // Should set flag
        expect(yDoc.getMap('preferences').get('migration_complete')).toBe(true);
    });

    it('should handle errors gracefully', async () => {
        (dbService.getAllInventoryItems as any).mockRejectedValue(new Error('DB Error'));

        await expect(migrateToYjs()).rejects.toThrow('DB Error');

        // Flag should NOT be set
        expect(yDoc.getMap('preferences').get('migration_complete')).toBeUndefined();
    });
});

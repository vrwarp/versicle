import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { migrateToYjs } from './YjsMigration';
import { dbService } from '../../db/DBService';
import { useReadingStateStore } from '../../store/useReadingStateStore';
import { useReadingListStore } from '../../store/useReadingListStore';
import { usePreferencesStore } from '../../store/usePreferencesStore';

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
vi.mock('../../store/useLibraryStore', () => {
    const mockStore = {
        getState: vi.fn(),
        setState: vi.fn()
    };
    return {
        useLibraryStore: mockStore,
        useBookStore: mockStore // Both use the same mock for now or separate ones if needed
    };
});

vi.mock('../../store/useAnnotationStore', () => ({
    useAnnotationStore: {
        getState: vi.fn(),
        setState: vi.fn()
    }
}));

vi.mock('../../store/useReadingStateStore', () => ({
    useReadingStateStore: {
        getState: vi.fn().mockReturnValue({ progress: {} }),
        setState: vi.fn()
    }
}));

vi.mock('../../store/useReadingListStore', () => ({
    useReadingListStore: {
        getState: vi.fn(),
        setState: vi.fn()
    }
}));

vi.mock('../../store/usePreferencesStore', () => ({
    usePreferencesStore: {
        getState: vi.fn(),
        setState: vi.fn()
    }
}));

vi.mock('../device-id', () => ({
    getDeviceId: vi.fn().mockReturnValue('test-device')
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
            objectStoreNames: {
                contains: vi.fn().mockReturnValue(true)
            },
            getAll: vi.fn().mockImplementation((storeName) => {
                if (storeName === 'user_annotations') return Promise.resolve([]);
                if (storeName === 'user_progress') return Promise.resolve([]);
                if (storeName === 'user_reading_list') return Promise.resolve([]);
                return Promise.resolve([]);
            }),
            transaction: vi.fn().mockReturnValue({
                objectStore: vi.fn().mockReturnValue({
                    getAll: vi.fn().mockResolvedValue([]),
                    getAllKeys: vi.fn().mockResolvedValue([])
                }),
                done: Promise.resolve()
            })
        };

        const { getDB } = await import('../../db/db');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (getDB as any).mockResolvedValue(dbMock);
    });

    it('should run migration when Yjs is empty and legacy data exists', async () => {
        // Setup legacy data
        const mockInventory = [
            { bookId: 'book1', title: 'Book 1', addedAt: 1000, tags: ['tag1'] }
        ];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getAllInventoryItems as any).mockResolvedValue(mockInventory);

        // Run migration
        await migrateToYjs();

        // Assert stores called
        const { useBookStore } = await import('../../store/useLibraryStore');
        expect(useBookStore.setState).toHaveBeenCalledWith(expect.any(Function));

        // Extract the state update function passed to setState and verify logic
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updateFn = (useBookStore.setState as any).mock.calls[0][0];
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

        const { useBookStore } = await import('../../store/useLibraryStore');
        expect(dbService.getAllInventoryItems).not.toHaveBeenCalled();
        expect(useBookStore.setState).not.toHaveBeenCalled();
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getAllInventoryItems as any).mockRejectedValue(new Error('DB Error'));

        await expect(migrateToYjs()).rejects.toThrow('DB Error');

        // Flag should NOT be set
        expect(yDoc.getMap('preferences').get('migration_complete')).toBeUndefined();
    });

    it('should migrate reading list and apply progress fallback', async () => {
        // Setup legacy data
        const mockInventory = [
            { bookId: 'book_legacy', title: 'Legacy Book', addedAt: 1000, sourceFilename: 'legacy.epub' }
        ];
        const mockReadingList = [
            { filename: 'legacy.epub', title: 'Legacy Book', author: 'Author', percentage: 0.75, lastUpdated: 5000 }
        ];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getAllInventoryItems as any).mockResolvedValue(mockInventory);

        const dbMock = {
            objectStoreNames: {
                contains: vi.fn().mockReturnValue(true)
            },
            getAll: vi.fn().mockImplementation((storeName) => {
                if (storeName === 'user_reading_list') return Promise.resolve(mockReadingList);
                if (storeName === 'user_progress') return Promise.resolve([]); // NO progress in user_progress
                if (storeName === 'user_annotations') return Promise.resolve([]);
                return Promise.resolve([]);
            }),
            transaction: vi.fn().mockReturnValue({
                objectStore: vi.fn().mockReturnValue({
                    getAll: vi.fn().mockResolvedValue([]),
                    getAllKeys: vi.fn().mockResolvedValue([])
                }),
                done: Promise.resolve()
            })
        };
        const { getDB } = await import('../../db/db');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (getDB as any).mockResolvedValue(dbMock);

        // Run migration
        await migrateToYjs();

        // Check Reading List Store
        expect(useReadingListStore.setState).toHaveBeenCalled();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rlUpdateFn = (useReadingListStore.setState as any).mock.calls[0][0];
        const rlState = rlUpdateFn({ entries: {} });
        expect(rlState.entries['legacy.epub']).toBeDefined();
        expect(rlState.entries['legacy.epub'].percentage).toBe(0.75);

        // Check Progress Fallback in Reading State Store
        // Note: Progress is now stored per-device: progress[bookId][deviceId]
        expect(useReadingStateStore.setState).toHaveBeenCalled();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rsUpdateFn = (useReadingStateStore.setState as any).mock.calls[0][0];
        const rsState = rsUpdateFn({ progress: {} });
        expect(rsState.progress['book_legacy']).toBeDefined();
        expect(rsState.progress['book_legacy']['legacy-device']).toBeDefined();
        expect(rsState.progress['book_legacy']['legacy-device'].percentage).toBe(0.75);
        expect(rsState.progress['book_legacy']['legacy-device'].lastRead).toBe(5000);
    });

    it('should migrate preferences from reader-storage structure', async () => {
        const mockState = {
            state: {
                viewMode: 'scrolled',
                currentTheme: 'dark',
                fontSize: 120,
                lineHeight: 1.8
            },
            version: 0
        };

        vi.stubGlobal('localStorage', {
            getItem: vi.fn().mockImplementation((key) => {
                if (key === 'reader-storage') return JSON.stringify(mockState);
                return null;
            }),
            setItem: vi.fn(),
            clear: vi.fn(),
            removeItem: vi.fn(),
            key: vi.fn(),
            length: 0
        });

        await migrateToYjs();

        expect(usePreferencesStore.setState).toHaveBeenCalledWith({
            readerViewMode: 'scrolled',
            currentTheme: 'dark',
            fontSize: 120,
            lineHeight: 1.8
        });
    });

    it('should migrate readerViewMode from individual legacy localStorage key as fallback', async () => {
        // Setup localStorage
        vi.stubGlobal('localStorage', {
            getItem: vi.fn().mockImplementation((key) => {
                if (key === 'viewMode') return 'scrolled';
                return null;
            }),
            setItem: vi.fn(),
            clear: vi.fn(),
            removeItem: vi.fn(),
            key: vi.fn(),
            length: 0
        });

        await migrateToYjs();

        expect(usePreferencesStore.setState).toHaveBeenCalledWith({ readerViewMode: 'scrolled' });
    });

    it('should migrate global preferences to per-device preferences for existing users', async () => {
        // Setup global preferences
        const prefs = yDoc.getMap('preferences');
        prefs.set('currentTheme', 'dark');
        prefs.set('fontSize', 150);

        // Ensure per-device map is empty
        yDoc.getMap('preferences/test-device').clear();

        // Set migration complete to simulate existing user
        prefs.set('migration_complete', true);

        await migrateToYjs();

        // Check per-device map
        const devicePrefs = yDoc.getMap('preferences/test-device');
        expect(devicePrefs.get('currentTheme')).toBe('dark');
        expect(devicePrefs.get('fontSize')).toBe(150);
    });
});

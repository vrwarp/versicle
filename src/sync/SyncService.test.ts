import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncService } from './SyncService';
import { MockDriveProvider } from './MockDriveProvider';
import { getDB, initDB } from '../db/db';
import type { SyncManifest } from './types';
import type { BookMetadata, ReadingHistoryEntry, Annotation, LexiconRule, TTSPosition, ReadingListEntry } from '../types/db';

// Mock DB
// We define store outside so we can export a reset function
const store: any = {
    books: new Map(),
    reading_history: new Map(),
    annotations: new Map(),
    lexicon: new Map(),
    reading_list: new Map(),
    tts_position: new Map(),
    sync_log: [],
};

vi.mock('../db/db', () => {
    const db = {
        getAll: async (table: string) => {
            if (table === 'sync_log') return store.sync_log;
            return Array.from(store[table].values());
        },
        get: async (table: string, key: string) => store[table].get(key),
        put: async (table: string, value: any) => {
             if (table === 'sync_log') {
                 store.sync_log.push(value);
                 return;
             }
             const key = value.id || value.filename || value.bookId;
             store[table].set(key, value);
        },
        transaction: (stores: string[], mode: string) => ({
            objectStore: (table: string) => ({
                get: async (key: string) => store[table].get(key),
                getAll: async () => Array.from(store[table].values()),
                put: async (value: any) => {
                    const key = value.id || value.filename || value.bookId;
                    store[table].set(key, value);
                },
                clear: async () => store[table].clear(),
            }),
            done: Promise.resolve()
        })
    };

    return {
        getDB: async () => db,
        initDB: async () => db
    };
});

// Since vi.mock hoists, we need to declare the interface to TS knows about __resetMock
// But in test files, we often cast to any or use specialized types.
// The issue is that the import in beforeEach is the REAL module, not the mocked factory return?
// No, vitest mocks the module import.
// However, 'vi.mock' factory is hoisted.
// The error says "No __resetMock export is defined".
// This might be because `vi.mock` factory return is replacing the *default* export or named exports.
// If the original module has named exports `getDB` and `initDB`, my mock factory returns an object with those keys.
// So `import * as dbModule from '../db/db'` should contain them.
// Wait, I am using `vi.mock` with a factory.
// Maybe I need to export it from the mock factory explicitly? I did.
// But Vitest might check the ORIGINAL module for exports validation if I don't use the correct type of mock?
// Let's try to access it via `vi.mocked(getDB)`? No, `getDB` is a function.
// Let's rely on a side-channel for reset.
// Since `store` is defined in the test file scope (hoisted outside mock?), I can just clear it directly in beforeEach!
// Wait, `store` is defined at the top level of the file now.
// So I don't need `__resetMock` at all. I can just clear `store` in `beforeEach`.

describe('SyncService', () => {
    let syncService: SyncService;
    let mockProvider: MockDriveProvider;
    let db: any;

    beforeEach(async () => {
        mockProvider = new MockDriveProvider();
        syncService = new SyncService(mockProvider, 'device-test');

        // Reset DB mock state
        store.books.clear();
        store.reading_history.clear();
        store.annotations.clear();
        store.lexicon.clear();
        store.reading_list.clear();
        store.tts_position.clear();
        store.sync_log = [];

        db = await getDB();
    });

    it('should push local state to remote if remote is empty', async () => {
        // Setup local state
        const book: BookMetadata = { id: 'book1', title: 'Test Book', author: 'Author', addedAt: 1000, lastRead: 2000 };
        await db.put('books', book);

        await syncService.sync();

        const remote = await mockProvider.getManifest();
        expect(remote).not.toBeNull();
        expect(remote?.data.books['book1']).toBeDefined();
        expect(remote?.data.books['book1'].metadata.title).toBe('Test Book');
    });

    it('should merge remote changes (LWW) correctly', async () => {
        // Local: Book1 progress 10%
        await db.put('books', { id: 'book1', title: 'Book 1', lastRead: 1000, progress: 0.1 });

        // Remote: Book1 progress 20% (newer)
        const remoteManifest: SyncManifest = {
            version: 1,
            lastUpdated: 2000,
            deviceId: 'other-device',
            books: {
                'book1': {
                    metadata: { id: 'book1', title: 'Book 1', lastRead: 2000, progress: 0.2 },
                    history: { bookId: 'book1', readRanges: [], sessions: [], lastUpdated: 2000 },
                    annotations: []
                }
            },
            lexicon: [],
            readingList: {},
            transientState: { ttsPositions: {} },
            deviceRegistry: {}
        };
        await mockProvider.updateManifest(remoteManifest, '0');

        await syncService.sync();

        const localBook = await db.get('books', 'book1');
        expect(localBook.progress).toBe(0.2);
    });

     it('should not overwrite newer local changes', async () => {
        // Local: Book1 progress 30% (newer than remote)
        await db.put('books', { id: 'book1', title: 'Book 1', lastRead: 3000, progress: 0.3 });

        // Remote: Book1 progress 20%
        const remoteManifest: SyncManifest = {
            version: 1,
            lastUpdated: 2000,
            deviceId: 'other-device',
            books: {
                'book1': {
                    metadata: { id: 'book1', title: 'Book 1', lastRead: 2000, progress: 0.2 },
                    history: { bookId: 'book1', readRanges: [], sessions: [], lastUpdated: 2000 },
                    annotations: []
                }
            },
            lexicon: [],
            readingList: {},
            transientState: { ttsPositions: {} },
            deviceRegistry: {}
        };
        // Use a clean provider to force this state
        mockProvider = new MockDriveProvider(remoteManifest);
        syncService = new SyncService(mockProvider, 'device-test');

        await syncService.sync();

        const localBook = await db.get('books', 'book1');
        expect(localBook.progress).toBe(0.3);

        // Verify remote is updated with local 0.3
        const newRemote = await mockProvider.getManifest();
        expect(newRemote?.data.books['book1'].metadata.progress).toBe(0.3);
    });

    it('should handle merge conflicts gracefully (optimistic concurrency)', async () => {
        await db.put('books', { id: 'book1', title: 'Book 1', lastRead: 1000 });

        // Initial sync to set baseline
        await syncService.sync();

        // Simulate concurrent update on remote
        mockProvider.setShouldConflictNextRequest(true);

        await syncService.sync();

        // Should have logged a conflict
        const logs = await db.getAll('sync_log');
        const conflictLog = logs.find((l: any) => l.status === 'conflict');
        expect(conflictLog).toBeDefined();
    });

    it('should create placeholder for new remote book', async () => {
        // Remote has a book not in local
        const remoteManifest: SyncManifest = {
            version: 1,
            lastUpdated: 2000,
            deviceId: 'other',
            books: {
                'new-book': {
                    metadata: { id: 'new-book', title: 'New Book', author: 'New Author', addedAt: 2000 },
                    history: { bookId: 'new-book', readRanges: [], sessions: [], lastUpdated: 0 },
                    annotations: []
                }
            },
            lexicon: [],
            readingList: {},
            transientState: { ttsPositions: {} },
            deviceRegistry: {}
        };
        mockProvider = new MockDriveProvider(remoteManifest);
        syncService = new SyncService(mockProvider, 'device-test');

        await syncService.sync();

        const localBook = await db.get('books', 'new-book');
        expect(localBook).toBeDefined();
        expect(localBook.title).toBe('New Book');
        expect(localBook.isOffloaded).toBe(true);
    });
});

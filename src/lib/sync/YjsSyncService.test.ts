import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { MockDriveProvider } from './drivers/MockDriveProvider';

// Create mock Y.Doc
vi.mock('../../store/yjs-provider', () => {
    const Y = require('yjs');
    const doc = new Y.Doc();
    return {
        yDoc: doc,
        waitForYjsSync: vi.fn(() => Promise.resolve()),
    };
});

// Mock useSyncStore
vi.mock('./hooks/useSyncStore', () => ({
    useSyncStore: {
        getState: vi.fn(() => ({
            isSyncEnabled: true,
            googleClientId: 'test-client-id',
            googleApiKey: 'test-api-key',
            setLastSyncTime: vi.fn(),
        })),
        subscribe: vi.fn(),
    },
}));

// Mock getDB
vi.mock('../../db/db', () => ({
    getDB: vi.fn(() => Promise.resolve({
        getAll: vi.fn(() => Promise.resolve([]))
    })),
}));

describe('YjsSyncService', () => {
    let mockProvider: MockDriveProvider;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockYDoc: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockProvider = new MockDriveProvider();

        // Get mocked yDoc
        const yjsProvider = await import('../../store/yjs-provider');
        mockYDoc = yjsProvider.yDoc;

        // Clear Y.Doc
        mockYDoc.getMap('library').clear();
        mockYDoc.getMap('progress').clear();
        mockYDoc.getMap('annotations').clear();

        vi.spyOn(console, 'log').mockImplementation(() => { });
        vi.spyOn(console, 'warn').mockImplementation(() => { });
    });

    describe('MockDriveProvider Yjs Snapshots', () => {
        it('should upload and download snapshots', async () => {
            await mockProvider.initialize({});

            // Add data to Y.Doc
            mockYDoc.getMap('library').set('book1', {
                bookId: 'book1',
                title: 'Test Book',
            });

            // Encode and upload
            const snapshot = Y.encodeStateAsUpdate(mockYDoc);
            await mockProvider.uploadSnapshot(snapshot);

            // Download and verify
            const downloaded = await mockProvider.downloadSnapshot();
            expect(downloaded).not.toBeNull();
            expect(downloaded!.byteLength).toBeGreaterThan(0);

            // Apply to fresh doc and verify
            const freshDoc = new Y.Doc();
            Y.applyUpdate(freshDoc, downloaded!);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const book = freshDoc.getMap('library').get('book1') as any;
            expect(book).toBeDefined();
            expect(book.title).toBe('Test Book');
        });

        it('should persist snapshots across instances', async () => {
            await mockProvider.initialize({});

            mockYDoc.getMap('library').set('book1', { bookId: 'book1', title: 'Persisted' });
            const snapshot = Y.encodeStateAsUpdate(mockYDoc);
            await mockProvider.uploadSnapshot(snapshot);

            // Create new provider instance (simulates page reload)
            const newProvider = new MockDriveProvider();
            await newProvider.initialize({});

            const downloaded = await newProvider.downloadSnapshot();
            expect(downloaded).not.toBeNull();

            const freshDoc = new Y.Doc();
            Y.applyUpdate(freshDoc, downloaded!);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const book = freshDoc.getMap('library').get('book1') as any;
            expect(book.title).toBe('Persisted');
        });
    });

    describe('Yjs CRDT Merging', () => {
        it('should properly merge concurrent updates', async () => {
            // Simulate Device A
            const docA = new Y.Doc();
            docA.getMap('library').set('bookA', { bookId: 'bookA', title: 'From Device A' });
            const snapshotA = Y.encodeStateAsUpdate(docA);

            // Simulate Device B
            const docB = new Y.Doc();
            docB.getMap('library').set('bookB', { bookId: 'bookB', title: 'From Device B' });
            const snapshotB = Y.encodeStateAsUpdate(docB);

            // Apply A to B (simulates B pulling from remote)
            Y.applyUpdate(docB, snapshotA);

            // Both books should now exist in B
            expect(docB.getMap('library').get('bookA')).toBeDefined();
            expect(docB.getMap('library').get('bookB')).toBeDefined();

            // Apply B to A (simulates A pulling from remote)
            Y.applyUpdate(docA, snapshotB);

            // Both should be in A too
            expect(docA.getMap('library').get('bookA')).toBeDefined();
            expect(docA.getMap('library').get('bookB')).toBeDefined();
        });
    });
});

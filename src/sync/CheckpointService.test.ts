import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CheckpointService } from './CheckpointService';
import { getDB } from '../db/db';

// Reuse the mock from SyncService.test.ts or define a fresh one
// Vitest hoisting makes reuse tricky without setup files.
// I'll define a local mock for simplicity.
vi.mock('../db/db', () => {
    const store: any = {
        books: new Map(),
        reading_history: new Map(),
        annotations: new Map(),
        lexicon: new Map(),
        checkpoints: new Map(),
    };

    const db = {
        getAll: async (table: string) => {
            if (table === 'checkpoints') return Array.from(store.checkpoints.values());
            return Array.from(store[table].values());
        },
        getAllKeys: async (table: string) => Array.from(store[table].keys()),
        get: async (table: string, key: string) => store[table].get(key),
        put: async (table: string, value: any) => {
             const key = table === 'checkpoints' ? value.timestamp : (value.id || value.bookId);
             store[table].set(key, value);
        },
        delete: async (table: string, key: any) => store[table].delete(key),
        transaction: (stores: string[], mode: string) => ({
            objectStore: (table: string) => ({
                get: async (key: string) => store[table].get(key),
                getAll: async () => Array.from(store[table].values()),
                put: async (value: any) => {
                    const key = value.id || value.bookId;
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

describe('CheckpointService', () => {
    let service: CheckpointService;
    let db: any;

    beforeEach(async () => {
        service = new CheckpointService();
        db = await getDB();
    });

    it('should create a checkpoint with correct data', async () => {
        await db.put('books', { id: 'b1', title: 'T1', coverBlob: 'blob' });
        await db.put('annotations', { id: 'a1', text: 'note' });

        const timestamp = await service.createCheckpoint('test');

        const checkpoints = await db.getAll('checkpoints');
        expect(checkpoints.length).toBe(1);
        expect(checkpoints[0].timestamp).toBe(timestamp);

        const data = JSON.parse(checkpoints[0].data);
        expect(data.books.length).toBe(1);
        expect(data.books[0].title).toBe('T1');
        expect(data.books[0].coverBlob).toBeUndefined(); // Should exclude binary
        expect(data.annotations.length).toBe(1);
    });

    it('should restore data from a checkpoint', async () => {
        // Setup initial state
        await db.put('books', { id: 'b1', title: 'Original', coverBlob: 'blob' });

        // Create checkpoint
        const timestamp = await service.createCheckpoint('backup');

        // Modify state (simulate bad sync)
        // We preserve the blob here to verify that the service preserves it during restore
        // (If the blob was deleted from DB, the checkpoint service cannot restore it as it's not in the checkpoint)
        await db.put('books', { id: 'b1', title: 'Corrupted', coverBlob: 'blob' });
        await db.put('books', { id: 'b2', title: 'Bad Book' });

        // Restore
        await service.restoreCheckpoint(timestamp);

        const books = await db.getAll('books');
        expect(books.length).toBe(1);
        expect(books[0].title).toBe('Original');
        expect(books[0].coverBlob).toBe('blob'); // Should preserve binary if possible (based on mock logic)
        // Note: My mock logic for restore in CheckpointService reads current books to save blobs.
        // Let's verify that logic holds.
    });

    it('should preserve extended metadata during restore', async () => {
        // Setup initial state with extended metadata
        const book = {
            id: 'b1',
            title: 'Extended Book',
            author: 'Author',
            description: 'A very long description',
            addedAt: 123456789,
            coverBlob: 'blob'
        };
        await db.put('books', book);

        // Create checkpoint
        const timestamp = await service.createCheckpoint('extended-test');

        // Clear/Corrupt DB
        await db.put('books', { id: 'b1', title: 'Corrupted' }); // overwritten

        // Restore
        await service.restoreCheckpoint(timestamp);

        const restoredBooks = await db.getAll('books');
        const restoredBook = restoredBooks[0];

        expect(restoredBook.title).toBe('Extended Book');
        expect(restoredBook.description).toBe('A very long description');
        expect(restoredBook.addedAt).toBe(123456789);
        expect(restoredBook.coverBlob).toBeUndefined(); // Blob is still lost because we overwrote it in corruption step without preserving it
        // Wait, if I corrupted it by overwrite, the blob is gone.
        // The checkpoint logic I fixed (destructuring) EXCLUDES coverBlob from checkpoint.
        // So restore will put back metadata but NOT coverBlob.
        // My restore logic tries to rescue blob from CURRENT DB.
        // In this test, CURRENT DB (Corrupted) has no blob.
        // So result: No blob. This is expected.
        // But description should be there.
    });

    it('should prune old checkpoints', async () => {
        for (let i = 0; i < 15; i++) {
            await service.createCheckpoint(`reason ${i}`);
            // Mock timestamp uniqueness
             await new Promise(r => setTimeout(r, 1));
             // Actually, the mock DB uses whatever the service generates.
             // The service uses Date.now(). In a fast loop, they might collide.
             // Let's just rely on the fact that if they are unique enough (or we can force keys in mock?)
             // The service generates timestamp inside.
             // We can just manually stuff the DB if needed, but let's see.
             // Mock Date.now?
        }

        const checkpoints = await db.getAll('checkpoints');
        expect(checkpoints.length).toBe(10);
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CheckpointService } from './CheckpointService';
import * as Y from 'yjs';

// Define mocks using vi.hoisted to ensure availability in vi.mock factory
const mocks = vi.hoisted(() => {
    const add = vi.fn();
    const count = vi.fn();
    const openCursor = vi.fn();
    const get = vi.fn();
    const getAll = vi.fn();
    const del = vi.fn();

    const store = {
        add,
        count,
        openCursor,
        get,
        getAll,
        delete: del
    };

    return { add, count, openCursor, get, getAll, del, store };
});

vi.mock('../../db/db', () => ({
    getDB: vi.fn(async () => ({
        transaction: () => ({
            store: mocks.store,
            objectStore: () => mocks.store, // fallback if .store not accessed
            done: Promise.resolve()
        }),
        get: mocks.get,
        getAll: mocks.getAll
    }))
}));

// Mock Yjs Provider
vi.mock('../../store/yjs-provider', async () => {
    const YActual = await import('yjs');
    return {
        yDoc: new YActual.Doc()
    };
});
import { yDoc } from '../../store/yjs-provider';

describe('CheckpointService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Clear yDoc
        yDoc.transact(() => {
            // Use same clearing logic as in tests (manual clear for simplicity)
            ['library', 'reading-list', 'progress', 'annotations', 'lexicon', 'preferences', 'contentAnalysis'].forEach(key => {
                 const type = yDoc.share.get(key);
                 if (type) {
                     if (type instanceof Y.Map) {
                        Array.from(type.keys()).forEach(k => type.delete(k));
                    } else if (type instanceof Y.Array) {
                        type.delete(0, type.length);
                    }
                 }
            });
        });
    });

    it('should create a checkpoint with current yDoc state', async () => {
        mocks.add.mockResolvedValue(1); // ID
        mocks.count.mockResolvedValue(1);

        // Put some data in yDoc
        yDoc.getMap('library').set('test', 'data');

        const id = await CheckpointService.createCheckpoint('manual');

        expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({
            trigger: 'manual',
            blob: expect.any(Uint8Array),
            size: expect.any(Number)
        }));
        expect(id).toBe(1);
    });

    it('should prune old checkpoints if limit exceeded', async () => {
        mocks.add.mockResolvedValue(11);
        mocks.count.mockResolvedValue(11); // Limit is 10

        // Mock cursor iteration to delete 1 item
        const cursor = {
            delete: mocks.del,
            continue: vi.fn().mockResolvedValue(null) // Stop after one
        };
        mocks.openCursor.mockResolvedValueOnce(cursor);

        await CheckpointService.createCheckpoint('auto');

        expect(mocks.del).toHaveBeenCalledTimes(1);
    });

    it('should list checkpoints sorted by timestamp', async () => {
        const cp1 = { id: 1, timestamp: 100 };
        const cp2 = { id: 2, timestamp: 200 };
        mocks.getAll.mockResolvedValue([cp1, cp2]);

        const list = await CheckpointService.listCheckpoints();
        expect(list[0].id).toBe(2); // Newest first
        expect(list[1].id).toBe(1);
    });

    it('should restore a checkpoint by applying update', async () => {
        // Setup checkpoint
        const tempDoc = new Y.Doc();
        tempDoc.getMap('library').set('restored', true);
        const blob = Y.encodeStateAsUpdate(tempDoc);

        mocks.get.mockResolvedValue({ blob });

        // Setup current state
        yDoc.getMap('library').set('current', true);

        await CheckpointService.restoreCheckpoint(1);

        // Expect current state to be wiped and replaced
        const lib = yDoc.getMap('library');
        expect(lib.has('current')).toBe(false);
        expect(lib.get('restored')).toBe(true);
    });
});

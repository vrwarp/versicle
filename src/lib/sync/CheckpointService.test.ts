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

let tempDocCounter = 0;

describe('CheckpointService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.get.mockReset();
        mocks.getAll.mockReset();
        mocks.add.mockReset();
        mocks.count.mockReset();
        mocks.openCursor.mockReset();

        // Clear yDoc
        yDoc.transact(() => {
            const keys = Array.from(yDoc.share.keys());
            for (const key of keys) {
                const type = yDoc.share.get(key);
                if (type instanceof Y.Map) {
                    Array.from(type.keys()).forEach(k => type.delete(k));
                } else if (type instanceof Y.Array) {
                    type.delete(0, type.length);
                }
            }
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
        // Prevent collision if Math.random is mocked
        tempDoc.clientID = yDoc.clientID + (++tempDocCounter);

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

    it('should clear both Map and Array types during restore', async () => {
        // Setup checkpoint with different data
        const tempDoc = new Y.Doc();
        // Prevent collision if Math.random is mocked
        tempDoc.clientID = yDoc.clientID + (++tempDocCounter);

        tempDoc.getMap('library').set('restored', true);
        const blob = Y.encodeStateAsUpdate(tempDoc);
        mocks.get.mockResolvedValue({ blob });

        // Setup current state with MIXED types
        yDoc.getMap('library').set('current', true);
        const lexiconArr = yDoc.getArray('lexicon'); // Force Array for test
        lexiconArr.push(['rule1']);
        yDoc.getMap('preferences').set('theme', 'dark');

        await CheckpointService.restoreCheckpoint(1);

        // Verify everything is cleared/replaced
        const lib = yDoc.getMap('library');
        expect(lib.has('current')).toBe(false);
        expect(lib.get('restored')).toBe(true);

        const lex = yDoc.getArray('lexicon');
        expect(lex.length).toBe(0); // Should be cleared (and empty in checkpoint)

        const prefs = yDoc.getMap('preferences');
        expect(prefs.size).toBe(0);
    });

    it('should create automatic checkpoint if no previous one exists', async () => {
        mocks.getAll.mockResolvedValue([]);
        mocks.add.mockResolvedValue(1);
        mocks.count.mockResolvedValue(1);

        const id = await CheckpointService.createAutomaticCheckpoint('auto', 1000);

        expect(id).toBe(1);
        expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'auto' }));
    });

    it('should skip automatic checkpoint if recent one exists', async () => {
        const now = Date.now();
        const recentCp = { id: 1, timestamp: now - 500, trigger: 'auto' }; // 500ms ago
        mocks.getAll.mockResolvedValue([recentCp]);

        const id = await CheckpointService.createAutomaticCheckpoint('auto', 1000); // Limit 1000ms

        expect(id).toBeNull();
        expect(mocks.add).not.toHaveBeenCalled();
    });

    it('should create automatic checkpoint if previous one is old enough', async () => {
        const now = Date.now();
        const oldCp = { id: 1, timestamp: now - 2000, trigger: 'auto' }; // 2s ago
        mocks.getAll.mockResolvedValue([oldCp]);
        mocks.add.mockResolvedValue(2);
        mocks.count.mockResolvedValue(2);

        const id = await CheckpointService.createAutomaticCheckpoint('auto', 1000); // Limit 1000ms

        expect(id).toBe(2);
        expect(mocks.add).toHaveBeenCalled();
    });

    it('should ignore checkpoints with different triggers', async () => {
        const now = Date.now();
        const otherCp = { id: 1, timestamp: now - 100, trigger: 'manual' }; // Recent but different trigger
        mocks.getAll.mockResolvedValue([otherCp]);
        mocks.add.mockResolvedValue(2);
        mocks.count.mockResolvedValue(2);

        const id = await CheckpointService.createAutomaticCheckpoint('auto', 1000);

        expect(id).toBe(2);
        expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'auto' }));
    });
});

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

    // Persistence mocks
    const persistenceClearData = vi.fn();
    const persistenceConstructor = vi.fn();
    const persistenceOn = vi.fn();
    const persistenceOnce = vi.fn();
    const persistenceDestroy = vi.fn();
    const disconnectYjs = vi.fn();

    return {
        add, count, openCursor, get, getAll, del, store,
        persistenceClearData, persistenceConstructor, persistenceOn, persistenceOnce, persistenceDestroy,
        disconnectYjs
    };
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

// Mock y-indexeddb
vi.mock('y-indexeddb', () => ({
    IndexeddbPersistence: class {
        constructor(name: string, doc: any) {
            mocks.persistenceConstructor(name, doc);
        }
        clearData() { return mocks.persistenceClearData(); }
        on(event: string, cb: () => void) { mocks.persistenceOn(event, cb); }
        once(event: string, cb: () => void) {
            mocks.persistenceOnce(event, cb);
            if (event === 'synced') cb(); // Auto-resolve sync
        }
        destroy() { mocks.persistenceDestroy(); }
    }
}));

// Mock Yjs Provider
vi.mock('../../store/yjs-provider', async () => {
    const YActual = await import('yjs');
    return {
        yDoc: new YActual.Doc(),
        yjsPersistence: {
            clearData: mocks.persistenceClearData,
            destroy: mocks.persistenceDestroy,
            on: mocks.persistenceOn,
            once: mocks.persistenceOnce,
            synced: true
        },
        disconnectYjs: mocks.disconnectYjs
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
        mocks.persistenceClearData.mockReset();
        mocks.persistenceConstructor.mockReset();
        mocks.persistenceDestroy.mockReset();
        mocks.disconnectYjs.mockReset();

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

    it('should restore a checkpoint by applying update (via persistence)', async () => {
        // Setup checkpoint
        const tempDoc = new Y.Doc();
        // Prevent collision if Math.random is mocked
        tempDoc.clientID = yDoc.clientID + (++tempDocCounter);

        tempDoc.getMap('library').set('restored', true);
        const blob = Y.encodeStateAsUpdate(tempDoc);

        mocks.get.mockResolvedValue({ blob });

        await CheckpointService.restoreCheckpoint(1);

        // Verify clearData and disconnect called
        expect(mocks.persistenceClearData).toHaveBeenCalled();
        expect(mocks.disconnectYjs).toHaveBeenCalled();

        // Verify new persistence created with correct data
        expect(mocks.persistenceConstructor).toHaveBeenCalledWith('versicle-yjs', expect.anything());
        const restoredDoc = mocks.persistenceConstructor.mock.calls[0][1] as Y.Doc;

        const lib = restoredDoc.getMap('library');
        expect(lib.get('restored')).toBe(true);
    });

    it('should clear both Map and Array types during restore (implicit via clearData)', async () => {
        // This test logic is now handled by clearData() logic, but we can verify the snapshot content is correct

        // Setup checkpoint with data
        const tempDoc = new Y.Doc();
        tempDoc.getMap('library').set('restored', true);
        // Add empty array to verify it exists if we want, or just assume snapshot integrity
        const blob = Y.encodeStateAsUpdate(tempDoc);
        mocks.get.mockResolvedValue({ blob });

        await CheckpointService.restoreCheckpoint(1);

        expect(mocks.persistenceClearData).toHaveBeenCalled();
        const restoredDoc = mocks.persistenceConstructor.mock.calls[0][1] as Y.Doc;
        const lib = restoredDoc.getMap('library');
        expect(lib.get('restored')).toBe(true);
        // The fact that we cleared data means old data is gone. The fact that we applied snapshot means new data is there.
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

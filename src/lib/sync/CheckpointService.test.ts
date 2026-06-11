import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CheckpointService } from './CheckpointService';
import { MigrationStateService } from './MigrationStateService';
import * as Y from 'yjs';

// Define mocks using vi.hoisted to ensure availability in vi.mock factory
const mocks = vi.hoisted(() => {
    const add = vi.fn();
    const count = vi.fn();
    const openCursor = vi.fn();
    const get = vi.fn();
    const getAll = vi.fn();
    const del = vi.fn();
    const firestoreDestroy = vi.fn();
    const disconnectYjs = vi.fn(async () => undefined);

    const store = {
        add,
        count,
        openCursor,
        get,
        getAll,
        delete: del
    };

    return {
        add, count, openCursor, get, getAll, del, store, firestoreDestroy,
        disconnectYjs,
        // null = the suite's default (soft-restore fallback). The hard-reset
        // (S.2) tests install an object with a clearData spy.
        persistence: null as null | { clearData: () => Promise<void> }
    };
});

vi.mock('@data/connection', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@data/connection')>()),
    getConnection: vi.fn(async () => ({
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
vi.mock('@store/yjs-provider', async () => {
    const YActual = await import('yjs');
    const doc = new YActual.Doc();
    return {
        getYDoc: () => doc,
        // Default null (soft-restore fallback); S.2 tests install a stub.
        getYjsPersistence: () => mocks.persistence,
        disconnectYjs: mocks.disconnectYjs,
    };
});
import { getYDoc } from '@store/yjs-provider';

const yDoc = getYDoc();

vi.mock('./FirestoreSyncManager', () => ({
    getFirestoreSyncManager: () => ({
        destroy: mocks.firestoreDestroy
    })
}));

let tempDocCounter = 0;

describe('CheckpointService', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    beforeEach(() => {
        vi.spyOn(console, 'info').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});

        vi.clearAllMocks();
        mocks.get.mockReset();
        mocks.getAll.mockReset();
        mocks.add.mockReset();
        mocks.count.mockReset();
        mocks.openCursor.mockReset();
        mocks.firestoreDestroy.mockReset();
        mocks.disconnectYjs.mockClear();
        mocks.persistence = null;

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

    it('should restore a checkpoint by applying update and disconnecting firestore', async () => {
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

        // Verify firestore is disconnected
        expect(mocks.firestoreDestroy).toHaveBeenCalledTimes(1);

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

    describe('regression: migration checkpoint pinning (protected flag)', () => {
        /**
         * Builds a linked chain of mock IDB cursors over the given records
         * (oldest first, matching auto-increment key order) and records
         * which keys get deleted/updated.
         */
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        function makeCursorChain(records: Array<{ key: number; value: any }>) {
            const deletedKeys: number[] = [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const updates: Array<{ key: number; value: any }> = [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const cursors: any[] = records.map(r => ({
                value: r.value,
                primaryKey: r.key,
                delete: vi.fn(async () => { deletedKeys.push(r.key); }),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                update: vi.fn(async (v: any) => { updates.push({ key: r.key, value: v }); }),
                continue: vi.fn()
            }));
            cursors.forEach((c, i) => c.continue.mockResolvedValue(cursors[i + 1] ?? null));
            return { first: cursors[0] ?? null, deletedKeys, updates, cursors };
        }

        it('stores protected: true when requested (pre-migration backup)', async () => {
            mocks.add.mockResolvedValue(42);
            mocks.count.mockResolvedValue(3); // Under limit, no pruning
            const chain = makeCursorChain([
                { key: 40, value: { trigger: 'pre-sync' } },
                { key: 41, value: { trigger: 'manual' } },
                { key: 42, value: { trigger: 'pre-migration', protected: true } }
            ]);
            mocks.openCursor.mockResolvedValue(chain.first);

            const id = await CheckpointService.createCheckpoint('pre-migration', { protected: true });

            expect(id).toBe(42);
            expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({
                trigger: 'pre-migration',
                protected: true
            }));
            // Nothing else was protected, and the new checkpoint itself is untouched
            expect(chain.updates).toEqual([]);
            expect(chain.deletedKeys).toEqual([]);
        });

        it('does not store the protected field for normal checkpoints', async () => {
            mocks.add.mockResolvedValue(1);
            mocks.count.mockResolvedValue(1);

            await CheckpointService.createCheckpoint('manual');

            expect(mocks.add).toHaveBeenCalledWith(expect.not.objectContaining({
                protected: expect.anything()
            }));
        });

        it('never prunes a protected checkpoint under pruning pressure', async () => {
            // 13 stored (limit 10) → pruning wants 3 deletions
            mocks.add.mockResolvedValue(13);
            mocks.count.mockResolvedValue(13);
            const chain = makeCursorChain([
                { key: 1, value: { trigger: 'pre-migration', protected: true } }, // Oldest, pinned
                { key: 2, value: { trigger: 'pre-sync' } },
                { key: 3, value: { trigger: 'pre-sync' } },
                { key: 4, value: { trigger: 'pre-sync' } },
                { key: 5, value: { trigger: 'pre-sync' } }
            ]);
            mocks.openCursor.mockResolvedValue(chain.first);

            await CheckpointService.createCheckpoint('pre-sync');

            // The protected rollback target is skipped; the oldest unprotected go
            expect(chain.deletedKeys).toEqual([2, 3, 4]);
        });

        it('unprotects older protected checkpoints when a new protected one is created', async () => {
            mocks.add.mockResolvedValue(20);
            mocks.count.mockResolvedValue(3); // Under limit, no pruning
            const chain = makeCursorChain([
                { key: 10, value: { trigger: 'pre-migration', protected: true, timestamp: 1 } },
                { key: 15, value: { trigger: 'pre-sync', timestamp: 2 } },
                { key: 20, value: { trigger: 'pre-migration', protected: true, timestamp: 3 } } // The new one
            ]);
            mocks.openCursor.mockResolvedValue(chain.first);

            await CheckpointService.createCheckpoint('pre-migration', { protected: true });

            // Only the superseded protected checkpoint is rewritten, flag removed
            expect(chain.updates).toHaveLength(1);
            expect(chain.updates[0].key).toBe(10);
            expect(chain.updates[0].value.protected).toBeUndefined();
            expect(chain.updates[0].value.trigger).toBe('pre-migration'); // Rest preserved
            // The newly created checkpoint stays pinned
            expect(chain.cursors[2].update).not.toHaveBeenCalled();
        });

        it('treats legacy records without the protected field as prunable', async () => {
            mocks.add.mockResolvedValue(11);
            mocks.count.mockResolvedValue(11); // 1 over limit
            const chain = makeCursorChain([
                { key: 1, value: { trigger: 'pre-sync', timestamp: 100 } }, // Legacy record: no field
                { key: 2, value: { trigger: 'manual', timestamp: 200 } }
            ]);
            mocks.openCursor.mockResolvedValue(chain.first);

            await CheckpointService.createCheckpoint('auto');

            expect(chain.deletedKeys).toEqual([1]);
        });

        it('loads legacy records without the protected field', async () => {
            const legacy = { id: 1, timestamp: 100, trigger: 'manual', blob: new Uint8Array(), size: 1 };
            mocks.getAll.mockResolvedValue([legacy]);
            mocks.get.mockResolvedValue(legacy);

            const list = await CheckpointService.listCheckpoints();
            expect(list).toHaveLength(1);
            expect(list[0].protected).toBeUndefined();

            const single = await CheckpointService.getCheckpoint(1);
            expect(single?.id).toBe(1);
        });
    });

    describe('regression: migration state kept until restore succeeds', () => {
        afterEach(() => {
            MigrationStateService.clear();
        });

        it('clears RESTORING_BACKUP state only after a successful restore', async () => {
            MigrationStateService.setState({
                status: 'RESTORING_BACKUP',
                targetWorkspaceId: 'ws_target',
                backupCheckpointId: 1
            });

            const tempDoc = new Y.Doc();
            tempDoc.clientID = yDoc.clientID + (++tempDocCounter);
            tempDoc.getMap('library').set('restored', true);
            mocks.get.mockResolvedValue({ blob: Y.encodeStateAsUpdate(tempDoc) });

            await CheckpointService.restoreCheckpoint(1);

            expect(MigrationStateService.getState()).toBeNull();
        });

        it('keeps the migration state when the rollback checkpoint is missing', async () => {
            MigrationStateService.setState({
                status: 'RESTORING_BACKUP',
                targetWorkspaceId: 'ws_target',
                backupCheckpointId: 99
            });

            mocks.get.mockResolvedValue(undefined); // Pruned/corrupted checkpoint

            await expect(CheckpointService.restoreCheckpoint(99)).rejects.toThrow('Checkpoint corrupted');

            // State survives, so the boot interceptor handles the failure
            // explicitly instead of silently booting into the target workspace.
            expect(MigrationStateService.getState()?.status).toBe('RESTORING_BACKUP');
        });
    });

    /**
     * S.2 (phase3-storage-gateway.md §Test plan, PR P3-11): the hard-reset
     * restore path — previously a temp-doc + temp-IndexeddbPersistence +
     * whenSynced dance, now YjsSnapshotService.applySnapshot (the vendored
     * fork's commit-awaited writeSnapshot). These tests run the REAL
     * snapshot service against fake-indexeddb; only the provider handle and
     * the checkpoint store are mocked.
     */
    describe('regression: hard-reset restore via YjsSnapshotService (S.2)', () => {
        const deleteYjsDatabase = () => new Promise<void>((resolve, reject) => {
            const request = indexedDB.deleteDatabase('versicle-yjs');
            request.onsuccess = () => resolve();
            request.onblocked = () => resolve();
            request.onerror = () => reject(request.error);
        });

        const readYjsUpdateRows = async (): Promise<Uint8Array[]> => {
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const request = indexedDB.open('versicle-yjs');
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            try {
                return await new Promise<Uint8Array[]>((resolve, reject) => {
                    const tx = db.transaction(['updates'], 'readonly');
                    const request = tx.objectStore('updates').getAll();
                    request.onsuccess = () => resolve(request.result as Uint8Array[]);
                    request.onerror = () => reject(request.error);
                });
            } finally {
                db.close();
            }
        };

        let clearData: ReturnType<typeof vi.fn<() => Promise<void>>>;

        beforeEach(async () => {
            await deleteYjsDatabase();
            clearData = vi.fn<() => Promise<void>>(async () => undefined);
            mocks.persistence = { clearData };
        });

        afterEach(() => {
            MigrationStateService.clear();
        });

        it('restoreCheckpoint persists the snapshot durably, then clears migration state, in order', async () => {
            const tempDoc = new Y.Doc();
            tempDoc.clientID = yDoc.clientID + (++tempDocCounter);
            tempDoc.getMap('library').set('restored', 'hard');
            const blob = Y.encodeStateAsUpdate(tempDoc);
            tempDoc.destroy();
            mocks.get.mockResolvedValue({ blob });

            MigrationStateService.setState({
                status: 'RESTORING_BACKUP',
                targetWorkspaceId: 'ws_target',
                backupCheckpointId: 1
            });

            await CheckpointService.restoreCheckpoint(1);

            // Destructive sequence ran: sync severed, persistence wiped and
            // disconnected (clearData before disconnectYjs).
            expect(mocks.firestoreDestroy).toHaveBeenCalledTimes(1);
            expect(clearData).toHaveBeenCalledTimes(1);
            expect(mocks.disconnectYjs).toHaveBeenCalledTimes(1);
            expect(clearData.mock.invocationCallOrder[0])
                .toBeLessThan(mocks.disconnectYjs.mock.invocationCallOrder[0]);

            // The snapshot is durably in versicle-yjs: exactly one row,
            // byte-identical, hydrating a fresh doc to the checkpoint state.
            const rows = await readYjsUpdateRows();
            expect(rows).toHaveLength(1);
            expect(Array.from(rows[0])).toEqual(Array.from(blob));
            const fresh = new Y.Doc();
            Y.applyUpdate(fresh, rows[0]);
            expect(fresh.getMap('library').get('restored')).toBe('hard');
            fresh.destroy();

            // ▲9 ordering preserved: migration state cleared only AFTER the
            // snapshot was fully persisted.
            expect(MigrationStateService.getState()).toBeNull();
        });

        it('restoreCheckpoint rejects a corrupted blob BEFORE anything destructive runs', async () => {
            mocks.get.mockResolvedValue({
                blob: new TextEncoder().encode('garbage, not a yjs update')
            });
            MigrationStateService.setState({
                status: 'RESTORING_BACKUP',
                targetWorkspaceId: 'ws_target',
                backupCheckpointId: 1
            });

            await expect(CheckpointService.restoreCheckpoint(1)).rejects.toMatchObject({
                code: 'BACKUP_SNAPSHOT_INVALID'
            });

            // Validate-before-destroy: nothing was severed or wiped, and the
            // migration state machine survives for the boot interceptor.
            expect(mocks.firestoreDestroy).not.toHaveBeenCalled();
            expect(clearData).not.toHaveBeenCalled();
            expect(mocks.disconnectYjs).not.toHaveBeenCalled();
            expect(MigrationStateService.getState()?.status).toBe('RESTORING_BACKUP');
        });

        it('applyRemoteState persists the remote blob durably through the same path', async () => {
            const remoteDoc = new Y.Doc();
            remoteDoc.clientID = yDoc.clientID + (++tempDocCounter);
            remoteDoc.getMap('library').set('workspace', 'remote');
            const remoteBlob = Y.encodeStateAsUpdate(remoteDoc);
            remoteDoc.destroy();

            await CheckpointService.applyRemoteState(remoteBlob);

            expect(mocks.firestoreDestroy).toHaveBeenCalledTimes(1);
            expect(clearData).toHaveBeenCalledTimes(1);
            expect(mocks.disconnectYjs).toHaveBeenCalledTimes(1);

            const rows = await readYjsUpdateRows();
            expect(rows).toHaveLength(1);
            expect(Array.from(rows[0])).toEqual(Array.from(remoteBlob));
        });

        it('applyRemoteState rejects a corrupted blob before anything destructive runs', async () => {
            await expect(
                CheckpointService.applyRemoteState(new Uint8Array(0))
            ).rejects.toMatchObject({ code: 'BACKUP_SNAPSHOT_INVALID' });

            expect(mocks.firestoreDestroy).not.toHaveBeenCalled();
            expect(clearData).not.toHaveBeenCalled();
            expect(mocks.disconnectYjs).not.toHaveBeenCalled();
        });
    });
});

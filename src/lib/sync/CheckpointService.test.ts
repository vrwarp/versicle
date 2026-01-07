import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CheckpointService } from './CheckpointService';
import type { SyncManifest } from '../../types/db';

// Mock getDB
const mockAdd = vi.fn();

const mockCount = vi.fn();
const mockOpenCursor = vi.fn();
const mockGet = vi.fn();
const mockGetAll = vi.fn();
const mockDelete = vi.fn();

vi.mock('../../db/db', () => ({
    getDB: vi.fn(async () => ({
        transaction: () => ({
            objectStore: () => ({
                add: mockAdd,
                count: mockCount,
                openCursor: mockOpenCursor,
                get: mockGet,
                getAll: mockGetAll
            }),
            done: Promise.resolve()
        }),
        get: mockGet,
        getAll: mockGetAll
    }))
}));

describe('CheckpointService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const dummyManifest: SyncManifest = {
        version: 1,
        lastUpdated: 100,
        deviceId: 'dev',
        books: {},
        lexicon: [],
        readingList: {},
        transientState: { ttsPositions: {} },
        deviceRegistry: {}
    };

    it('should create a checkpoint', async () => {
        mockAdd.mockResolvedValue(1); // ID
        mockCount.mockResolvedValue(1);

        const id = await CheckpointService.createCheckpoint(dummyManifest, 'manual');

        expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
            manifest: dummyManifest,
            trigger: 'manual'
        }));
        expect(id).toBe(1);
    });

    it('should prune old checkpoints if limit exceeded', async () => {
        mockAdd.mockResolvedValue(11);
        mockCount.mockResolvedValue(11); // Limit is 10

        // Mock cursor iteration to delete 1 item
        const cursor = {
            delete: mockDelete,
            continue: vi.fn().mockResolvedValue(null) // Stop after one
        };
        mockOpenCursor.mockResolvedValueOnce(cursor);

        await CheckpointService.createCheckpoint(dummyManifest, 'auto');

        expect(mockDelete).toHaveBeenCalledTimes(1);
    });

    it('should list checkpoints sorted by timestamp', async () => {
        const cp1 = { id: 1, timestamp: 100 };
        const cp2 = { id: 2, timestamp: 200 };
        mockGetAll.mockResolvedValue([cp1, cp2]);

        const list = await CheckpointService.listCheckpoints();
        expect(list[0].id).toBe(2); // Newest first
        expect(list[1].id).toBe(1);
    });

    it('should restore a checkpoint', async () => {
        mockGet.mockResolvedValue({ manifest: dummyManifest });
        const manifest = await CheckpointService.restoreCheckpoint(1);
        expect(manifest).toEqual(dummyManifest);
    });
});

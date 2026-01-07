import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncOrchestrator } from './SyncOrchestrator';
import { CheckpointService } from './CheckpointService';
import { SyncManager } from './SyncManager';
import { AndroidBackupService } from './android-backup';
import { useSyncStore } from './hooks/useSyncStore';

// Mocks
vi.mock('./CheckpointService');
vi.mock('./SyncManager');
vi.mock('./android-backup');
vi.mock('../../db/db', () => ({
    getDB: vi.fn(async () => ({
        getAll: vi.fn().mockResolvedValue([]),
        transaction: () => ({
            objectStore: () => ({ get: vi.fn(), put: vi.fn() }),
            done: Promise.resolve()
        })
    }))
}));

const mockProvider = {
    initialize: vi.fn(),
    getManifest: vi.fn(),
    uploadManifest: vi.fn(),
    isAuthenticated: vi.fn(),
    getLastModified: vi.fn()
};

describe('SyncOrchestrator', () => {
    let orchestrator: SyncOrchestrator;

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset singleton (if possible, or just create new instance since we passed provider)
        // Accessing private instance for test isolation if needed, but constructor sets it.
        orchestrator = new SyncOrchestrator(mockProvider as unknown as RemoteStorageProvider);

        // Mock Store state
        useSyncStore.setState({
            googleClientId: 'id',
            googleApiKey: 'key',
            isSyncEnabled: true
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should initialize and pull', async () => {
        mockProvider.getManifest.mockResolvedValue(null); // First time

        await orchestrator.initialize();

        expect(mockProvider.initialize).toHaveBeenCalled();
        expect(mockProvider.getManifest).toHaveBeenCalled();
        // Should upload initial state if remote is empty
        expect(mockProvider.uploadManifest).toHaveBeenCalled();
    });

    it('should force push on trigger', async () => {
        await orchestrator.forcePush('test');

        expect(CheckpointService.createCheckpoint).toHaveBeenCalled();
        expect(AndroidBackupService.writeBackupPayload).toHaveBeenCalled();
        expect(mockProvider.uploadManifest).toHaveBeenCalled();
    });

    it('should debounce scheduleSync', async () => {
        vi.useFakeTimers();

        orchestrator.scheduleSync();
        orchestrator.scheduleSync();
        orchestrator.scheduleSync();

        expect(mockProvider.uploadManifest).not.toHaveBeenCalled();

        // Advance time to trigger timeout
        vi.advanceTimersByTime(60000);

        // The timeout callback calls an async function (forcePush).
        // advanceTimersByTime runs the callback synchronously, but the async body (await performSync)
        // goes to microtask queue. We need to flush microtasks.
        // Waiting for multiple ticks ensures the async chain proceeds.
        await vi.advanceTimersByTimeAsync(0); // Flush promises

        expect(mockProvider.uploadManifest).toHaveBeenCalledTimes(1);
    });

    it('should merge remote data if found', async () => {
        const fullManifest = {
            version: 2,
            books: {},
            lexicon: [],
            readingList: {},
            transientState: { ttsPositions: {} },
            deviceRegistry: {}
        } as unknown as SyncManifest;

        mockProvider.getManifest.mockResolvedValue(fullManifest);

        vi.mocked(SyncManager.mergeManifests).mockReturnValue(fullManifest);

        await orchestrator.forcePush('test');

        expect(SyncManager.mergeManifests).toHaveBeenCalled();
        expect(mockProvider.uploadManifest).toHaveBeenCalledWith(fullManifest, 2);
    });
});

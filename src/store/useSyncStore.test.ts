import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSyncStore } from './useSyncStore';
import { SyncService } from '../sync/SyncService';
import { GoogleDriveProvider } from '../sync/GoogleDriveProvider';
import { CheckpointService } from '../sync/CheckpointService';

// Mock dependencies
vi.mock('../sync/SyncService');
vi.mock('../sync/GoogleDriveProvider');
vi.mock('../sync/CheckpointService');

// Mock localStorage for device ID
const localStorageMock = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
};
Object.defineProperty(global, 'localStorage', { value: localStorageMock });
Object.defineProperty(global, 'crypto', { value: { randomUUID: () => 'test-device-id' } });

describe('useSyncStore', () => {
    let mockSyncService: any;
    let mockProvider: any;
    let mockCheckpointService: any;

    // Since the store is created globally at module load, it has already instantiated the services.
    // We need to spy on the prototypes or the specific instances if we could.
    // However, vitest module mocking replaces the constructor, so 'new SyncService()' returned a mock.
    // But WHICH mock? The one defined in the mock factory (which we didn't define explicitly, just vi.mock()).
    // If we want to control the instance methods, we should probably access the mock instances.
    // But since we can't easily reach into the closed module scope, we rely on the fact that
    // vi.mock replaces the CLASS. All instances created from it will be mocks.
    // BUT, the store was imported BEFORE beforeEach ran in this file?
    // No, `vi.mock` is hoisted to the top.

    // The issue is that `mockProvider` defined in `beforeEach` is a NEW object.
    // The store holds an instance created when `useSyncStore.ts` was evaluated.
    // We need to make sure the mocked class returns OUR object.
    // But `vi.mock` implementation is also hoisted/static?
    // The `mockImplementation` inside `beforeEach` affects FUTURE calls to `new`.
    // The store's `new` call happened already.

    // Solution: We should move the mock implementation setup to the `vi.mock` factory
    // or use `vi.spyOn` if possible, but the classes are imported.
    // Easiest fix: Mock the module methods by returning a specific object from the factory,
    // and share that object with the test.

    // Better yet: Since we are in a test file, we can re-import the store to re-evaluate it?
    // No, that's messy.

    // Let's use the `__mocks__` pattern or define the mocks at top level.

    const mockAuthorize = vi.fn();
    const mockSync = vi.fn();
    const mockCreateCheckpoint = vi.fn();
    const mockGetCheckpoints = vi.fn().mockResolvedValue([]);

    beforeEach(() => {
        vi.clearAllMocks();

        // We can't easily swap the instance in the store because it's in a closure.
        // But we can verify that the store is using a mock class.
        // Let's rely on the fact that we mocked the modules.
        // If we simply assign the mock functions to the prototype?

        // Let's try to mock the methods on the prototype of the mocked class.
        (GoogleDriveProvider.prototype.authorize as any).mockImplementation(mockAuthorize);
        (GoogleDriveProvider.prototype.isAuthorized as any).mockReturnValue(false);
        (SyncService.prototype.sync as any).mockImplementation(mockSync);
        (CheckpointService.prototype.createCheckpoint as any).mockImplementation(mockCreateCheckpoint);
        (CheckpointService.prototype.getCheckpoints as any).mockImplementation(mockGetCheckpoints);

        useSyncStore.setState({
            isSyncing: false,
            syncStatus: 'idle',
            lastSyncTime: null,
            errorMessage: null,
            isAuthorized: false,
            checkpoints: []
        });
    });

    it('should initialize with default state', () => {
        const state = useSyncStore.getState();
        expect(state.isSyncing).toBe(false);
        expect(state.syncStatus).toBe('idle');
        expect(state.isAuthorized).toBe(false);
    });

    it('should handle authorization flow', async () => {
        mockAuthorize.mockResolvedValue(undefined);

        await useSyncStore.getState().authorize();

        expect(mockAuthorize).toHaveBeenCalled();
        expect(useSyncStore.getState().isAuthorized).toBe(true);
        expect(useSyncStore.getState().errorMessage).toBeNull();
    });

    it('should handle sync flow with auto-checkpoint', async () => {
        mockSync.mockResolvedValue(undefined);
        mockCreateCheckpoint.mockResolvedValue(123);
        mockGetCheckpoints.mockResolvedValue([]);

        // Start sync
        await useSyncStore.getState().sync();

        expect(useSyncStore.getState().isSyncing).toBe(false);
        expect(useSyncStore.getState().syncStatus).toBe('success');
        expect(useSyncStore.getState().lastSyncTime).toBeTruthy();
    });

});

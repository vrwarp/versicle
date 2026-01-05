import { create } from 'zustand';
import { SyncService } from '../sync/SyncService';
import { GoogleDriveProvider } from '../sync/GoogleDriveProvider';
import { CheckpointService } from '../sync/CheckpointService';
import type { Checkpoint } from '../types/db';

interface SyncStoreState {
    isSyncing: boolean;
    syncStatus: 'idle' | 'success' | 'error' | 'conflict';
    lastSyncTime: number | null;
    errorMessage: string | null;
    isAuthorized: boolean;
    checkpoints: Checkpoint[];

    // Actions
    sync: () => Promise<void>;
    checkAuthorization: () => Promise<void>;
    authorize: () => Promise<void>;
    disconnect: () => Promise<void>;
    fetchCheckpoints: () => Promise<void>;
    createCheckpoint: (reason: string) => Promise<void>;
    restoreCheckpoint: (timestamp: number) => Promise<void>;
}

// Singleton instances
const provider = new GoogleDriveProvider();
// Device ID generation/retrieval (simple implementation for now)
const getDeviceId = () => {
    let id = localStorage.getItem('versicle_device_id');
    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem('versicle_device_id', id);
    }
    return id;
};

const syncService = new SyncService(provider, getDeviceId());
const checkpointService = new CheckpointService();

export const useSyncStore = create<SyncStoreState>((set, get) => ({
    isSyncing: false,
    syncStatus: 'idle',
    lastSyncTime: null,
    errorMessage: null,
    isAuthorized: false,
    checkpoints: [],

    checkAuthorization: async () => {
        // This is a bit tricky as GoogleDriveProvider authorization check might need to be async or event based
        // For now, we rely on the provider's internal state which is sync (isAuthorized())
        // but often we need to try an initial silent sign-in.
        // The provider doesn't strictly support silent sign-in yet, assuming user must click.
        set({ isAuthorized: provider.isAuthorized() });
    },

    authorize: async () => {
        try {
            await provider.authorize();
            set({ isAuthorized: true, errorMessage: null });
        } catch (error) {
            console.error(error);
            set({ errorMessage: 'Failed to authorize with Google Drive' });
        }
    },

    disconnect: async () => {
        await provider.signOut();
        set({ isAuthorized: false });
    },

    sync: async () => {
        const { isSyncing } = get();
        if (isSyncing) return;

        set({ isSyncing: true, syncStatus: 'idle', errorMessage: null });

        try {
            // Auto-checkpoint before sync (as per plan)
            await get().createCheckpoint('Pre-sync auto checkpoint');

            await syncService.sync();
            set({
                isSyncing: false,
                syncStatus: 'success',
                lastSyncTime: Date.now()
            });
        } catch (error) {
            console.error(error);
            set({
                isSyncing: false,
                syncStatus: 'error',
                errorMessage: error instanceof Error ? error.message : 'Unknown sync error'
            });
        }
    },

    fetchCheckpoints: async () => {
        try {
            const checkpoints = await checkpointService.getCheckpoints();
            // Sort desc
            checkpoints.sort((a, b) => b.timestamp - a.timestamp);
            set({ checkpoints });
        } catch (error) {
            console.error('Failed to fetch checkpoints', error);
        }
    },

    createCheckpoint: async (reason: string) => {
        try {
            await checkpointService.createCheckpoint(reason);
            await get().fetchCheckpoints();
        } catch (error) {
            console.error('Failed to create checkpoint', error);
        }
    },

    restoreCheckpoint: async (timestamp: number) => {
        try {
            await checkpointService.restoreCheckpoint(timestamp);
            // After restore, we might want to reload or update other stores.
            // For now, let the caller handle reloading if needed, but we can refetch checkpoints.
            await get().fetchCheckpoints();
        } catch (error) {
            console.error('Failed to restore checkpoint', error);
            throw error; // Let UI handle alert
        }
    }
}));

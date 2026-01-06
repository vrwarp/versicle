import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface SyncStore {
    // Credentials
    googleClientId: string;
    googleApiKey: string;
    setGoogleCredentials: (clientId: string, apiKey: string) => void;

    // Status
    isSyncEnabled: boolean;
    setSyncEnabled: (enabled: boolean) => void;

    // UI State (ephemeral)
    lastSyncTime: number | null;
    setLastSyncTime: (time: number) => void;
}

export const useSyncStore = create<SyncStore>()(
    persist(
        (set) => ({
            googleClientId: '',
            googleApiKey: '',
            setGoogleCredentials: (clientId, apiKey) => set({ googleClientId: clientId, googleApiKey: apiKey }),

            isSyncEnabled: false,
            setSyncEnabled: (enabled) => set({ isSyncEnabled: enabled }),

            lastSyncTime: null,
            setLastSyncTime: (time) => set({ lastSyncTime: time }),
        }),
        {
            name: 'sync-storage',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                googleClientId: state.googleClientId,
                googleApiKey: state.googleApiKey,
                isSyncEnabled: state.isSyncEnabled,
                lastSyncTime: state.lastSyncTime // Persist last sync time so it survives reload
            }),
        }
    )
);

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { FirestoreSyncStatus, FirebaseAuthStatus } from '../FirestoreSyncManager';

/**
 * Sync provider types
 */
export type SyncProvider = 'none' | 'google-drive' | 'firebase';

/**
 * Firebase configuration stored in settings
 */
export interface FirebaseConfigSettings {
    apiKey: string;
    authDomain: string;
    projectId: string;
    appId: string;
}

interface SyncStore {
    // === Provider Selection ===
    /** Which sync provider is active */
    syncProvider: SyncProvider;
    setSyncProvider: (provider: SyncProvider) => void;

    // === Google Drive Credentials (Legacy) ===
    googleClientId: string;
    googleApiKey: string;
    setGoogleCredentials: (clientId: string, apiKey: string) => void;

    // === Google Drive Status (Legacy) ===
    isSyncEnabled: boolean;
    setSyncEnabled: (enabled: boolean) => void;

    // === Firebase Configuration ===
    /** Firebase config (API key, project ID, etc.) */
    firebaseConfig: FirebaseConfigSettings;
    setFirebaseConfig: (config: Partial<FirebaseConfigSettings>) => void;

    // === Firebase/Firestore Status ===
    /** Whether Firebase sync is enabled */
    firebaseEnabled: boolean;
    setFirebaseEnabled: (enabled: boolean) => void;

    /** Current Firestore sync connection status */
    firestoreStatus: FirestoreSyncStatus;
    setFirestoreStatus: (status: FirestoreSyncStatus) => void;

    /** Firebase authentication status */
    firebaseAuthStatus: FirebaseAuthStatus;
    setFirebaseAuthStatus: (status: FirebaseAuthStatus) => void;

    /** Email of the signed-in Firebase user */
    firebaseUserEmail: string | null;
    setFirebaseUserEmail: (email: string | null) => void;

    // === Shared State ===
    /** Timestamp of last successful sync */
    lastSyncTime: number | null;
    setLastSyncTime: (time: number) => void;
}

const defaultFirebaseConfig: FirebaseConfigSettings = {
    apiKey: '',
    authDomain: '',
    projectId: '',
    appId: ''
};

export const useSyncStore = create<SyncStore>()(
    persist(
        (set) => ({
            // Provider selection
            syncProvider: 'none',
            setSyncProvider: (provider) => set({ syncProvider: provider }),

            // Google Drive (Legacy)
            googleClientId: '',
            googleApiKey: '',
            setGoogleCredentials: (clientId, apiKey) => set({ googleClientId: clientId, googleApiKey: apiKey }),

            isSyncEnabled: false,
            setSyncEnabled: (enabled) => set({ isSyncEnabled: enabled }),

            // Firebase Configuration
            firebaseConfig: defaultFirebaseConfig,
            setFirebaseConfig: (config) => set((state) => ({
                firebaseConfig: { ...state.firebaseConfig, ...config }
            })),

            // Firebase/Firestore
            firebaseEnabled: false,
            setFirebaseEnabled: (enabled) => set({ firebaseEnabled: enabled }),

            firestoreStatus: 'disconnected',
            setFirestoreStatus: (status) => set({ firestoreStatus: status }),

            firebaseAuthStatus: 'loading',
            setFirebaseAuthStatus: (status) => set({ firebaseAuthStatus: status }),

            firebaseUserEmail: null,
            setFirebaseUserEmail: (email) => set({ firebaseUserEmail: email }),

            // Shared
            lastSyncTime: null,
            setLastSyncTime: (time) => set({ lastSyncTime: time }),
        }),
        {
            name: 'sync-storage',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                // Persist provider selection
                syncProvider: state.syncProvider,

                // Persist Google Drive settings
                googleClientId: state.googleClientId,
                googleApiKey: state.googleApiKey,
                isSyncEnabled: state.isSyncEnabled,

                // Persist Firebase configuration
                firebaseConfig: state.firebaseConfig,
                firebaseEnabled: state.firebaseEnabled,

                // Persist shared settings
                lastSyncTime: state.lastSyncTime,
            }),
        }
    )
);


import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { FirestoreSyncStatus, FirebaseAuthStatus } from '../FirestoreSyncManager';

/**
 * Firebase configuration stored in settings
 */
export interface FirebaseConfigSettings {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
    measurementId?: string;
}

interface SyncStore {
    // === Onboarding ===
    hasCompletedOnboarding: boolean;
    setHasCompletedOnboarding: (completed: boolean) => void;

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

    // === Workspace ===
    /** Active workspace ID (null = legacy default path) */
    activeWorkspaceId: string | null;
    setActiveWorkspaceId: (id: string | null) => void;

    // === Shared State ===
    /** Timestamp of last successful sync */
    lastSyncTime: number | null;
    setLastSyncTime: (time: number) => void;
}

const defaultFirebaseConfig: FirebaseConfigSettings = {
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: ''
};

export const useSyncStore = create<SyncStore>()(
    persist(
        (set) => ({
            // Onboarding
            hasCompletedOnboarding: false,
            setHasCompletedOnboarding: (completed) => set({ hasCompletedOnboarding: completed }),

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

            // Workspace
            activeWorkspaceId: null,
            setActiveWorkspaceId: (id) => set({ activeWorkspaceId: id }),

            // Shared
            lastSyncTime: null,
            setLastSyncTime: (time) => set({ lastSyncTime: time }),
        }),
        {
            name: 'sync-storage',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                // Persist onboarding
                hasCompletedOnboarding: state.hasCompletedOnboarding,

                // Persist Firebase configuration
                firebaseConfig: state.firebaseConfig,
                firebaseEnabled: state.firebaseEnabled,

                // Persist workspace
                activeWorkspaceId: state.activeWorkspaceId,

                // Persist shared settings
                lastSyncTime: state.lastSyncTime,
            }),
        }
    )
);


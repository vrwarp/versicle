import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { FirestoreSyncStatus, FirebaseAuthStatus } from '~types/sync';

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
    /**
     * Stamp the last committed save. COALESCED to
     * {@link LAST_SYNC_COALESCE_MS}: this store is persist-wrapped, and zustand
     * persist re-serializes the whole partialized slice and calls
     * `localStorage.setItem` SYNCHRONOUSLY after every `set` — so an unfiltered
     * stamp turned each committed save (wireSyncEvents' `flushed` handler) into
     * a blocking main-thread storage write. The only reader renders it through
     * `formatTime` (short time — minutes), so the dropped sub-second precision
     * is not observable.
     */
    setLastSyncTime: (time: number) => void;
}

/**
 * How close two committed-save timestamps have to be for the second to be
 * dropped. One second: far below the minute granularity the sync-pulse tooltip
 * renders, far above the burst rate of a flushing save queue.
 */
const LAST_SYNC_COALESCE_MS = 1000;

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
        (set, get) => ({
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
            setLastSyncTime: (time) => {
                const previous = get().lastSyncTime;
                // Skip the `set` ENTIRELY (not just the state change): persist
                // writes after every set call, including one that returns an
                // identical state.
                if (previous !== null && Math.abs(time - previous) < LAST_SYNC_COALESCE_MS) return;
                set({ lastSyncTime: time });
            },
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


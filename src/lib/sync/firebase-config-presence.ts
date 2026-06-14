/**
 * Firebase config PRESENCE — the SDK-free half of firebase-config (Phase 8
 * §A first-use splitting): "is a config stored and complete?" must be
 * answerable from the boot path WITHOUT pulling firebase/app+auth+firestore
 * into the entry chunk (check 4 of scripts/check-worker-chunk.mjs asserts
 * the emitted artifact). firebase-config.ts re-exports these, so SDK-side
 * consumers keep one import.
 */
import { useSyncStore } from '@store/useSyncStore';
import type { FirebaseConfigSettings } from '@store/useSyncStore';

export type { FirebaseConfigSettings };

/**
 * Firebase configuration interface (re-export for convenience)
 */
export type FirebaseConfig = FirebaseConfigSettings;

/**
 * Get Firebase config from the sync store
 */
export const getFirebaseConfig = (): FirebaseConfig | null => {
    const { firebaseConfig } = useSyncStore.getState();

    // All values are required
    if (!firebaseConfig.apiKey || !firebaseConfig.authDomain ||
        !firebaseConfig.projectId || !firebaseConfig.appId) {
        return null;
    }

    // Use local proxy if in dev mode OR if explicitly configured (e.g. for Docker/Nginx)
    // explicitly check for window availability for SSR safety
    const useProxy = import.meta.env.DEV || import.meta.env.VITE_AUTH_USE_PROXY === 'true';

    if (useProxy && typeof window !== 'undefined') {
        return {
            ...firebaseConfig,
            authDomain: window.location.host // e.g. "localhost:5173" or "my-app.com"
        };
    }

    return firebaseConfig;
};

/**
 * Check if Firebase is configured (all required fields present)
 */
export const isFirebaseConfigured = (): boolean => {
    return getFirebaseConfig() !== null;
};

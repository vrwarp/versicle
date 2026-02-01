/**
 * Firebase Configuration
 * 
 * Initializes Firebase app, auth, and firestore for cloud sync.
 * Configuration values are loaded from the sync settings store (UI-configurable).
 */
import { initializeApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import type { Auth } from 'firebase/auth';
import {
    getFirestore,
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { useSyncStore } from './hooks/useSyncStore';
import { useToastStore } from '../../store/useToastStore';
import type { FirebaseConfigSettings } from './hooks/useSyncStore';

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

    return firebaseConfig;
};

/**
 * Check if Firebase config has all required fields filled
 */
export const isFirebaseConfigValid = (config: FirebaseConfigSettings): boolean => {
    return !!(config.apiKey && config.authDomain && config.projectId && config.appId);
};

// Lazy initialization - only create instances when needed
let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let firestore: Firestore | null = null;
let googleProvider: GoogleAuthProvider | null = null;
let currentConfigHash: string | null = null;

/**
 * Generate a simple hash of config to detect changes
 */
const getConfigHash = (config: FirebaseConfigSettings): string => {
    return `${config.apiKey}|${config.authDomain}|${config.projectId}|${config.appId}`;
};

/**
 * Reset Firebase instances (used when config changes)
 */
export const resetFirebase = (): void => {
    app = null;
    auth = null;
    firestore = null;
    googleProvider = null;
    currentConfigHash = null;
    console.log('[Firebase] Reset - will reinitialize on next use');
};

/**
 * Initialize Firebase app and services.
 * Called lazily when Firebase features are first needed.
 * 
 * @returns true if initialization succeeded, false otherwise
 */
export const initializeFirebase = (): boolean => {
    const config = getFirebaseConfig();
    if (!config) return false;

    const newConfigHash = getConfigHash(config);

    // If already initialized with same config, skip
    if (app && currentConfigHash === newConfigHash) {
        return true;
    }

    // If config changed, reset first
    if (app && currentConfigHash !== newConfigHash) {
        console.log('[Firebase] Config changed, reinitializing...');
        resetFirebase();
    }

    try {
        app = initializeApp(config);
        auth = getAuth(app);

        // Try to enable offline persistence
        try {
            firestore = initializeFirestore(app, {
                localCache: persistentLocalCache({
                    tabManager: persistentMultipleTabManager()
                })
            });
            console.log('[Firebase] Offline persistence enabled');
        } catch (err) {
            console.warn('[Firebase] Persistence failed, falling back to default:', err);
            useToastStore.getState().showToast('Offline sync unavailable (persistence failed)', 'error');
            firestore = getFirestore(app);
        }

        googleProvider = new GoogleAuthProvider();
        currentConfigHash = newConfigHash;

        console.log('[Firebase] Initialized successfully');
        return true;
    } catch (error) {
        console.error('[Firebase] Initialization failed:', error);
        return false;
    }
};

/**
 * Get the Firebase app instance (initializes if needed)
 */
export const getFirebaseApp = (): FirebaseApp | null => {
    if (!app) initializeFirebase();
    return app;
};

/**
 * Get the Firebase Auth instance (initializes if needed)
 */
export const getFirebaseAuth = (): Auth | null => {
    if (!auth) initializeFirebase();
    return auth;
};

/**
 * Get the Firestore instance (initializes if needed)
 */
export const getFirestoreDb = (): Firestore | null => {
    if (!firestore) initializeFirebase();
    return firestore;
};

/**
 * Get the Google Auth Provider
 */
export const getGoogleProvider = (): GoogleAuthProvider | null => {
    if (!googleProvider) initializeFirebase();
    return googleProvider;
};

/**
 * Check if Firebase is configured (all required fields present)
 */
export const isFirebaseConfigured = (): boolean => {
    return getFirebaseConfig() !== null;
};

/**
 * Check if Firebase is initialized and ready
 */
export const isFirebaseInitialized = (): boolean => {
    return app !== null && auth !== null && firestore !== null;
};


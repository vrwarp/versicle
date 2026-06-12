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
import { getSyncEventBus } from '@domains/sync/events';
import { createLogger } from '../logger';
// The SDK-free presence half lives in firebase-config-presence.ts (Phase 8
// §A: boot-path callers check "is a config stored?" without pulling the
// firebase SDK into the entry chunk). Re-exported here so SDK-side
// consumers keep one import — including the store edge: this module's
// only store dependency now routes through the presence module (the
// lib-not-to-store ratchet stays at its pre-split count).
import { getFirebaseConfig } from './firebase-config-presence';
import type { FirebaseConfigSettings } from './firebase-config-presence';
export { getFirebaseConfig, isFirebaseConfigValid, isFirebaseConfigured } from './firebase-config-presence';
export type { FirebaseConfig } from './firebase-config-presence';

const logger = createLogger('Firebase');

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
    logger.info('Reset - will reinitialize on next use');
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
        logger.info('Config changed, reinitializing...');
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
            logger.info('Offline persistence enabled');
        } catch (err) {
            logger.warn('Persistence failed, falling back to default:', err);
            getSyncEventBus().emit({ type: 'local-persistence-unavailable' });
            firestore = getFirestore(app);
        }

        googleProvider = new GoogleAuthProvider();
        currentConfigHash = newConfigHash;

        logger.info('Initialized successfully');
        return true;
    } catch (error) {
        logger.error('Initialization failed:', error);
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
 * Check if Firebase is initialized and ready
 */
export const isFirebaseInitialized = (): boolean => {
    return app !== null && auth !== null && firestore !== null;
};


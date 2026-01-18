/**
 * Firestore Sync Manager
 * 
 * Manages y-fire provider for real-time cloud sync via Firestore.
 * Acts as a secondary "Cloud Overlay" - y-indexeddb remains primary.
 * 
 * Architecture:
 * - y-indexeddb: Primary (always active, source of truth for offline)
 * - y-fire: Secondary (active only when authenticated)
 */
import { FireProvider } from 'y-cinder';
import type { User } from 'firebase/auth';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import type { FirebaseApp } from 'firebase/app';
import { yDoc } from '../../store/yjs-provider';

import {
    getFirebaseApp,
    getFirebaseAuth,
    getGoogleProvider,
    isFirebaseConfigured,
    initializeFirebase
} from './firebase-config';
import { MockFireProvider } from './drivers/MockFireProvider';


// Status types for the sync manager
export type FirestoreSyncStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type FirebaseAuthStatus = 'signed-out' | 'signed-in' | 'loading';

// Event callback types
type StatusChangeCallback = (status: FirestoreSyncStatus) => void;
type AuthChangeCallback = (status: FirebaseAuthStatus, user: User | null) => void;

/**
 * FirestoreSyncManager Configuration
 */
interface FirestoreSyncConfig {
    /**
     * Maximum time to wait before flushing updates to Firestore.
     * Higher values reduce Firestore writes (cost saving) but increase sync delay.
     * Default: 2000ms as recommended in crdt-firestore.md
     */
    maxWaitFirestoreTime?: number;

    /**
     * Maximum number of updates to batch before forcing a flush.
     * Default: 50
     */
    maxUpdatesThreshold?: number;
}

const DEFAULT_CONFIG: Required<FirestoreSyncConfig> = {
    maxWaitFirestoreTime: 2000,
    maxUpdatesThreshold: 50
};

/**
 * Singleton service managing Firestore sync via y-fire.
 */
class FirestoreSyncManager {
    private static instance: FirestoreSyncManager | null = null;

    private fireProvider: FireProvider | null = null;
    private config: Required<FirestoreSyncConfig>;
    private currentUser: User | null = null;
    private status: FirestoreSyncStatus = 'disconnected';
    private authStatus: FirebaseAuthStatus = 'loading';
    private unsubscribeAuth: (() => void) | null = null;
    private currentApp: FirebaseApp | null = null;

    // Callbacks for status changes
    private statusCallbacks: Set<StatusChangeCallback> = new Set();
    private authCallbacks: Set<AuthChangeCallback> = new Set();

    private constructor(config: FirestoreSyncConfig = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Get the singleton instance
     */
    static getInstance(config?: FirestoreSyncConfig): FirestoreSyncManager {
        if (!FirestoreSyncManager.instance) {
            FirestoreSyncManager.instance = new FirestoreSyncManager(config);
        }
        return FirestoreSyncManager.instance;
    }

    /**
     * Reset the singleton (for testing)
     */
    static resetInstance(): void {
        if (FirestoreSyncManager.instance) {
            FirestoreSyncManager.instance.destroy();
            FirestoreSyncManager.instance = null;
        }
    }

    /**
     * Initialize the sync manager.
     * Sets up auth state listener and auto-connects when authenticated.
     */
    async initialize(): Promise<void> {
        // Support for Mock Firestore (Testing)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (typeof window !== 'undefined' && (window as any).__VERSICLE_MOCK_FIRESTORE__) {
            console.log('[FirestoreSync] Mock mode detected. Simulating auth and connection.');
            this.setAuthStatus('signed-in');
            // Simulate a mock user
            this.currentUser = { uid: 'mock-user', email: 'mock@example.com' } as User;
            this.connectFireProvider('mock-user');
            return;
        }

        if (!isFirebaseConfigured()) {
            console.warn('[FirestoreSync] Firebase not configured. Sync disabled.');
            this.setAuthStatus('signed-out');
            return;
        }

        if (!initializeFirebase()) {
            console.error('[FirestoreSync] Firebase initialization failed.');
            this.setAuthStatus('signed-out');
            return;
        }

        const auth = getFirebaseAuth();
        if (!auth) {
            console.error('[FirestoreSync] Firebase Auth not available.');
            this.setAuthStatus('signed-out');
            return;
        }

        // Set up auth state listener
        if (this.unsubscribeAuth) this.unsubscribeAuth();
        this.unsubscribeAuth = onAuthStateChanged(auth, (user) => {
            this.handleAuthStateChange(user);
        });

        console.log('[FirestoreSync] Manager initialized');
    }

    /**
     * Handle Firebase auth state changes
     */
    private handleAuthStateChange(user: User | null): void {
        this.currentUser = user;

        if (user) {
            console.log(`[FirestoreSync] User signed in: ${user.email}`);
            this.setAuthStatus('signed-in');
            this.connectFireProvider(user.uid);
        } else {
            console.log('[FirestoreSync] User signed out');
            this.setAuthStatus('signed-out');
            this.disconnectFireProvider();
        }
    }

    /**
     * Connect y-fire provider for the given user
     */
    private connectFireProvider(uid: string): void {
        if (this.fireProvider) {
            const currentApp = getFirebaseApp();
            if (currentApp !== this.currentApp) {
                console.log('[FirestoreSync] Firebase app changed, reconnecting...');
                this.disconnectFireProvider();
            } else {
                console.log('[FirestoreSync] Already connected, skipping');
                return;
            }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const isMock = typeof window !== 'undefined' && (window as any).__VERSICLE_MOCK_FIRESTORE__;

        let app = getFirebaseApp();
        if (!app) {
            if (isMock) {
                // Use dummy app for mock provider
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                app = {} as any;
            } else {
                console.error('[FirestoreSync] Firebase app not available');
                this.setStatus('error');
                return;
            }
        }

        this.setStatus('connecting');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const maxWaitTime = (typeof window !== 'undefined' && (window as any).__VERSICLE_FIRESTORE_DEBOUNCE_MS__) || this.config.maxWaitFirestoreTime;

        const providerConfig = {
            firebaseApp: app!,
            ydoc: yDoc,
            path: `users/${uid}/versicle/main`,
            maxWaitTime: maxWaitTime,
            maxUpdatesThreshold: this.config.maxUpdatesThreshold
        };

        try {
            // Use MockFireProvider for testing when flag is set
            if (typeof window !== 'undefined' && window.__VERSICLE_MOCK_FIRESTORE__) {
                console.log('[FirestoreSync] Using MockFireProvider (test mode)');
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                this.fireProvider = new MockFireProvider(providerConfig as any) as unknown as FireProvider;
            } else {
                this.fireProvider = new FireProvider(providerConfig);
            }
            this.currentApp = app;

            // y-fire connects automatically
            console.log(`[FirestoreSync] Connected to path: users/${uid}/versicle/main`);
            this.setStatus('connected');

        } catch (error) {
            console.error('[FirestoreSync] Failed to connect:', error);
            this.setStatus('error');
        }
    }

    /**
     * Disconnect y-fire provider
     */
    private disconnectFireProvider(): void {
        if (this.fireProvider) {
            try {
                this.fireProvider.destroy();
                console.log('[FirestoreSync] Provider destroyed');
            } catch (error) {
                console.error('[FirestoreSync] Error destroying provider:', error);
            }
            this.fireProvider = null;
        }
        this.setStatus('disconnected');
    }

    /**
     * Sign in with Google
     */
    async signIn(): Promise<void> {
        const auth = getFirebaseAuth();
        const provider = getGoogleProvider();

        if (!auth || !provider) {
            throw new Error('Firebase Auth not initialized');
        }

        try {
            await signInWithPopup(auth, provider);
            // Auth state change handler will connect the provider
        } catch (error) {
            console.error('[FirestoreSync] Sign in failed:', error);
            throw error;
        }
    }

    /**
     * Sign out
     */
    async signOut(): Promise<void> {
        const auth = getFirebaseAuth();
        if (!auth) {
            throw new Error('Firebase Auth not initialized');
        }

        try {
            await signOut(auth);
            // Auth state change handler will disconnect the provider
        } catch (error) {
            console.error('[FirestoreSync] Sign out failed:', error);
            throw error;
        }
    }

    /**
     * Destroy the sync manager and clean up resources
     */
    destroy(): void {
        this.disconnectFireProvider();

        if (this.unsubscribeAuth) {
            this.unsubscribeAuth();
            this.unsubscribeAuth = null;
        }

        this.statusCallbacks.clear();
        this.authCallbacks.clear();

        console.log('[FirestoreSync] Manager destroyed');
    }

    // --- Status Management ---

    private setStatus(status: FirestoreSyncStatus): void {
        this.status = status;
        this.statusCallbacks.forEach(cb => cb(status));
    }

    private setAuthStatus(status: FirebaseAuthStatus): void {
        this.authStatus = status;
        this.authCallbacks.forEach(cb => cb(status, this.currentUser));
    }

    /**
     * Subscribe to sync status changes
     */
    onStatusChange(callback: StatusChangeCallback): () => void {
        this.statusCallbacks.add(callback);
        // Immediately call with current status
        callback(this.status);
        return () => this.statusCallbacks.delete(callback);
    }

    /**
     * Subscribe to auth status changes
     */
    onAuthChange(callback: AuthChangeCallback): () => void {
        this.authCallbacks.add(callback);
        // Immediately call with current status
        callback(this.authStatus, this.currentUser);
        return () => this.authCallbacks.delete(callback);
    }

    // --- Getters ---

    getStatus(): FirestoreSyncStatus {
        return this.status;
    }

    getAuthStatus(): FirebaseAuthStatus {
        return this.authStatus;
    }

    getCurrentUser(): User | null {
        return this.currentUser;
    }

    isConnected(): boolean {
        return this.status === 'connected';
    }

    isSignedIn(): boolean {
        return this.authStatus === 'signed-in';
    }
}

// Export the singleton getter
export const getFirestoreSyncManager = (config?: FirestoreSyncConfig): FirestoreSyncManager => {
    return FirestoreSyncManager.getInstance(config);
};

// Export for testing
export { FirestoreSyncManager };

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
import { onAuthStateChanged, getRedirectResult } from 'firebase/auth';
import type { FirebaseApp } from 'firebase/app';
import { yDoc } from '../../store/yjs-provider';
import { CheckpointService } from './CheckpointService';
import * as Y from 'yjs';
import { useBookStore } from '../../store/useBookStore';
import { doc, getDoc, collection, getDocs, query, limit } from 'firebase/firestore';

import {
    getFirebaseApp,
    getFirebaseAuth,
    isFirebaseConfigured,
    initializeFirebase,
    getFirestoreDb
} from './firebase-config';
import { MockFireProvider } from './drivers/MockFireProvider';
import { createLogger } from '../logger';
import { signInWithGoogle, signOutWithGoogle } from './auth-helper';
import { useToastStore } from '../../store/useToastStore';
import { useSyncStore } from './hooks/useSyncStore';

const logger = createLogger('FirestoreSync');


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
        const w = typeof window !== 'undefined' ? (window as any) : null;
        if (w && w.__VERSICLE_MOCK_FIRESTORE__) {
            logger.info('Mock mode detected. Simulating auth and connection.');
            this.setAuthStatus('signed-in');

            const mockUid = w.__VERSICLE_MOCK_USER_ID__ || 'mock-user';

            // Simulate a mock user
            this.currentUser = { uid: mockUid, email: `${mockUid}@example.com` } as User;
            this.connectFireProvider(mockUid);
            return;
        }

        if (!isFirebaseConfigured()) {
            logger.warn('Firebase not configured. Sync disabled.');
            this.setAuthStatus('signed-out');
            return;
        }

        if (!initializeFirebase()) {
            logger.error('Firebase initialization failed.');
            this.setAuthStatus('signed-out');
            return;
        }

        const auth = getFirebaseAuth();
        if (!auth) {
            logger.error('Firebase Auth not available.');
            this.setAuthStatus('signed-out');
            return;
        }

        // Check if we just returned from a Redirect
        try {
            const result = await getRedirectResult(auth);
            if (result && result.user) {
                logger.info('Auth', 'Successfully returned from redirect flow', result.user.uid);
                useToastStore.getState().showToast(`Signed in as ${result.user.email}`, 'success');
                // Note: handleAuthStateChange will be called by onAuthStateChanged and update useSyncStore
            }
        } catch (error) {
            logger.error('Redirect login failed', error);
            this.setStatus('error');
        }

        // Set up auth state listener
        if (this.unsubscribeAuth) this.unsubscribeAuth();
        this.unsubscribeAuth = onAuthStateChanged(auth, (user) => {
            this.handleAuthStateChange(user);
        });

        logger.debug('Manager initialized');
    }

    /**
     * Handle Firebase auth state changes
     */
    private handleAuthStateChange(user: User | null): void {
        this.currentUser = user;

        // Always update the UI store directly
        const syncStore = useSyncStore.getState();

        if (user) {
            logger.info(`User signed in: ${user.email}`);
            this.setAuthStatus('signed-in');
            syncStore.setFirebaseEnabled(true);
            syncStore.setFirebaseAuthStatus('signed-in');
            syncStore.setFirebaseUserEmail(user.email ?? null);
            this.connectFireProvider(user.uid);
        } else {
            logger.info('User signed out');
            this.setAuthStatus('signed-out');
            syncStore.setFirebaseAuthStatus('signed-out');
            syncStore.setFirebaseUserEmail(null);
            this.disconnectFireProvider();
        }
    }

    /**
     * Connect y-fire provider for the given user
     */
    private async connectFireProvider(uid: string): Promise<void> {
        if (this.fireProvider) {
            const currentApp = getFirebaseApp();
            if (currentApp !== this.currentApp) {
                logger.debug('Firebase app changed, reconnecting...');
                this.disconnectFireProvider();
            } else {
                logger.debug('Already connected, skipping');
                return;
            }
        }

        // Create a safety checkpoint before connecting (which triggers download)
        try {
            logger.debug('Creating pre-sync checkpoint (if needed)...');
            // Limit to once per 24 hours (86400000 ms)
            const id = await CheckpointService.createAutomaticCheckpoint('pre-sync', 86400000);
            if (id) {
                logger.info(`Created pre-sync checkpoint #${id}`);
            } else {
                logger.debug('Skipped pre-sync checkpoint (recent one exists)');
            }
        } catch (error) {
            logger.warn('Failed to create pre-sync checkpoint', error);
            // Non-blocking: proceed with sync even if checkpoint fails
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
                logger.error('Firebase app not available');
                this.setStatus('error');
                return;
            }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const maxWaitTime = (typeof window !== 'undefined' && (window as any).__VERSICLE_FIRESTORE_DEBOUNCE_MS__) || this.config.maxWaitFirestoreTime;

        const isDev = import.meta.env.DEV;
        const path = isDev ? `users/${uid}/versicle/dev` : `users/${uid}/versicle/main`;

        const isCleanClient = Object.keys(useBookStore.getState().books || {}).length === 0;

        if (isCleanClient) {
            logger.info('Clean client detected. Checking for cloud data...');
            this.performCleanSync(path, maxWaitTime, app!, isMock).catch(err => {
                logger.error('Clean sync failed:', err);
                this.setStatus('error');
            });
        } else {
            this.connectFireProviderNormal(path, maxWaitTime, app!, isMock);
        }
    }

    private async performCleanSync(path: string, maxWaitTime: number, app: FirebaseApp, isMock: boolean): Promise<void> {
        this.setStatus('connecting');
        const toast = useToastStore.getState().showToast;

        try {
            if (!isMock) {
                const db = getFirestoreDb();
                if (!db) throw new Error('Firestore not initialized');

                // Check main document for snapshot/state vector
                const docRef = doc(db, path);
                const docSnap = await getDoc(docRef);
                const hasMainDocData = docSnap.exists() && (
                    docSnap.data()?.content ||
                    docSnap.data()?.stateVector ||
                    docSnap.data()?.snapshotBase64
                );

                // Check updates collection in case compaction hasn't run yet
                const updatesQ = query(collection(db, path, 'updates'), limit(1));
                const updatesSnap = await getDocs(updatesQ);

                if (!hasMainDocData && updatesSnap.empty) {
                    logger.info('No cloud data found. Client is officially the first device.');
                    this.connectFireProviderNormal(path, maxWaitTime, app, isMock);
                    return;
                }
            } else {
                const mockDataStr = localStorage.getItem('versicle_mock_firestore_snapshot');
                if (!mockDataStr) {
                    logger.info('[Mock] No cloud data found. Client is officially the first device.');
                    this.connectFireProviderNormal(path, maxWaitTime, app, isMock);
                    return;
                }
                try {
                    const mockData = JSON.parse(mockDataStr);
                    if (!mockData[path] || !mockData[path].snapshotBase64) {
                        logger.info('[Mock] No cloud data found for path. Client is explicitly clean.');
                        this.connectFireProviderNormal(path, maxWaitTime, app, isMock);
                        return;
                    }
                } catch (e) {
                    logger.error('Failed to parse mock data', e);
                }
            }

            logger.info('Cloud data found. Initiating temporary Y.Doc sync...');
            toast('Syncing library from cloud...', 'info');

            const tempDoc = new Y.Doc();

            await new Promise<void>((resolve) => {
                let resolved = false;

                const timeout = setTimeout(() => {
                    if (!resolved) {
                        logger.warn('Clean sync timeout reached. Proceeding.');
                        resolved = true;
                        resolve();
                    }
                }, 8000);

                tempDoc.on('update', () => {
                    if (!resolved) {
                        logger.info('Received cloud data chunk into tempDoc.');
                        setTimeout(() => {
                            if (!resolved) {
                                clearTimeout(timeout);
                                resolved = true;
                                resolve();
                            }
                        }, 1000);
                    }
                });

                const providerConfig = {
                    firebaseApp: app,
                    ydoc: tempDoc,
                    path,
                    maxWaitTime: maxWaitTime,
                    maxUpdatesThreshold: this.config.maxUpdatesThreshold
                };

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                let tempProvider: any = null;
                try {
                    if (isMock) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        tempProvider = new MockFireProvider(providerConfig as any);
                    } else {
                        tempProvider = new FireProvider(providerConfig);
                    }
                } catch (e) {
                    logger.error('Failed to connect temp provider:', e);
                    if (!resolved) {
                        clearTimeout(timeout);
                        resolved = true;
                        resolve();
                    }
                }

                // Expose to outer scope for cleanup if it doesn't resolve inside
                if (tempProvider) {
                    // We just let it load. It will emit 'update' on tempDoc.
                    // Cleanup is handled after Promise resolves.
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (tempDoc as any)._tempProvider = tempProvider;
                }
            });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const tempProvider = (tempDoc as any)._tempProvider;
            if (tempProvider) {
                try {
                    tempProvider.destroy();
                } catch (e) {
                    logger.error('Error destroying temporary provider', e);
                }
            }
            logger.info('Applying downloaded cloud data to main Y.Doc...');
            const stateVector = Y.encodeStateAsUpdate(tempDoc);
            Y.applyUpdate(yDoc, stateVector);

            logger.info('Clean sync complete. Connecting main provider...');
            toast('Sync complete!', 'success');

            // Connect the main provider now that the initial load is done
            this.connectFireProviderNormal(path, maxWaitTime, app, isMock);

        } catch (error) {
            logger.error('Failed clean sync:', error);
            this.setStatus('error');
            toast('Failed to sync. Please try again.', 'error');
        }
    }

    private connectFireProviderNormal(path: string, maxWaitTime: number, app: FirebaseApp, isMock: boolean): void {
        this.setStatus('connecting');

        const providerConfig = {
            firebaseApp: app,
            ydoc: yDoc,
            path,
            maxWaitTime: maxWaitTime,
            maxUpdatesThreshold: this.config.maxUpdatesThreshold
        };

        try {
            // Use MockFireProvider for testing when flag is set
            if (isMock) {
                logger.debug('Using MockFireProvider (test mode)');
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                this.fireProvider = new MockFireProvider(providerConfig as any) as unknown as FireProvider;
            } else {
                this.fireProvider = new FireProvider(providerConfig);
            }
            this.currentApp = app;

            // Setup new y-cinder error event listeners
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.fireProvider.on('connection-error', (event: any) => {
                logger.error('Firestore connection error:', event);
                this.setStatus('error');
            });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.fireProvider.on('sync-failure', (error: any) => {
                logger.error('Firestore sync failure after max retries:', error);
                this.setStatus('error');
                useToastStore.getState().showToast('Sync failed after multiple attempts. Please check your connection.', 'error', 5000);
            });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.fireProvider.on('save-rejected', (event: any) => {
                logger.error('Firestore save rejected:', event);
                this.setStatus('error');

                if (event.code === 'document-too-large') {
                    useToastStore.getState().showToast(`Sync disabled: Document too large (${event.sizeBytes} bytes). Please export and clear data.`, 'error', 8000);
                } else if (event.code === 'max-retries-exceeded') {
                    useToastStore.getState().showToast('Sync save failed: Max retries exceeded. Check connection.', 'error', 5000);
                }
            });

            // y-fire connects automatically
            logger.info(`Connected to path: ${path}`);
            this.setStatus('connected');

        } catch (error) {
            logger.error('Failed to connect:', error);
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
                logger.debug('Provider destroyed');
            } catch (error) {
                logger.error('Error destroying provider:', error);
            }
            this.fireProvider = null;
        }
        this.setStatus('disconnected');
    }

    /**
     * Sign in with Google
     */
    async signIn(): Promise<void> {
        try {
            this.setAuthStatus('loading');
            const result = await signInWithGoogle();

            if (result) {
                // Native flow returns a credential
                logger.debug('Sign in returned credential (Native flow)');
            } else {
                // Web flow returns void (redirecting)
                logger.debug('Sign in redirected (Web flow)');
            }
        } catch (error) {
            logger.error('Sign in failed:', error);
            this.setAuthStatus('signed-out');
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
            await signOutWithGoogle(auth);
            // Auth state change handler will disconnect the provider
        } catch (error) {
            logger.error('Sign out failed:', error);
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

        logger.debug('Manager destroyed');
    }

    // --- Status Management ---

    private setStatus(status: FirestoreSyncStatus): void {
        this.status = status;
        this.statusCallbacks.forEach(cb => cb(status));
        // Always update the UI store directly
        useSyncStore.getState().setFirestoreStatus(status);
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

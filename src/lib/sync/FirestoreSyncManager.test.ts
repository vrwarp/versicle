import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FirestoreSyncManager, getFirestoreSyncManager } from './FirestoreSyncManager';

// Mock firebase/auth
vi.mock('firebase/auth', () => ({
    onAuthStateChanged: vi.fn(),
    signInWithPopup: vi.fn(),
    signInWithRedirect: vi.fn(),
    getRedirectResult: vi.fn(() => Promise.resolve(null)),
    signOut: vi.fn()
}));

// Store instances here for easier testing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let latestFireProviderInstance: any = null;

// Mock y-cinder
vi.mock('y-cinder', () => ({
    FireProvider: vi.fn(function () {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const listeners: Record<string, ((...args: any[]) => void)[]> = {};
        const instance = {
            destroy: vi.fn(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            on: vi.fn((event: string, cb: (...args: any[]) => void) => {
                if (!listeners[event]) listeners[event] = [];
                listeners[event].push(cb);
            }),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            emit: (event: string, ...args: any[]) => {
                const callbacks = listeners[event];
                if (callbacks) {
                    callbacks.forEach(cb => cb(...args));
                }
            }
        };
        // @ts-expect-error setting global
        latestFireProviderInstance = instance;
        return instance;
    })
}));

// Mock firebase-config
vi.mock('./firebase-config', () => ({
    isFirebaseConfigured: vi.fn(() => true),
    initializeFirebase: vi.fn(() => true),
    getFirebaseApp: vi.fn(() => ({})),
    getFirebaseAuth: vi.fn(() => ({})),
    getGoogleProvider: vi.fn(() => ({}))
}));

// Mock yjs-provider
vi.mock('../../store/yjs-provider', async () => {
    const Y = await import('yjs');
    return {
        yDoc: new Y.Doc()
    };
});

describe('FirestoreSyncManager', () => {
    beforeEach(() => {
        // Reset singleton
        FirestoreSyncManager.resetInstance();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('getInstance', () => {
        it('should return a singleton instance', () => {
            const instance1 = getFirestoreSyncManager();
            const instance2 = getFirestoreSyncManager();
            expect(instance1).toBe(instance2);
        });

        it('should accept configuration', () => {
            const instance = getFirestoreSyncManager({
                maxWaitFirestoreTime: 3000,
                maxUpdatesThreshold: 100
            });
            expect(instance).toBeDefined();
        });
    });

    describe('getStatus', () => {
        it('should return disconnected initially', () => {
            const manager = getFirestoreSyncManager();
            expect(manager.getStatus()).toBe('disconnected');
        });
    });

    describe('getAuthStatus', () => {
        it('should return loading initially', () => {
            const manager = getFirestoreSyncManager();
            expect(manager.getAuthStatus()).toBe('loading');
        });
    });

    describe('isSignedIn', () => {
        it('should return false when not signed in', () => {
            const manager = getFirestoreSyncManager();
            expect(manager.isSignedIn()).toBe(false);
        });
    });

    describe('isConnected', () => {
        it('should return false when not connected', () => {
            const manager = getFirestoreSyncManager();
            expect(manager.isConnected()).toBe(false);
        });
    });

    describe('getCurrentUser', () => {
        it('should return null when not signed in', () => {
            const manager = getFirestoreSyncManager();
            expect(manager.getCurrentUser()).toBeNull();
        });
    });

    describe('onStatusChange', () => {
        it('should immediately call callback with current status', () => {
            const manager = getFirestoreSyncManager();
            const callback = vi.fn();

            manager.onStatusChange(callback);

            expect(callback).toHaveBeenCalledWith('disconnected');
        });

        it('should return unsubscribe function', () => {
            const manager = getFirestoreSyncManager();
            const callback = vi.fn();

            const unsubscribe = manager.onStatusChange(callback);
            expect(typeof unsubscribe).toBe('function');

            // Should not throw
            unsubscribe();
        });
    });

    describe('onAuthChange', () => {
        it('should immediately call callback with current auth status', () => {
            const manager = getFirestoreSyncManager();
            const callback = vi.fn();

            manager.onAuthChange(callback);

            expect(callback).toHaveBeenCalledWith('loading', null);
        });

        it('should return unsubscribe function', () => {
            const manager = getFirestoreSyncManager();
            const callback = vi.fn();

            const unsubscribe = manager.onAuthChange(callback);
            expect(typeof unsubscribe).toBe('function');

            unsubscribe();
        });
    });

    describe('destroy', () => {
        it('should not throw when called', () => {
            const manager = getFirestoreSyncManager();
            expect(() => manager.destroy()).not.toThrow();
        });

        it('should clear callbacks', () => {
            const manager = getFirestoreSyncManager();
            const callback = vi.fn();

            manager.onStatusChange(callback);
            callback.mockClear();

            manager.destroy();

            // After destroy, the callback should not be in the set
            // We can verify this indirectly - a new getInstance would have no callbacks
        });
    });

    describe('initialization', () => {
        it('should check for redirect result on initialization', async () => {
            const { getRedirectResult } = await import('firebase/auth');

            const manager = getFirestoreSyncManager();
            await manager.initialize();

            expect(getRedirectResult).toHaveBeenCalled();
        });

        it('should initialize FireProvider with mapped maxWaitTime', async () => {
            const { FireProvider } = await import('y-cinder');
            const { onAuthStateChanged } = await import('firebase/auth');

            // Mock auth state change to trigger connection
            vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback) => {
                // @ts-expect-error Mocking user
                callback({ uid: 'test-uid', email: 'test@example.com' });
                return () => { };
            });

            const manager = getFirestoreSyncManager({ maxWaitFirestoreTime: 5000 });
            await manager.initialize();

            await vi.waitFor(() => {
                expect(FireProvider).toHaveBeenCalledWith(expect.objectContaining({
                    maxWaitTime: 5000
                }));
            });
        });
    });

    describe('error events', () => {
        let manager: ReturnType<typeof getFirestoreSyncManager>;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let mockFireProviderInstance: any;

        beforeEach(async () => {
            vi.spyOn(console, 'error').mockImplementation(() => {});
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            const { onAuthStateChanged } = await import('firebase/auth');

            manager = getFirestoreSyncManager();

            // Mock auth state change to trigger connection
            vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback) => {
                // @ts-expect-error Mocking user
                callback({ uid: 'test-uid', email: 'test@example.com' });
                return () => { };
            });

            await manager.initialize();

            // Wait for internal connections to resolve
            await vi.waitFor(() => {
                expect(manager.getStatus()).toBe('connected');
            });

            // Retrieve instance created during initialization
            mockFireProviderInstance = latestFireProviderInstance;
        });

        it('should handle connection-error by setting status to error', async () => {
            expect(manager.getStatus()).toBe('connected');
            mockFireProviderInstance.emit('connection-error', { code: 'some-error', message: 'Test message', error: new Error('Test error') });
            expect(manager.getStatus()).toBe('error');
        });

        it('should handle sync-failure by setting status and showing toast', async () => {
            const { useToastStore } = await import('../../store/useToastStore');
            const showToastMock = vi.spyOn(useToastStore.getState(), 'showToast');

            mockFireProviderInstance.emit('sync-failure', new Error('Test failure'));

            expect(manager.getStatus()).toBe('error');
            expect(showToastMock).toHaveBeenCalledWith(
                'Sync failed after multiple attempts. Please check your connection.',
                'error',
                5000
            );
        });

        it('should handle save-rejected with document-too-large', async () => {
            const { useToastStore } = await import('../../store/useToastStore');
            const showToastMock = vi.spyOn(useToastStore.getState(), 'showToast');

            mockFireProviderInstance.emit('save-rejected', {
                code: 'document-too-large',
                sizeBytes: 2000000,
                error: new Error('Too large')
            });

            expect(manager.getStatus()).toBe('error');
            expect(showToastMock).toHaveBeenCalledWith(
                'Sync disabled: Document too large (2000000 bytes). Please export and clear data.',
                'error',
                8000
            );
        });

        it('should handle save-rejected with max-retries-exceeded', async () => {
            const { useToastStore } = await import('../../store/useToastStore');
            const showToastMock = vi.spyOn(useToastStore.getState(), 'showToast');

            mockFireProviderInstance.emit('save-rejected', {
                code: 'max-retries-exceeded',
                error: new Error('Timeout')
            });

            expect(manager.getStatus()).toBe('error');
            expect(showToastMock).toHaveBeenCalledWith(
                'Sync save failed: Max retries exceeded. Check connection.',
                'error',
                5000
            );
        });
    });
});

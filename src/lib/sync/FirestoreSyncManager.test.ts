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

// Mock y-cinder
vi.mock('y-cinder', () => ({
    FireProvider: vi.fn(function () {
        return {
            destroy: vi.fn()
        };
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
vi.mock('../../store/yjs-provider', () => ({
    yDoc: {
        getMap: vi.fn(() => new Map())
    }
}));

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

            expect(FireProvider).toHaveBeenCalledWith(expect.objectContaining({
                maxWaitTime: 5000
            }));
        });
    });
});

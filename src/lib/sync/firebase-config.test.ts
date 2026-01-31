import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initializeFirebase, resetFirebase } from './firebase-config';
import { useSyncStore } from './hooks/useSyncStore';

const {
    mockInitializeApp,
    mockGetAuth,
    mockGetFirestore,
    mockInitializeFirestore,
    mockPersistentLocalCache,
    mockPersistentMultipleTabManager
} = vi.hoisted(() => {
    return {
        mockInitializeApp: vi.fn(() => ({ name: '[DEFAULT]' })),
        mockGetAuth: vi.fn(() => ({})),
        mockGetFirestore: vi.fn(() => ({ type: 'firestore' })),
        mockInitializeFirestore: vi.fn(() => ({ type: 'firestore' })),
        mockPersistentLocalCache: vi.fn(),
        mockPersistentMultipleTabManager: vi.fn()
    }
});

vi.mock('firebase/app', () => ({
    initializeApp: mockInitializeApp,
}));

vi.mock('firebase/auth', () => ({
    getAuth: mockGetAuth,
    GoogleAuthProvider: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
    getFirestore: mockGetFirestore,
    initializeFirestore: mockInitializeFirestore,
    persistentLocalCache: mockPersistentLocalCache,
    persistentMultipleTabManager: mockPersistentMultipleTabManager,
}));

vi.mock('./hooks/useSyncStore', () => ({
    useSyncStore: {
        getState: vi.fn(),
    },
}));

describe('firebase-config', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetFirebase();
    });

    const validConfig = {
        apiKey: 'key',
        authDomain: 'domain',
        projectId: 'id',
        appId: 'appId',
    };

    it('should initialize without persistence by default', () => {
        vi.mocked(useSyncStore.getState).mockReturnValue({
            firebaseConfig: { ...validConfig, enablePersistence: false }
        } as any);

        const success = initializeFirebase();
        expect(success).toBe(true);
        expect(mockInitializeApp).toHaveBeenCalled();
        expect(mockInitializeFirestore).not.toHaveBeenCalled();
        expect(mockGetFirestore).toHaveBeenCalled();
    });

    it('should initialize with persistence when enabled', () => {
        vi.mocked(useSyncStore.getState).mockReturnValue({
            firebaseConfig: { ...validConfig, enablePersistence: true }
        } as any);

        const success = initializeFirebase();
        expect(success).toBe(true);
        expect(mockInitializeApp).toHaveBeenCalled();
        expect(mockInitializeFirestore).toHaveBeenCalled();
        expect(mockPersistentLocalCache).toHaveBeenCalled();
        expect(mockPersistentMultipleTabManager).toHaveBeenCalled();
    });

    it('should fail initialization if persistence is requested but fails', () => {
        vi.mocked(useSyncStore.getState).mockReturnValue({
            firebaseConfig: { ...validConfig, enablePersistence: true }
        } as any);

        mockInitializeFirestore.mockImplementationOnce(() => {
            throw new Error('Persistence failed');
        });

        const success = initializeFirebase();
        expect(success).toBe(false);
        expect(mockInitializeFirestore).toHaveBeenCalled();
        expect(mockGetFirestore).not.toHaveBeenCalled(); // No fallback
    });

    it('should not re-initialize if config has not changed', () => {
        vi.mocked(useSyncStore.getState).mockReturnValue({
            firebaseConfig: { ...validConfig, enablePersistence: false }
        } as any);

        // First init
        initializeFirebase();
        expect(mockInitializeApp).toHaveBeenCalledTimes(1);

        // Second init
        initializeFirebase();
        expect(mockInitializeApp).toHaveBeenCalledTimes(1); // No new call
    });

    it('should re-initialize if config changes (persistence toggle)', () => {
        // First init (persistence off)
        vi.mocked(useSyncStore.getState).mockReturnValue({
            firebaseConfig: { ...validConfig, enablePersistence: false }
        } as any);
        initializeFirebase();
        expect(mockInitializeApp).toHaveBeenCalledTimes(1);

        // Second init (persistence on)
        vi.mocked(useSyncStore.getState).mockReturnValue({
            firebaseConfig: { ...validConfig, enablePersistence: true }
        } as any);
        initializeFirebase();

        // Should have reset and called init again
        expect(mockInitializeApp).toHaveBeenCalledTimes(2);
        expect(mockInitializeFirestore).toHaveBeenCalled();
    });
});

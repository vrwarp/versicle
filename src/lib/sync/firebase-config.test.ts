import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initializeFirebase, resetFirebase } from './firebase-config';
import { initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { useToastStore } from '../../store/useToastStore';

// Mock firebase
vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({ name: '[DEFAULT]' })),
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  GoogleAuthProvider: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({ type: 'simple' })),
  initializeFirestore: vi.fn(() => ({ type: 'persistent' })),
  persistentLocalCache: vi.fn(),
  persistentMultipleTabManager: vi.fn(),
}));

// Mock stores
const showToastMock = vi.fn();

vi.mock('../../store/useToastStore', () => ({
  useToastStore: {
    getState: vi.fn(() => ({
      showToast: showToastMock,
    })),
  },
}));

vi.mock('./hooks/useSyncStore', () => ({
  useSyncStore: {
    getState: vi.fn(() => ({
      firebaseConfig: {
        apiKey: 'test-api-key',
        authDomain: 'test.firebaseapp.com',
        projectId: 'test-project',
        appId: 'test-app-id',
      },
    })),
  },
}));

describe('firebase-config initialization', () => {
  beforeEach(() => {
    resetFirebase();
    vi.clearAllMocks();
  });

  it('should initialize with offline persistence by default', () => {
    initializeFirebase();

    expect(initializeFirestore).toHaveBeenCalled();
    expect(persistentLocalCache).toHaveBeenCalled();
    expect(persistentMultipleTabManager).toHaveBeenCalled();
    // getFirestore might be called if we used it inside the catch block, but here we expect success
    expect(getFirestore).not.toHaveBeenCalled();
  });

  it('should fallback to getFirestore and show toast if persistence fails', () => {
    // Make initializeFirestore throw
    vi.mocked(initializeFirestore).mockImplementationOnce(() => {
      throw new Error('Persistence failed');
    });

    const result = initializeFirebase();

    // Should still succeed overall (return true) because of fallback
    expect(result).toBe(true);

    // Verify fallback
    expect(getFirestore).toHaveBeenCalled();

    // Verify toast
    expect(showToastMock).toHaveBeenCalledWith(
        expect.stringContaining('persistence'),
        'error'
    );
  });
});

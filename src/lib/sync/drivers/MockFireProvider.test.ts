import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { MockFireProvider } from './MockFireProvider';

// Mock localStorage for Node.js testing
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => { store[key] = value; },
        removeItem: (key: string) => { delete store[key]; },
        clear: () => { store = {}; }
    };
})();

Object.defineProperty(global, 'localStorage', { value: localStorageMock });

describe('MockFireProvider', () => {
    let ydoc: Y.Doc;
    let mockApp: unknown;

    beforeEach(() => {
        ydoc = new Y.Doc();
        mockApp = { name: 'mock-firebase-app' };
        localStorageMock.clear();
        MockFireProvider.setMockFailure(false);
        MockFireProvider.setSyncDelay(10); // Fast for tests
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('constructor', () => {
        it('should initialize with correct properties', () => {
            const provider = new MockFireProvider({
                firebaseApp: mockApp,
                ydoc,
                path: 'test/path'
            });

            expect(provider.doc).toBe(ydoc);
            expect(provider.documentPath).toBe('test/path');
            expect(provider.firebaseApp).toBe(mockApp);
            expect(provider.awareness).toBeDefined();

            provider.destroy();
        });

        it('should become ready after initialization', async () => {
            const provider = new MockFireProvider({
                firebaseApp: mockApp,
                ydoc,
                path: 'test/path'
            });

            expect(provider.ready).toBe(false);

            // Wait for async init
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(provider.ready).toBe(true);

            provider.destroy();
        });
    });

    describe('sync events', () => {
        it('should emit sync and synced events after initialization', async () => {
            const provider = new MockFireProvider({
                firebaseApp: mockApp,
                ydoc,
                path: 'test/path'
            });

            const syncHandler = vi.fn();
            const syncedHandler = vi.fn();

            provider.on('sync', syncHandler);
            provider.on('synced', syncedHandler);

            // Wait for async init
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(syncHandler).toHaveBeenCalledWith(true);
            expect(syncedHandler).toHaveBeenCalled();

            provider.destroy();
        });

        it('should emit connection-error when failure is set', async () => {
            MockFireProvider.setMockFailure(true);

            const provider = new MockFireProvider({
                firebaseApp: mockApp,
                ydoc,
                path: 'test/path'
            });

            const errorHandler = vi.fn();
            provider.on('connection-error', errorHandler);

            // Wait for async init
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(errorHandler).toHaveBeenCalled();
            expect(provider.ready).toBe(false);

            provider.destroy();
        });
    });

    describe('storage persistence', () => {
        it('should save Yjs updates to localStorage', async () => {
            const provider = new MockFireProvider({
                firebaseApp: mockApp,
                ydoc,
                path: 'users/test-uid/versicle/main'
            });

            // Wait for init
            await new Promise(resolve => setTimeout(resolve, 50));

            // Make a change
            const map = ydoc.getMap('test');
            map.set('key', 'value');

            // Wait for debounced save
            await new Promise(resolve => setTimeout(resolve, 150));

            const storageData = MockFireProvider.getMockStorageData();
            expect(storageData).not.toBeNull();
            expect(storageData?.['users/test-uid/versicle/main']).toBeDefined();
            expect(storageData?.['users/test-uid/versicle/main'].snapshotBase64).toBeDefined();

            provider.destroy();
        });

        it('should apply snapshot from storage on init', async () => {
            const path = 'users/test-uid/versicle/main';

            // Create first provider and add data
            const firstDoc = new Y.Doc();
            const provider1 = new MockFireProvider({
                firebaseApp: mockApp,
                ydoc: firstDoc,
                path
            });

            await new Promise(resolve => setTimeout(resolve, 50));
            firstDoc.getMap('test').set('preserved', 'data');
            await new Promise(resolve => setTimeout(resolve, 150));

            provider1.destroy();

            // Create second provider with new doc - should load saved data
            const secondDoc = new Y.Doc();
            const provider2 = new MockFireProvider({
                firebaseApp: mockApp,
                ydoc: secondDoc,
                path
            });

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(secondDoc.getMap('test').get('preserved')).toBe('data');

            provider2.destroy();
        });
    });

    describe('static helpers', () => {
        it('clearMockStorage should remove all data', async () => {
            const provider = new MockFireProvider({
                firebaseApp: mockApp,
                ydoc,
                path: 'test/path'
            });

            await new Promise(resolve => setTimeout(resolve, 50));
            ydoc.getMap('test').set('key', 'value');
            await new Promise(resolve => setTimeout(resolve, 150));

            expect(MockFireProvider.getMockStorageData()).not.toBeNull();

            MockFireProvider.clearMockStorage();

            expect(MockFireProvider.getMockStorageData()).toBeNull();

            provider.destroy();
        });

        it('injectSnapshot should add data for a specific path', () => {
            const snapshotBase64 = btoa('test-data');
            MockFireProvider.injectSnapshot('test/path', snapshotBase64);

            const data = MockFireProvider.getMockStorageData();
            expect(data?.['test/path']?.snapshotBase64).toBe(snapshotBase64);
        });
    });

    describe('destroy', () => {
        it('should save state and cleanup on destroy', async () => {
            const provider = new MockFireProvider({
                firebaseApp: mockApp,
                ydoc,
                path: 'test/path'
            });

            await new Promise(resolve => setTimeout(resolve, 50));
            ydoc.getMap('test').set('key', 'value');

            provider.destroy();

            // Should have saved
            expect(MockFireProvider.getMockStorageData()?.['test/path']).toBeDefined();
        });

        it('should not throw when destroyed multiple times', async () => {
            const provider = new MockFireProvider({
                firebaseApp: mockApp,
                ydoc,
                path: 'test/path'
            });

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(() => {
                provider.destroy();
                provider.destroy();
            }).not.toThrow();
        });
    });
});

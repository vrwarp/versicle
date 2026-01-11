import { describe, it, expect, vi } from 'vitest';
import { yDoc, persistence, waitForYjsSync } from './yjs-provider';

// Mock IndexeddbPersistence
vi.mock('y-indexeddb', () => {
    return {
        IndexeddbPersistence: class {
            synced = false;
            constructor(name: string, doc: any) {}
            on(event: string, cb: Function) {}
            once(event: string, cb: Function) {}
        }
    };
});

describe('yjs-provider', () => {
    it('should export yDoc', () => {
        expect(yDoc).toBeDefined();
    });

    it('should export persistence', () => {
        expect(persistence).toBeDefined();
    });

    it('should wait for sync', async () => {
        // Mock persistence behavior
        const persistenceMock = persistence as any;
        persistenceMock.synced = false;

        let syncedCallback: () => void;
        // We need to spy on 'once' but since it's already instantiated,
        // we might need to cast or mock prototype if we want to capture the callback
        // However, since we are mocking the module, the exported 'persistence' is an instance of our mock class.

        persistenceMock.once = (event: string, cb: () => void) => {
             if (event === 'synced') {
                syncedCallback = cb;
            }
        };

        const waitPromise = waitForYjsSync();

        // Simulate sync event
        persistenceMock.synced = true;
        if (syncedCallback!) syncedCallback();

        await expect(waitPromise).resolves.toBeUndefined();
    });
});

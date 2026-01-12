import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { isStorageSupported } from '../lib/sync/support';

// Singleton Y.Doc instance - Source of Truth for User Data
export const yDoc = new Y.Doc();

let persistence: IndexeddbPersistence | null = null;

// Initialize persistence only if supported
if (isStorageSupported()) {
    try {
        persistence = new IndexeddbPersistence('versicle-yjs', yDoc);

        persistence.on('synced', () => {
            console.log('✅ [Yjs] Content loaded from IndexedDB (versicle-yjs)');
        });

        // Error handling for persistence layer
        // Note: IndexeddbPersistence doesn't emit 'error' in all versions, but good practice to have listeners if accessible
    } catch (error) {
        console.error('❌ [Yjs] Failed to initialize IndexedDB persistence:', error);
    }
} else {
    console.warn('⚠️ [Yjs] IndexedDB not supported. Falling back to in-memory mode.');
}

/**
 * Expose the persistence instance for lower-level access (e.g., clearing data)
 */
export const yjsPersistence = persistence;

/**
 * Returns a promise that resolves when Yjs has synced with IndexedDB.
 * Safe to call even if persistence is disabled (resolves immediately).
 * 
 * @param timeoutMs Max time to wait before resolving anyway
 */
export const waitForYjsSync = (timeoutMs = 5000): Promise<void> => {
    if (!persistence) return Promise.resolve();
    if (persistence.synced) return Promise.resolve();

    return new Promise((resolve) => {
        let resolved = false;

        const timer = setTimeout(() => {
            if (!resolved) {
                console.warn('⚠️ [Yjs] Sync timeout reached. Proceeding with potentially stale data.');
                resolved = true;
                resolve();
            }
        }, timeoutMs);

        persistence!.once('synced', () => {
            if (!resolved) {
                clearTimeout(timer);
                resolved = true;
                resolve();
            }
        });
    });
};

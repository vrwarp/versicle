import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { isStorageSupported } from '../lib/sync/support';
import { createLogger } from '../lib/logger';

const logger = createLogger('YjsProvider');

// Singleton Y.Doc instance - Source of Truth for User Data
export const yDoc = new Y.Doc();

let persistence: IndexeddbPersistence | null = null;

// Initialize persistence only if supported
if (isStorageSupported()) {
    try {
        persistence = new IndexeddbPersistence('versicle-yjs', yDoc);

        persistence.on('synced', () => {
            logger.info('Content loaded from IndexedDB (versicle-yjs)');
        });

        // Error handling for persistence layer
        // Note: IndexeddbPersistence doesn't emit 'error' in all versions, but good practice to have listeners if accessible
    } catch (error) {
        logger.error('Failed to initialize IndexedDB persistence:', error);
    }
} else {
    logger.warn('IndexedDB not supported. Falling back to in-memory mode.');
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
                logger.warn('Sync timeout reached. Proceeding with potentially stale data.');
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

export const disconnectYjs = async () => {
    if (persistence) {
        logger.info('Disconnecting persistence...');
        await persistence.destroy();
        persistence = null;
        logger.info('Persistence disconnected.');
    }
};

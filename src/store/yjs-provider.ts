import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';

export const yDoc = new Y.Doc();

// Persist to IndexedDB
export const provider = new IndexeddbPersistence('versicle-yjs', yDoc);

provider.on('synced', () => {
    console.log('✅ Yjs content loaded from IndexedDB');
});

export const waitForYjsSync = (): Promise<void> => {
    if (provider.synced) return Promise.resolve();
    return new Promise(resolve => {
        provider.once('synced', () => resolve());
    });
};

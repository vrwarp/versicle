import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';

export const yDoc = new Y.Doc();

// Persist to IndexedDB
export const persistence = new IndexeddbPersistence('versicle-yjs', yDoc);

persistence.on('synced', () => {
  console.log('✅ Yjs content loaded from IndexedDB');
});

export const waitForYjsSync = (): Promise<void> => {
    if (persistence.synced) return Promise.resolve();
    return new Promise(resolve => {
        persistence.once('synced', () => resolve());
    });
};

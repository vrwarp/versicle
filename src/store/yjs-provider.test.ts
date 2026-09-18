import { describe, it, expect, afterEach } from 'vitest';
import {
    disconnectYjs,
    flushYjsPersistence,
    getYDoc,
    getYjsPersistence,
    startYjsPersistence,
    waitForYjsSync,
} from './yjs-provider';
import * as Y from 'yjs';

describe('Yjs Provider', () => {
    it('should lazily construct a single Y.Doc (no module-scope side effect)', () => {
        const yDoc = getYDoc();
        expect(yDoc).toBeInstanceOf(Y.Doc);
        // Repeated calls return the same singleton.
        expect(getYDoc()).toBe(yDoc);
    });

    it('should allow basic Yjs operations', () => {
        const map = getYDoc().getMap('test-map');
        map.set('foo', 'bar');
        expect(map.get('foo')).toBe('bar');
    });

    it('waitForYjsSync should resolve (mocked env means immediate or timeout)', async () => {
        // In test env (jsdom/node), IndexedDB might be mocked or absent.
        // We just ensure it doesn't hang forever.
        await expect(waitForYjsSync(100)).resolves.not.toThrow();
    });
});

/**
 * durability regression — the reading-session recorder now merges up to
 * COMMIT_WINDOW_MS of relocations into ONE CRDT write, so the user's position
 * lives in memory for seconds at a time and the backgrounding handlers are
 * what make it durable. Writing the merged commit into the store is only half
 * of that: it hands the bytes to y-idb, which sits on them for
 * `writeDebounceMs` (200ms) — a timer a frozen or killed page may never run.
 * `flushYjsPersistence` is the half that ends on disk, and before it existed
 * the only code that bypassed the debounce was the DEV/E2E-gated
 * `window.__versicleTest.flushPersistence`, wired to no lifecycle event at all.
 */
describe('regression: flushYjsPersistence ends the durability drain on disk', () => {
    afterEach(async () => {
        await disconnectYjs();
    });

    /** Rows actually committed to the `versicle-yjs` IndexedDB update log. */
    const countPersistedUpdates = () =>
        new Promise<number>((resolve, reject) => {
            const open = indexedDB.open('versicle-yjs');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
                const db = open.result;
                const request = db.transaction(['updates'], 'readonly').objectStore('updates').count();
                request.onsuccess = () => {
                    resolve(request.result);
                    db.close();
                };
                request.onerror = () => {
                    reject(request.error);
                    db.close();
                };
            };
        });

    it('is a no-op when persistence was never started (in-memory mode must not throw)', async () => {
        expect(getYjsPersistence()).toBeNull();
        await expect(flushYjsPersistence()).resolves.toBeUndefined();
    });

    it('commits a queued update without waiting out the 200ms write debounce', async () => {
        startYjsPersistence();
        const persistence = getYjsPersistence();
        expect(persistence, 'y-idb persistence did not start').not.toBeNull();
        await waitForYjsSync(5_000);
        const before = await countPersistedUpdates();

        // What a flushed recorder window looks like from here: one Y.Doc
        // update, queued behind the debounce and nowhere near disk yet.
        getYDoc().getMap('durability-probe').set('currentCfi', 'epubcfi(/6/4!/4/2/1:0)');
        expect(persistence!._pendingUpdates.length).toBeGreaterThan(0);

        await flushYjsPersistence();

        // No timer was awaited: the queue is empty, no write is in flight (so
        // the transaction committed rather than re-buffering), and the bytes
        // are in the log a reload would read back.
        expect(persistence!._pendingUpdates).toHaveLength(0);
        expect(persistence!._writing).toBe(false);
        expect(await countPersistedUpdates()).toBeGreaterThan(before);
    });

    it('is a no-op again once persistence has been disconnected', async () => {
        startYjsPersistence();
        await waitForYjsSync(5_000);
        await disconnectYjs();

        expect(getYjsPersistence()).toBeNull();
        await expect(flushYjsPersistence()).resolves.toBeUndefined();
    });
});

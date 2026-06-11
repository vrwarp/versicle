/**
 * Unit tests for the typed E2E test API (window.__versicleTest).
 *
 * The deterministic-flush guarantee is the load-bearing part: the Playwright
 * suite replaces its hardcoded 1500ms persistence sleep with
 * `flushPersistence()`, so these tests pin that the flush really drains both
 * debounce queues without waiting out their timers.
 */
import { describe, it, expect, vi } from 'vitest';
import { installTestApi, flushPersistence } from './test-api';
import { playbackCache } from './data/repos/playbackCache';
import { getYDoc, getYjsPersistence, startYjsPersistence } from './store/yjs-provider';
import { wipeAllData } from './data/wipe';

// Persistence no longer boots at import time (Phase 1b boot sequencing) —
// start it explicitly, as the bootstrap `startYjsPersistence` phase does.
startYjsPersistence();
const yDoc = getYDoc();

vi.mock('./data/wipe', () => ({
  wipeAllData: vi.fn().mockResolvedValue(undefined),
}));

describe('installTestApi', () => {
  it('installs the typed window.__versicleTest object', () => {
    installTestApi();
    expect(window.__versicleTest).toBeDefined();
    expect(typeof window.__versicleTest?.flushPersistence).toBe('function');
    expect(typeof window.__versicleTest?.resetApp).toBe('function');
    // Consolidated replacements for the legacy __DISCONNECT_YJS__ /
    // __CLOSE_DB__ window globals (Phase 1b).
    expect(typeof window.__versicleTest?.disconnectYjs).toBe('function');
    expect(typeof window.__versicleTest?.closeDb).toBe('function');
  });

  it('resetApp delegates to wipeAllData without reloading', async () => {
    installTestApi();
    await window.__versicleTest!.resetApp();
    expect(wipeAllData).toHaveBeenCalledWith({ reload: false });
  });
});

describe('flushPersistence', () => {
  it('drains the debounced playbackCache session write without waiting out the 500ms timer', async () => {
    const bookId = 'flush-probe-session';
    playbackCache.saveQueue(bookId, [{ text: 'Pending sentence.', cfi: 'epubcfi(/6/2!/4/2)' }]);

    // The write is debounced — long before the 500ms timer fires, flush it.
    await flushPersistence();

    // getSession reads from IndexedDB (fake-indexeddb), not the in-memory
    // mirror, so a hit proves the bytes were committed.
    const persisted = await playbackCache.getSession(bookId);
    expect(persisted?.playbackQueue).toHaveLength(1);
    expect(persisted?.playbackQueue[0]?.text).toBe('Pending sentence.');
  });

  it('drains the y-idb pending update queue without waiting out the 200ms debounce', async () => {
    const persistence = getYjsPersistence();
    expect(persistence).not.toBeNull();

    // A doc mutation enqueues a pending update behind the write debounce.
    yDoc.getMap('flush-probe').set('key', 'value');
    expect(persistence!._pendingUpdates.length).toBeGreaterThan(0);

    await flushPersistence();

    expect(persistence!._pendingUpdates).toHaveLength(0);
    expect(persistence!._writing).toBe(false);
    expect(persistence!._flushPromise).toBeNull();
  });

  it('is a no-op (not a hang) when nothing is pending', async () => {
    await expect(flushPersistence()).resolves.toBeUndefined();
    await expect(flushPersistence()).resolves.toBeUndefined();
  });
});

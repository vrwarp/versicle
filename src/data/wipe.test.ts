/**
 * wipeAllData suite (moved from src/db/wipe.test.ts in the P3-12 carve;
 * test-absorption ledger). The writer-stopping module mocks became
 * registry hooks (D9): the suite registers its own ordering probes through
 * registerWipeHook exactly the way the app composition manifest
 * (src/app/boot/registerBootTasks.ts) registers sync-stop/yjs-disconnect.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { wipeAllData, registerWipeHook, clearWipeHooksForTests } from './wipe';
import { playbackCache } from './repos/playbackCache';

const ordering: { events: string[] } = { events: [] };

/** Spec-compliant localStorage (the global test stub does not implement key()/length). */
const installEnumerableLocalStorage = (): Storage => {
  const store = new Map<string, string>();
  const stub = {
    get length() {
      return store.size;
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  } as Storage;
  Object.defineProperty(window, 'localStorage', {
    value: stub,
    writable: true,
    configurable: true,
  });
  return stub;
};

const createDatabase = (name: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('test')) {
        request.result.createObjectStore('test');
      }
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });

const openDatabase = (name: string): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const listDatabases = async (): Promise<string[]> => {
  const databases = await indexedDB.databases();
  return databases.map(db => db.name).filter((name): name is string => name !== undefined);
};

describe('wipeAllData', () => {
  beforeEach(() => {
    ordering.events.length = 0;
    clearWipeHooksForTests();
    installEnumerableLocalStorage();
    vi.clearAllMocks();
    // The app manifest's hooks, modeled: sync stop + yjs disconnect probes.
    registerWipeHook({ name: 'sync/stop', stop: () => { ordering.events.push('stop:sync'); } });
    registerWipeHook({
      name: 'state/stop-yjs-persistence',
      stop: async () => { ordering.events.push('stop:yjs'); },
    });
  });

  afterEach(() => {
    clearWipeHooksForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('deletes both IndexedDB databases (EpubLibraryDB and versicle-yjs)', async () => {
    await createDatabase('EpubLibraryDB');
    await createDatabase('versicle-yjs');
    expect(await listDatabases()).toEqual(
      expect.arrayContaining(['EpubLibraryDB', 'versicle-yjs'])
    );

    await wipeAllData({ reload: false });

    const after = await listDatabases();
    expect(after).not.toContain('EpubLibraryDB');
    expect(after).not.toContain('versicle-yjs');
  });

  it('removes Versicle-owned localStorage keys and preserves unrelated keys', async () => {
    localStorage.setItem('versicle-device-id', 'device-1');
    localStorage.setItem('versicle_cover_blob_repair_v1', '1');
    localStorage.setItem('__VERSICLE_WORKSPACES__', '[]');
    localStorage.setItem('__VERSICLE_MIGRATION_STATE__', '{}');
    localStorage.setItem('tts-storage', '{"state":{}}');
    localStorage.setItem('sync-storage', '{"state":{}}');
    localStorage.setItem('genai-storage', '{"state":{}}');
    localStorage.setItem('local-history-storage', '{"state":{}}');
    localStorage.setItem('google-services-storage', '{"state":{}}');
    localStorage.setItem('drive-config-storage', '{"state":{}}');
    // Keys the app does not own must survive the wipe.
    localStorage.setItem('some-other-app-key', 'keep-me');

    await wipeAllData({ reload: false });

    expect(localStorage.getItem('versicle-device-id')).toBeNull();
    expect(localStorage.getItem('versicle_cover_blob_repair_v1')).toBeNull();
    expect(localStorage.getItem('__VERSICLE_WORKSPACES__')).toBeNull();
    expect(localStorage.getItem('__VERSICLE_MIGRATION_STATE__')).toBeNull();
    expect(localStorage.getItem('tts-storage')).toBeNull();
    expect(localStorage.getItem('sync-storage')).toBeNull();
    expect(localStorage.getItem('genai-storage')).toBeNull();
    expect(localStorage.getItem('local-history-storage')).toBeNull();
    expect(localStorage.getItem('google-services-storage')).toBeNull();
    expect(localStorage.getItem('drive-config-storage')).toBeNull();
    expect(localStorage.getItem('some-other-app-key')).toBe('keep-me');
  });

  it('clears app-created CacheStorage caches but leaves the SW precache alone', async () => {
    const cacheNames = new Set(['piper-voices-v1', 'workbox-precache-v2-https://app/']);
    const deleted: string[] = [];
    vi.stubGlobal('caches', {
      keys: async () => Array.from(cacheNames),
      delete: async (name: string) => {
        deleted.push(name);
        return cacheNames.delete(name);
      },
    });

    await wipeAllData({ reload: false });

    expect(deleted).toContain('piper-voices-v1');
    expect(deleted).not.toContain('workbox-precache-v2-https://app/');
  });

  it('stops sync, pending session writes and Yjs persistence before deleting databases', async () => {
    const realDeleteDatabase = indexedDB.deleteDatabase.bind(indexedDB);
    vi.spyOn(indexedDB, 'deleteDatabase').mockImplementation((name: string) => {
      ordering.events.push(`delete:${name}`);
      return realDeleteDatabase(name);
    });
    const realDrop = playbackCache.dropPending.bind(playbackCache);
    vi.spyOn(playbackCache, 'dropPending').mockImplementation(() => {
      ordering.events.push('stop:session-writes');
      realDrop();
    });

    await wipeAllData({ reload: false });

    const firstDelete = ordering.events.findIndex(event => event.startsWith('delete:'));
    expect(firstDelete).toBeGreaterThan(-1);
    for (const stopEvent of ['stop:sync', 'stop:session-writes', 'stop:yjs']) {
      const stopIndex = ordering.events.indexOf(stopEvent);
      expect(stopIndex, `${stopEvent} must run`).toBeGreaterThan(-1);
      expect(stopIndex, `${stopEvent} must run before any deletion`).toBeLessThan(firstDelete);
    }
    expect(ordering.events.filter(event => event.startsWith('delete:'))).toEqual([
      'delete:versicle-yjs',
      'delete:versicle-yjs-staging',
      'delete:EpubLibraryDB',
    ]);
  });

  it('reports a blocked deletion (other tab holding the DB) instead of pretending the wipe succeeded', async () => {
    await createDatabase('EpubLibraryDB');
    // Simulate another tab: an open connection that ignores versionchange.
    const otherTab = await openDatabase('EpubLibraryDB');
    localStorage.setItem('versicle-device-id', 'device-1');

    try {
      await expect(wipeAllData({ reload: false })).rejects.toThrow(/EpubLibraryDB/);
      // Privacy-first: everything that could be cleared still was.
      expect(localStorage.getItem('versicle-device-id')).toBeNull();
    } finally {
      // Release the queued deletion so it cannot leak into other tests.
      otherTab.close();
    }
  });

  describe('wipe-hook registry (D9)', () => {
    it('re-registering a hook by name replaces it (idempotent manifest imports)', async () => {
      registerWipeHook({ name: 'sync/stop', stop: () => { ordering.events.push('stop:sync-v2'); } });

      await wipeAllData({ reload: false });

      expect(ordering.events).toContain('stop:sync-v2');
      expect(ordering.events).not.toContain('stop:sync');
    });

    it('a throwing hook never aborts the wipe', async () => {
      registerWipeHook({
        name: 'broken/hook',
        stop: () => {
          throw new Error('writer refused to stop');
        },
      });
      localStorage.setItem('versicle-device-id', 'device-1');

      await wipeAllData({ reload: false });

      expect(localStorage.getItem('versicle-device-id')).toBeNull();
    });
  });
});

/**
 * Connection-hardening suite (P3-4, design D2 in
 * plan/overhaul/prep/phase3-storage-gateway.md):
 *
 * - schema parity: the exact store set at the current version (v25 since
 *   P3-13; the store SET is unchanged from v24 — v25 added an index and
 *   repurposed app_metadata, pinned by migrations.test.ts);
 * - open retry + reset-on-failure (▲18: db.ts cached a rejected dbPromise
 *   forever — one transient failure bricked DB access until reload);
 * - navigator.storage.persist() requested once after first success;
 * - multi-connection blocked/blocking handling (the P3-4 exit gate): the
 *   current-version holder gets onBlocking and closes so a newer-version
 *   open can proceed; the new opener sees `blocked` first. (The shipping
 *   v24→v25 two-tab upgrade is pinned in migrations.test.ts M.5.)
 *
 * NOTE: this suite mutates module-level connection state, so every test
 * leaves the database deleted and the cache reset (vitest isolates files,
 * so other suites are unaffected).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openDB } from 'idb';
import { getConnection, closeConnection, configureConnectionEvents } from './connection';
import { DB_NAME, DB_VERSION } from './schema';

function deleteAppDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onblocked = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

const realIndexedDB = indexedDB;

afterEach(async () => {
  // Restore a possibly-stubbed factory, drop the cached connection, and
  // leave a clean slate for the next test.
  Object.defineProperty(globalThis, 'indexedDB', { value: realIndexedDB, configurable: true });
  configureConnectionEvents({});
  await closeConnection();
  await deleteAppDatabase();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// FIRST in the file on purpose: persistence is requested once per process,
// on the first successful open — so this test must own that first open.
describe('navigator.storage.persist()', () => {
  it('is requested once after the first successful open (fire-and-forget)', async () => {
    const persist = vi.fn(async () => true);
    const hadStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');
    Object.defineProperty(navigator, 'storage', {
      value: { persist },
      configurable: true,
    });
    try {
      await getConnection();
      await getConnection();
      await vi.waitFor(() => expect(persist).toHaveBeenCalled());
      // Once per session, not once per call.
      expect(persist).toHaveBeenCalledTimes(1);
    } finally {
      if (hadStorage) Object.defineProperty(navigator, 'storage', hadStorage);
      else delete (navigator as { storage?: unknown }).storage;
    }
  });
});

describe('connection schema parity', () => {
  it('opens EpubLibraryDB at the current version with the exact store set', async () => {
    const db = await getConnection();
    expect(DB_VERSION).toBe(27); // v27 = cache_embeddings + cache_embed_jobs (additive, semantic search)
    expect(db.version).toBe(DB_VERSION);
    expect(Array.from(db.objectStoreNames).sort()).toEqual([
      'app_metadata',
      'cache_audio_blobs',
      'cache_embed_jobs',
      'cache_embeddings',
      'cache_render_metrics',
      'cache_search_text',
      'cache_session_state',
      'cache_table_images',
      'cache_tts_preparation',
      'checkpoints',
      'flight_snapshots',
      'static_manifests',
      'static_resources',
      'static_structure',
      'sync_log',
    ]);
  });

  it('returns the same cached connection on repeated calls', async () => {
    const a = await getConnection();
    const b = await getConnection();
    expect(b).toBe(a);
  });
});

describe('open retry + reset-on-failure (▲18)', () => {
  function installFailingFactory(failures: number): () => number {
    let calls = 0;
    const failing = {
      ...realIndexedDB,
      open(name: string, version?: number) {
        calls += 1;
        if (calls <= failures) {
          throw new DOMException('Simulated transient open failure', 'UnknownError');
        }
        return realIndexedDB.open(name, version);
      },
      deleteDatabase: realIndexedDB.deleteDatabase.bind(realIndexedDB),
      cmp: realIndexedDB.cmp.bind(realIndexedDB),
    };
    Object.defineProperty(globalThis, 'indexedDB', { value: failing, configurable: true });
    return () => calls;
  }

  it('retries a transient failure and succeeds within the attempt budget', async () => {
    const callCount = installFailingFactory(2); // attempts 1-2 fail, 3 succeeds
    const db = await getConnection();
    expect(db.version).toBe(DB_VERSION);
    expect(callCount()).toBe(3);
  });

  it('rejects after exhausting attempts but does NOT brick later calls', async () => {
    installFailingFactory(Number.POSITIVE_INFINITY);
    await expect(getConnection()).rejects.toThrow('Simulated transient open failure');

    // The defect this pins: db.ts cached that rejection forever. Restoring
    // a healthy factory, the very next call must succeed.
    Object.defineProperty(globalThis, 'indexedDB', { value: realIndexedDB, configurable: true });
    const db = await getConnection();
    expect(db.version).toBe(DB_VERSION);
  });
});

describe('multi-connection blocked/blocking (P3-4 exit gate)', () => {
  it('closes the current-version holder on blocking so a newer-version open proceeds', async () => {
    const onBlocking = vi.fn();
    const blocked = vi.fn();
    configureConnectionEvents({ onBlocking });

    await getConnection(); // this context now holds DB_VERSION

    // A "second tab" opens at a higher version: our holder receives
    // versionchange → blocking → closes; the opener's `blocked` callback
    // fires while it waits, then the upgrade completes.
    const upgraded = await openDB(DB_NAME, DB_VERSION + 1, {
      blocked: () => blocked(),
      upgrade: () => {
        // No schema change needed; this simulates the other tab's upgrade.
      },
    });

    expect(onBlocking).toHaveBeenCalledTimes(1);
    expect(upgraded.version).toBe(DB_VERSION + 1);
    upgraded.close();

    // NOTE: `blocked` may or may not fire depending on close timing —
    // when our holder closes fast enough the new open is never reported
    // blocked. Both timelines are spec-legal; what matters (and is pinned)
    // is that the upgrade COMPLETES and our side got onBlocking.

    // Leave no higher-version DB behind for other tests.
    await deleteAppDatabase();
  });
});

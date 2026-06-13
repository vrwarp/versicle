/**
 * Y.1–Y.7 — characterization contract for the vendored y-idb fork
 * (plan/overhaul/prep/phase3-storage-gateway.md §Test plan "Y", PR P3-2).
 *
 * Written against the UNMODIFIED vendored source (fork SHA e2a21f45…, see
 * PROVENANCE.md) and required green BEFORE any §D6 surgery: these cases pin
 * the semantics the app's persistence path (src/store/yjs-provider.ts) and
 * the temp-provider dances (CheckpointService, DataRecoveryView) rely on
 * today. The §D6 surgery (flush()/writeSnapshot/'synced' durability) lands
 * behind its own Y.8–Y.10 cases in surgery.test.ts and must keep every case
 * here green — that is the "zero behavior diff" exit criterion.
 *
 * Runs on fake-indexeddb (root vitest setup imports 'fake-indexeddb/auto').
 * Every case uses a unique database name: the fake IDB instance is global
 * per worker process.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { IndexeddbPersistence, storeState, PREFERRED_TRIM_SIZE } from 'y-idb';

/** Track instances so afterEach can always release IDB connections. */
const live: IndexeddbPersistence[] = [];

function makeProvider(
  name: string,
  doc: Y.Doc,
  opts?: ConstructorParameters<typeof IndexeddbPersistence>[2],
): IndexeddbPersistence {
  const provider = new IndexeddbPersistence(name, doc, opts);
  live.push(provider);
  return provider;
}

afterEach(async () => {
  await Promise.all(live.splice(0).map((p) => p.destroy().catch(() => undefined)));
});

let nameCounter = 0;
/** Unique db name per case (fake-indexeddb state is process-global). */
const uniqueName = (label: string) => `y-idb-contract-${label}-${++nameCounter}`;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function openRaw(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readUpdateRows(name: string): Promise<Uint8Array[]> {
  const db = await openRaw(name);
  try {
    return await new Promise<Uint8Array[]>((resolve, reject) => {
      const tx = db.transaction(['updates'], 'readonly');
      const request = tx.objectStore('updates').getAll();
      request.onsuccess = () => resolve(request.result as Uint8Array[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

describe('y-idb fork contract (Y.1–Y.7, current semantics)', () => {
  it('Y.1 constructor hydration applies stored updates to the bound doc', async () => {
    const name = uniqueName('hydration');

    // Seed the database through a first provider session.
    const docA = new Y.Doc();
    const providerA = makeProvider(name, docA);
    await providerA.whenSynced;
    docA.getMap('library').set('book-1', { title: 'Stored Title' });
    docA.getMap('annotations').set('ann-1', 'highlight');
    await providerA.destroy();

    // A fresh doc + provider on the same name hydrates to the stored state.
    const docB = new Y.Doc();
    const providerB = makeProvider(name, docB);
    await providerB.whenSynced;
    expect(docB.getMap('library').toJSON()).toEqual({
      'book-1': { title: 'Stored Title' },
    });
    expect(docB.getMap('annotations').toJSON()).toEqual({ 'ann-1': 'highlight' });
  });

  it('Y.2 every write path runs through the injected transactionRunner', async () => {
    const name = uniqueName('runner');
    let runnerCalls = 0;
    const runner = <T,>(work: () => Promise<T>): Promise<T> => {
      runnerCalls++;
      return work();
    };

    // Constructor hydration on a doc that already has content: the initial
    // fetch + initial-state write go through the runner.
    const doc = new Y.Doc();
    doc.getMap('m').set('pre-existing', 1);
    const provider = makeProvider(name, doc, { transactionRunner: runner });
    await provider.whenSynced;
    const afterHydration = runnerCalls;
    expect(afterHydration).toBeGreaterThanOrEqual(1);

    // Debounced update flush.
    doc.getMap('m').set('k', 'v');
    await vi.waitFor(() => {
      expect(provider._pendingUpdates.length).toBe(0);
      expect(provider._writing).toBe(false);
    });
    const afterFlush = runnerCalls;
    expect(afterFlush).toBeGreaterThan(afterHydration);

    // Trim/storeState.
    await storeState(provider);
    const afterStoreState = runnerCalls;
    expect(afterStoreState).toBeGreaterThan(afterFlush);

    // Custom-store set/del.
    await provider.set('custom-key', 'custom-value');
    expect(runnerCalls).toBeGreaterThan(afterStoreState);
    const afterSet = runnerCalls;
    await provider.del('custom-key');
    expect(runnerCalls).toBeGreaterThan(afterSet);
  });

  it('Y.3 writeDebounceMs batches a burst of updates into one flush transaction', async () => {
    const name = uniqueName('debounce');
    const doc = new Y.Doc();
    const provider = makeProvider(name, doc, { writeDebounceMs: 50 });
    await provider.whenSynced;

    const rowsBefore = (await readUpdateRows(name)).length;

    // A burst of separate transactions → separate Y update events, all
    // landing inside one debounce window.
    doc.getMap('m').set('a', 1);
    doc.getMap('m').set('b', 2);
    doc.getMap('m').set('c', 3);
    expect(provider._pendingUpdates.length).toBe(3);

    await vi.waitFor(() => {
      expect(provider._pendingUpdates.length).toBe(0);
      expect(provider._writing).toBe(false);
    });

    // The batch is written row-per-update but in a single transaction; the
    // observable contract is that ALL THREE rows landed together after the
    // debounce (no partial flush) and hydrate a fresh doc completely.
    const rows = await readUpdateRows(name);
    expect(rows.length).toBe(rowsBefore + 3);

    const fresh = new Y.Doc();
    for (const row of rows) Y.applyUpdate(fresh, row);
    expect(fresh.getMap('m').toJSON()).toEqual({ a: 1, b: 2, c: 3 });
    fresh.destroy();
  });

  it('Y.4 an aborted flush transaction re-queues the batch, emits error, and retries with backoff', async () => {
    const name = uniqueName('retry');
    const doc = new Y.Doc();
    const provider = makeProvider(name, doc, { writeDebounceMs: 10 });
    await provider.whenSynced;

    const errors: unknown[] = [];
    provider.on('error', (e: unknown) => errors.push(e));

    // Hand the first flush a fake transaction whose abort handler the test
    // fires manually (deterministic, no real request ever issued); the
    // backoff retry then gets the real transaction and succeeds.
    const db = provider.db as IDBDatabase;
    const realTransaction = db.transaction.bind(db);
    let injected = false;
    type FakeTx = {
      error: DOMException;
      objectStore: () => { add: () => Record<string, never> };
      oncomplete: (() => void) | null;
      onerror: (() => void) | null;
      onabort: (() => void) | null;
    };
    const fakeTx: FakeTx = {
      error: new DOMException('Injected abort', 'AbortError'),
      // lib0's addAutoKey wraps the returned request in a promise that never
      // settles for this stub — _flush ignores per-request promises, so a
      // forever-pending one is inert (no unhandled rejection).
      objectStore: () => ({ add: () => ({}) }),
      oncomplete: null,
      onerror: null,
      onabort: null,
    };
    db.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
      if (!injected && args[1] === 'readwrite') {
        injected = true;
        return fakeTx as unknown as IDBTransaction;
      }
      return realTransaction(...args);
    }) as IDBDatabase['transaction'];

    doc.getMap('m').set('survives', 'retry');

    // Wait for the first flush to wire its handlers onto the fake tx, then
    // abort it.
    await vi.waitFor(() => {
      expect(typeof fakeTx.onabort).toBe('function');
    });
    fakeTx.onabort!();

    // The batch is re-queued and the error surfaced…
    expect(errors.length).toBe(1);
    expect(provider._pendingUpdates.length).toBe(1);

    // …and the backoff retry (2^1 × 100ms) flushes it durably.
    await vi.waitFor(
      () => {
        expect(provider._pendingUpdates.length).toBe(0);
        expect(provider._writing).toBe(false);
      },
      { timeout: 5000 },
    );
    await provider.destroy();

    const docB = new Y.Doc();
    const providerB = makeProvider(name, docB);
    await providerB.whenSynced;
    expect(docB.getMap('m').get('survives')).toBe('retry');
  });

  it('Y.5 destroy() flushes pending debounced updates before closing', async () => {
    const name = uniqueName('destroy-flush');
    const doc = new Y.Doc();
    // Debounce far beyond the test horizon: only destroy() can flush this.
    const provider = makeProvider(name, doc, { writeDebounceMs: 60_000 });
    await provider.whenSynced;

    doc.getMap('m').set('pending', 'must-survive');
    expect(provider._pendingUpdates.length).toBe(1);

    await provider.destroy();

    const docB = new Y.Doc();
    const providerB = makeProvider(name, docB);
    await providerB.whenSynced;
    expect(docB.getMap('m').get('pending')).toBe('must-survive');
  });

  it('Y.6 clearData() destroys the instance and deletes the database', async () => {
    const name = uniqueName('clear');
    const doc = new Y.Doc();
    const provider = makeProvider(name, doc);
    await provider.whenSynced;
    doc.getMap('m').set('k', 'v');
    await vi.waitFor(() => {
      expect(provider._pendingUpdates.length).toBe(0);
      expect(provider._writing).toBe(false);
    });

    await provider.clearData();

    expect(provider._destroyed).toBe(true);
    const names = (await indexedDB.databases()).map((d) => d.name);
    expect(names).not.toContain(name);
  });

  it('Y.7 whenSynced resolves with the provider after stored updates are applied', async () => {
    const name = uniqueName('synced-order');

    const docA = new Y.Doc();
    const providerA = makeProvider(name, docA);
    await providerA.whenSynced;
    docA.getMap('m').set('stored', 'yes');
    await providerA.destroy();

    const docB = new Y.Doc();
    const providerB = makeProvider(name, docB);

    // At emit time the doc must already carry the stored state…
    let contentAtEmit: unknown;
    providerB.on('synced', () => {
      contentAtEmit = docB.getMap('m').get('stored');
    });
    const resolved = await providerB.whenSynced;

    // …and whenSynced resolves with the provider instance, synced flag set.
    expect(resolved).toBe(providerB);
    expect(providerB.synced).toBe(true);
    expect(contentAtEmit).toBe('yes');
    expect(docB.getMap('m').get('stored')).toBe('yes');
  });

  it('Y.3b PREFERRED_TRIM_SIZE export stays stable (trim threshold contract)', () => {
    // The trim threshold is part of the persisted-shape behavior envelope:
    // the app's S.1 round-trip pin assumes small docs never auto-trim into
    // a merged row mid-test.
    expect(PREFERRED_TRIM_SIZE).toBe(500);
  });

  it('Y.5b destroy() is idempotent and detaches doc listeners', async () => {
    const name = uniqueName('destroy-idempotent');
    const doc = new Y.Doc();
    const provider = makeProvider(name, doc);
    await provider.whenSynced;

    const first = provider.destroy();
    const second = provider.destroy();
    expect(second).toBe(first);
    await first;

    // Updates after destroy are not queued (listener removed).
    doc.getMap('m').set('after-destroy', 1);
    await sleep(10);
    expect(provider._pendingUpdates.length).toBe(0);
  });
});

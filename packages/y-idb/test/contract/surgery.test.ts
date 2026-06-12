/**
 * Y.8–Y.10 — contract for the Phase 3 §D6 fork surgery
 * (plan/overhaul/prep/phase3-storage-gateway.md §D6, PR P3-11; surgery log
 * in PROVENANCE.md):
 *
 *   Y.8  public `flush(): Promise<void>` — idle no-op, pending-drain,
 *        in-flight chaining;
 *   Y.9  `writeSnapshot(name, update, { transactionRunner })` module export
 *        — fresh provider hydrates byte-identically, prior rows cleared,
 *        runner wraps the write;
 *   Y.10 `'synced'` durability — the event is not emitted before the
 *        constructor's hydration transaction (which carries the
 *        initial-state write) has COMMITTED.
 *   Y.11 `readSnapshot(name, { transactionRunner })` module export (Phase 4
 *        §D4 staged swap) — null on empty/missing, byte round-trip with
 *        writeSnapshot, multi-row merge, runner wraps the read.
 *
 * All cuts are additive: characterization.test.ts (Y.1–Y.7, written
 * against the pre-surgery source) must stay green alongside this suite.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import { IndexeddbPersistence, writeSnapshot, readSnapshot } from 'y-idb';

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
const uniqueName = (label: string) => `y-idb-surgery-${label}-${++nameCounter}`;

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

describe('y-idb fork surgery contract (Y.8–Y.10)', () => {
  it('Y.8a flush() is an immediate no-op when the queue is idle', async () => {
    const name = uniqueName('flush-idle');
    const doc = new Y.Doc();
    const provider = makeProvider(name, doc, { writeDebounceMs: 60_000 });
    await provider.whenSynced;

    const rowsBefore = (await readUpdateRows(name)).length;
    await provider.flush();
    const rowsAfter = (await readUpdateRows(name)).length;

    expect(rowsAfter).toBe(rowsBefore);
    expect(provider._pendingUpdates.length).toBe(0);
    expect(provider._writing).toBe(false);
  });

  it('Y.8b flush() drains pending updates durably without waiting out the debounce', async () => {
    const name = uniqueName('flush-drain');
    const doc = new Y.Doc();
    // Debounce far beyond the test horizon: only flush() can drain this.
    const provider = makeProvider(name, doc, { writeDebounceMs: 60_000 });
    await provider.whenSynced;

    doc.getMap('m').set('pending', 'flushed');
    expect(provider._pendingUpdates.length).toBe(1);

    await provider.flush();

    expect(provider._pendingUpdates.length).toBe(0);
    expect(provider._writing).toBe(false);

    // Durable: visible to a raw read AND hydrates a fresh provider.
    const rows = await readUpdateRows(name);
    expect(rows.length).toBeGreaterThan(0);
    await provider.destroy();
    const docB = new Y.Doc();
    const providerB = makeProvider(name, docB);
    await providerB.whenSynced;
    expect(docB.getMap('m').get('pending')).toBe('flushed');
  });

  it('Y.8c flush() chains over an in-flight write and updates that arrive mid-flush', async () => {
    const name = uniqueName('flush-chain');
    const doc = new Y.Doc();
    const provider = makeProvider(name, doc, { writeDebounceMs: 60_000 });
    await provider.whenSynced;

    doc.getMap('m').set('first', 1);
    const flushed = provider.flush();
    // Arrives while the first batch may already be in flight — flush() must
    // not resolve until this lands too.
    doc.getMap('m').set('second', 2);
    await flushed;

    expect(provider._pendingUpdates.length).toBe(0);
    expect(provider._writing).toBe(false);

    await provider.destroy();
    const docB = new Y.Doc();
    const providerB = makeProvider(name, docB);
    await providerB.whenSynced;
    expect(docB.getMap('m').get('first')).toBe(1);
    expect(docB.getMap('m').get('second')).toBe(2);
  });

  it('Y.9a writeSnapshot() writes one row that hydrates a fresh provider byte-identically', async () => {
    const name = uniqueName('snapshot-fresh');

    const source = new Y.Doc();
    source.getMap('library').set('book-1', { title: 'Snapshot Book' });
    source.getMap('annotations').set('ann-1', 'note');
    const update = Y.encodeStateAsUpdate(source);

    await writeSnapshot(name, update);

    // The fork's own store layout, exactly one row, byte-identical.
    const db = await openRaw(name);
    expect(Array.from(db.objectStoreNames).sort()).toEqual(['custom', 'updates']);
    db.close();
    const rows = await readUpdateRows(name);
    expect(rows).toHaveLength(1);
    expect(Array.from(rows[0])).toEqual(Array.from(update));

    // A real provider session hydrates to the identical doc state.
    const docB = new Y.Doc();
    const providerB = makeProvider(name, docB);
    await providerB.whenSynced;
    expect(docB.getMap('library').toJSON()).toEqual(source.toJSON().library);
    expect(docB.getMap('annotations').toJSON()).toEqual(source.toJSON().annotations);
    source.destroy();
  });

  it('Y.9b writeSnapshot() clears prior update rows (idempotent replacement)', async () => {
    const name = uniqueName('snapshot-clear');

    // Populate the database through a normal provider session first.
    const docA = new Y.Doc();
    const providerA = makeProvider(name, docA);
    await providerA.whenSynced;
    docA.getMap('m').set('old', 'state');
    await providerA.destroy();
    expect((await readUpdateRows(name)).length).toBeGreaterThan(0);

    const replacement = new Y.Doc();
    replacement.getMap('m').set('new', 'state');
    const update = Y.encodeStateAsUpdate(replacement);
    await writeSnapshot(name, update);

    const rows = await readUpdateRows(name);
    expect(rows).toHaveLength(1);
    expect(Array.from(rows[0])).toEqual(Array.from(update));

    const docB = new Y.Doc();
    const providerB = makeProvider(name, docB);
    await providerB.whenSynced;
    expect(docB.getMap('m').toJSON()).toEqual({ new: 'state' });
    replacement.destroy();
  });

  it('Y.9c writeSnapshot() routes the whole write through the injected transactionRunner', async () => {
    const name = uniqueName('snapshot-runner');
    let runnerCalls = 0;
    let workSettledInsideRunner = false;
    const runner = async <T,>(work: () => Promise<T>): Promise<T> => {
      runnerCalls++;
      const result = await work();
      workSettledInsideRunner = true;
      return result;
    };

    const source = new Y.Doc();
    source.getMap('m').set('via', 'runner');
    await writeSnapshot(name, Y.encodeStateAsUpdate(source), { transactionRunner: runner });
    source.destroy();

    expect(runnerCalls).toBe(1);
    expect(workSettledInsideRunner).toBe(true);
    const rows = await readUpdateRows(name);
    expect(rows).toHaveLength(1);
  });

  it('Y.10 synced is not emitted before the initial-state write has committed', async () => {
    const name = uniqueName('synced-durable');

    // Track commit state of every readwrite transaction opened on this
    // database. The 'complete' listener is attached at creation time, so it
    // runs before any oncomplete handler the implementation assigns later.
    const pending: { committed: boolean }[] = [];
    const realTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (
      this: IDBDatabase,
      ...args: Parameters<IDBDatabase['transaction']>
    ) {
      const tx = realTransaction.apply(this, args);
      if (this.name === name && tx.mode === 'readwrite') {
        const record = { committed: false };
        tx.addEventListener('complete', () => {
          record.committed = true;
        });
        pending.push(record);
      }
      return tx;
    } as IDBDatabase['transaction'];

    try {
      // A doc with content: the constructor must write the initial state.
      const doc = new Y.Doc();
      doc.getMap('m').set('initial', 'state');
      const provider = makeProvider(name, doc);
      await provider.whenSynced;

      // The hydration transaction (carrying the initial-state write) has
      // committed by the time whenSynced resolves…
      expect(pending.length).toBeGreaterThan(0);
      for (const record of pending) {
        expect(record.committed).toBe(true);
      }

      // …so the initial write is durably visible to an independent read.
      const rows = await readUpdateRows(name);
      expect(rows.length).toBeGreaterThan(0);
      const fresh = new Y.Doc();
      for (const row of rows) Y.applyUpdate(fresh, row);
      expect(fresh.getMap('m').get('initial')).toBe('state');
      fresh.destroy();
    } finally {
      IDBDatabase.prototype.transaction = realTransaction;
    }
  });

  it('Y.10b synced ordering is preserved: stored updates are applied before the durable emit', async () => {
    const name = uniqueName('synced-order-durable');

    const docA = new Y.Doc();
    const providerA = makeProvider(name, docA);
    await providerA.whenSynced;
    docA.getMap('m').set('stored', 'yes');
    await providerA.destroy();

    const docB = new Y.Doc();
    const providerB = makeProvider(name, docB);
    let contentAtEmit: unknown;
    providerB.on('synced', () => {
      contentAtEmit = docB.getMap('m').get('stored');
    });
    await providerB.whenSynced;
    expect(contentAtEmit).toBe('yes');
  });

  it('Y.11a readSnapshot() resolves null for a missing or empty database', async () => {
    const name = uniqueName('read-empty');
    // Missing database: opening creates an empty one — still null.
    await expect(readSnapshot(name)).resolves.toBeNull();
    // Still null on the now-existing-but-empty database.
    await expect(readSnapshot(name)).resolves.toBeNull();
  });

  it('Y.11b readSnapshot() round-trips writeSnapshot byte-identically', async () => {
    const name = uniqueName('read-roundtrip');
    const source = new Y.Doc();
    source.getMap('library').set('book-1', { title: 'Round Trip' });
    const update = Y.encodeStateAsUpdate(source);
    source.destroy();

    await writeSnapshot(name, update);
    const read = await readSnapshot(name);
    expect(read).not.toBeNull();
    expect(Array.from(read!)).toEqual(Array.from(update));
  });

  it('Y.11c readSnapshot() merges multiple update rows into the full persisted state', async () => {
    const name = uniqueName('read-merge');

    // A normal provider session leaves a snapshot row plus debounced
    // incremental rows — exactly what a staged database can hold.
    const docA = new Y.Doc();
    const providerA = makeProvider(name, docA, { writeDebounceMs: 1 });
    await providerA.whenSynced;
    docA.getMap('m').set('first', 1);
    await providerA.flush();
    docA.getMap('m').set('second', 2);
    await providerA.flush();
    await providerA.destroy();
    expect((await readUpdateRows(name)).length).toBeGreaterThan(1);

    const read = await readSnapshot(name);
    expect(read).not.toBeNull();
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, read!);
    expect(fresh.getMap('m').get('first')).toBe(1);
    expect(fresh.getMap('m').get('second')).toBe(2);
    fresh.destroy();
  });

  it('Y.11d readSnapshot() routes the whole read through the injected transactionRunner', async () => {
    const name = uniqueName('read-runner');
    const source = new Y.Doc();
    source.getMap('m').set('via', 'runner');
    await writeSnapshot(name, Y.encodeStateAsUpdate(source));
    source.destroy();

    let runnerCalls = 0;
    let workSettledInsideRunner = false;
    const runner = async <T,>(work: () => Promise<T>): Promise<T> => {
      runnerCalls++;
      const result = await work();
      workSettledInsideRunner = true;
      return result;
    };

    const read = await readSnapshot(name, { transactionRunner: runner });
    expect(runnerCalls).toBe(1);
    expect(workSettledInsideRunner).toBe(true);
    expect(read).not.toBeNull();
  });
});

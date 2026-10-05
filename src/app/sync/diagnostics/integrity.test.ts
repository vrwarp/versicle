import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';

// ── doubles: one synced store bound to a test doc, and the orchestrator ────

const h = vi.hoisted(() => ({
  storeState: {} as Record<string, unknown>,
  flushes: 0,
  orchestrator: null as null | {
    getDiagnostics: () => { provider: unknown };
    downloadRemoteStateForDiagnostics: (
      timeoutMs: number
    ) => Promise<{ ok: true; workspaceId: string; update: Uint8Array; ms: number } | { ok: false; error: string; ms: number }>;
  },
}));

vi.mock('@store/registry', () => {
  const store = {
    getState: () => h.storeState,
    yjs: {
      flush: () => {
        h.flushes++;
      },
      hasHydrated: () => true,
      isObsolete: () => false,
    },
  };
  return {
    SYNCED_STORES: [
      { def: { name: 'library', syncedKeys: ['books', 'order'], hydration: 'merge-defaults', scopedDiff: true }, store },
    ],
    yjsHandleOf: (s: { yjs?: unknown }) => s.yjs,
  };
});

vi.mock('../createSync', () => ({
  peekSyncOrchestrator: () => h.orchestrator,
}));

import { applySnapshot, deleteYjsDatabase } from '@data/snapshot/YjsSnapshotService';
import { checkPersistence, checkRemote, checkRoundTrip, checkStoreBindings, compareReplicas } from './integrity';

const replicaOf = (doc: Y.Doc): Y.Doc => {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  return copy;
};

beforeEach(async () => {
  h.storeState = {};
  h.flushes = 0;
  h.orchestrator = null;
  await deleteYjsDatabase();
});

describe('compareReplicas', () => {
  it('identical replicas match (untyped roots on the rebuilt side are aligned)', () => {
    const local = new Y.Doc();
    local.getMap('library').set('b1', { t: 1 });
    local.getArray('order').push(['b1']);

    const c = compareReplicas(local, replicaOf(local));

    expect(c).toMatchObject({
      verdict: 'match',
      snapshotsEqual: true,
      contentEqual: true,
      sameOpsDifferentContent: false,
      localAhead: [],
      otherAhead: [],
      roots: {},
    });
  });

  it('local ahead: names the client, the entries the other side lacks, and the byte gap', () => {
    const local = new Y.Doc();
    local.getMap('library').set('b1', { t: 1 });
    const other = replicaOf(local);
    local.getMap('library').set('b2', { t: 2 });
    local.getMap('library').set('b1', { t: 9 });

    const c = compareReplicas(local, other);

    expect(c.verdict).toBe('mismatch');
    expect(c.sameOpsDifferentContent).toBe(false);
    expect(c.localAhead).toEqual([{ client: local.clientID, local: expect.any(Number), other: expect.any(Number) }]);
    expect(c.otherAhead).toEqual([]);
    expect(c.roots.library).toMatchObject({ onlyLocal: ['b2'], onlyOther: [], differing: ['b1'] });
    expect(c.otherMissingBytes).toBeGreaterThan(c.localMissingBytes);
  });

  it('other ahead: a remote writer this replica never integrated', () => {
    const local = new Y.Doc();
    const other = new Y.Doc();
    other.getMap('library').set('remote-book', { t: 3 });

    const c = compareReplicas(local, other);

    expect(c.otherAhead).toEqual([{ client: other.clientID, local: 0, other: expect.any(Number) }]);
    expect(c.roots.library).toMatchObject({ localDigest: null, onlyLocal: [], onlyOther: ['remote-book'] });
  });

  it('reports structs the other replica holds but cannot integrate (missing dependency)', () => {
    const src = new Y.Doc();
    const updates: Uint8Array[] = [];
    src.on('update', (u: Uint8Array) => updates.push(u));
    src.getMap('m').set('a', 1);
    src.getMap('m').set('b', 2);
    const blocked = new Y.Doc();
    Y.applyUpdate(blocked, updates[1]);

    expect(compareReplicas(new Y.Doc(), blocked).otherPendingStructs).toEqual({
      missing: { [src.clientID]: 0 },
      updateBytes: expect.any(Number),
    });
  });
});

describe('checkRoundTrip', () => {
  it('a healthy doc round-trips', () => {
    const doc = new Y.Doc();
    doc.getMap('library').set('b1', { t: 1 });
    expect(checkRoundTrip(doc)).toMatchObject({ verdict: 'match' });
  });
});

describe('checkStoreBindings (zustand-middleware-yjs)', () => {
  it('flushes the outbound batch, then matches store state to the bound map', () => {
    const doc = new Y.Doc();
    doc.getMap('library').set('books', { b1: { title: 'x' } });
    doc.getMap('library').set('order', ['b1']);
    h.storeState = { books: { b1: { title: 'x', dropped: undefined } }, order: ['b1'], local: 'ignored' };

    expect(checkStoreBindings(doc)).toMatchObject({
      verdict: 'match',
      mismatchedStores: 0,
      stores: { library: { verdict: 'match', hydrated: true, obsolete: false } },
    });
    expect(h.flushes).toBe(1);
  });

  it('pinpoints entry-level drift between store and doc', () => {
    const doc = new Y.Doc();
    doc.getMap('library').set('books', { b1: { title: 'x' }, b2: { title: 'doc-only' }, b3: { title: 'old' } });
    h.storeState = { books: { b1: { title: 'x' }, b3: { title: 'new' }, b4: { title: 'store-only' } }, order: [] };

    const r = checkStoreBindings(doc) as { verdict: string; stores: Record<string, { keys: Record<string, unknown> }> };

    expect(r.verdict).toBe('mismatch');
    expect(r.stores.library.keys.books).toEqual({
      onlyInStore: ['b4'],
      onlyInDoc: ['b2'],
      differing: ['b3'],
      fields: { b3: { title: { store: expect.any(String), doc: expect.any(String) } } },
    });
    // `order` absent from the doc is the merge-defaults contract, reported apart.
    expect(r.stores.library.keys.order).toMatchObject({ absentInDoc: true });
  });
});

describe('checkPersistence (y-idb)', () => {
  it('flags a database that holds nothing', async () => {
    const doc = new Y.Doc();
    doc.getMap('library').set('b1', 1);
    expect(await checkPersistence(doc)).toMatchObject({ verdict: 'mismatch', note: expect.stringContaining('no Yjs state') });
  });

  it('matches when IndexedDB holds the in-memory state, and flags memory ahead of disk', async () => {
    const doc = new Y.Doc();
    doc.getMap('library').set('b1', 1);
    await applySnapshot(Y.encodeStateAsUpdate(doc));

    expect(await checkPersistence(doc)).toMatchObject({ verdict: 'match', flushed: 'ok' });

    doc.getMap('library').set('b2', 2); // never persisted (no binding in this test)
    expect(await checkPersistence(doc)).toMatchObject({
      verdict: 'mismatch',
      localAhead: [{ client: doc.clientID }],
      roots: { library: { onlyLocal: ['b2'] } },
    });
  });
});

describe('checkRemote (y-cinder)', () => {
  it('skips when sync never composed', async () => {
    expect(await checkRemote(new Y.Doc(), 10)).toEqual({ verdict: 'skipped', reason: expect.any(String) });
  });

  it('compares memory with the downloaded remote document', async () => {
    const doc = new Y.Doc();
    doc.getMap('library').set('b1', 1);
    const remote = replicaOf(doc);
    remote.getMap('library').set('from-ipad', 2);
    const timeouts: number[] = [];
    h.orchestrator = {
      getDiagnostics: () => ({ provider: { attached: true } }),
      downloadRemoteStateForDiagnostics: async (timeoutMs) => {
        timeouts.push(timeoutMs);
        return { ok: true, workspaceId: 'ws_1', update: Y.encodeStateAsUpdate(remote), ms: 5 };
      },
    };

    const r = await checkRemote(doc, 1234);

    expect(timeouts).toEqual([1234]);
    expect(r).toMatchObject({
      verdict: 'mismatch',
      workspaceId: 'ws_1',
      providerBefore: { attached: true },
      otherAhead: [{ client: remote.clientID }],
      roots: { library: { onlyOther: ['from-ipad'] } },
    });
  });

  it('records a failed download as an error, never as "remote empty"', async () => {
    h.orchestrator = {
      getDiagnostics: () => ({ provider: null }),
      downloadRemoteStateForDiagnostics: async () => ({ ok: false, error: 'Error: timed out', ms: 20 }),
    };
    expect(await checkRemote(new Y.Doc(), 10)).toMatchObject({ verdict: 'error', error: 'Error: timed out' });
  });
});

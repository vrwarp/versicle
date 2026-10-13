import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';

// ── doubles: the synced-store roster bound to a test doc, and the orchestrator ──
//
// `syncedStores` IS the array the mocked registry exports: beforeEach resets
// it to the `library` store alone, and a test pushes further stores (one
// without a yjs handle, a scoped one, a throwing one) when it needs them.

const h = vi.hoisted(() => ({
  storeState: {} as Record<string, unknown>,
  flushes: 0,
  syncedStores: [] as Array<{
    def: { name: string; syncedKeys: string[]; hydration: string; scopedDiff: boolean; scope?: { key: string } };
    store: unknown;
  }>,
  orchestrator: null as null | {
    getDiagnostics: () => { provider: unknown };
    downloadRemoteStateForDiagnostics: (
      timeoutMs: number
    ) => Promise<{ ok: true; workspaceId: string; update: Uint8Array; ms: number } | { ok: false; error: string; ms: number }>;
  },
}));

vi.mock('@store/registry', () => ({
  SYNCED_STORES: h.syncedStores,
  yjsHandleOf: (s: { yjs?: unknown }) => s.yjs,
}));

vi.mock('../createSync', () => ({
  peekSyncOrchestrator: () => h.orchestrator,
}));

import { applySnapshot, deleteYjsDatabase } from '@data/snapshot/YjsSnapshotService';
import { disconnectYjs, getYDoc, getYjsPersistence, startYjsPersistence, waitForYjsSync } from '@store/yjs-provider';
import { fnv1a, stableStringify, summarizeDoc } from './docSummary';
import {
  checkPersistence,
  checkRemote,
  checkRoundTrip,
  checkStoreBindings,
  compareReplicas,
  runIntegrityChecks,
} from './integrity';

/** The store the suite binds by default: `library` ↔ `getMap('library')`, with a live handle. */
const libraryStore = {
  def: { name: 'library', syncedKeys: ['books', 'order'], hydration: 'merge-defaults', scopedDiff: true },
  store: {
    getState: () => h.storeState,
    yjs: {
      flush: () => {
        h.flushes++;
      },
      hasHydrated: () => true,
      isObsolete: () => false,
    },
  },
};

const replicaOf = (doc: Y.Doc): Y.Doc => {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  return copy;
};

/** Digest of one root exactly as summarizeDoc reports it — what the comparison hashes. */
const digestOf = (doc: Y.Doc, root: string): string => summarizeDoc(doc).shared[root].digest;
/** Hash of a value the way the binding check hashes it. */
const hashOf = (value: unknown): string => fnv1a(stableStringify(value));
/** Digest of a Y.Map that holds nothing. */
const EMPTY_MAP_DIGEST = (() => {
  const d = new Y.Doc();
  d.getMap('x');
  return digestOf(d, 'x');
})();
/** Bytes of an update carrying nothing: what a side that is already up to date "needs". */
const EMPTY_UPDATE_BYTES = Y.encodeStateAsUpdate(new Y.Doc()).byteLength;

/** The full comparison record of two replicas that agree on everything. */
const MATCH = {
  verdict: 'match',
  snapshotsEqual: true,
  contentEqual: true,
  sameOpsDifferentContent: false,
  localAhead: [],
  otherAhead: [],
  otherMissingBytes: EMPTY_UPDATE_BYTES,
  localMissingBytes: EMPTY_UPDATE_BYTES,
  otherPendingStructs: null,
  roots: {},
};

/** `n` distinct clients (IDs 1000…) each writing one key `k<i>` into `library`. */
const docWithWriters = (n: number): Y.Doc => {
  const doc = new Y.Doc();
  for (let i = 0; i < n; i++) {
    const writer = new Y.Doc();
    writer.clientID = 1000 + i;
    writer.getMap('library').set(`k${i}`, i);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(writer));
  }
  doc.getMap('library'); // typed, as a live doc's root is (per-entry hashes need it)
  return doc;
};
/** The keys docWithWriters(n) wrote, in the order the summary lists them (sorted). */
const sortedKeys = (n: number): string[] => Array.from({ length: n }, (_, i) => `k${i}`).sort();

type StoreReport = Record<string, unknown>;
const storesOf = (r: Record<string, unknown>): Record<string, StoreReport> => r.stores as Record<string, StoreReport>;

beforeEach(async () => {
  h.storeState = {};
  h.flushes = 0;
  h.syncedStores.splice(0, h.syncedStores.length, libraryStore);
  h.orchestrator = null;
  await deleteYjsDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('compareReplicas', () => {
  it('identical replicas match (untyped map/array/text roots on the rebuilt side are aligned)', () => {
    const local = new Y.Doc();
    local.getMap('library').set('b1', { t: 1 });
    local.getArray('order').push(['b1']);
    local.getText('notes').insert(0, 'hello');

    expect(compareReplicas(local, replicaOf(local))).toEqual(MATCH);
  });

  it('roots rebuilt from bytes on BOTH sides (untyped) compare by their raw shape', () => {
    const src = new Y.Doc();
    src.getMap('library').set('b1', { t: 1 });

    expect(compareReplicas(replicaOf(src), replicaOf(src))).toEqual(MATCH);
  });

  it('local ahead: names the client, the entries the other side lacks, and the byte gap', () => {
    const local = new Y.Doc();
    local.getMap('library').set('b0', { t: 0 }); // shared and unchanged: must NOT be listed as differing
    local.getMap('library').set('b1', { t: 1 });
    const other = replicaOf(local);
    local.getMap('library').set('b2', { t: 2 });
    local.getMap('library').set('b1', { t: 9 });

    const c = compareReplicas(local, other);

    expect(c).toEqual({
      verdict: 'mismatch',
      snapshotsEqual: false,
      contentEqual: false,
      sameOpsDifferentContent: false,
      localAhead: [{ client: local.clientID, local: 4, other: 2 }],
      otherAhead: [],
      otherMissingBytes: expect.any(Number),
      localMissingBytes: EMPTY_UPDATE_BYTES,
      otherPendingStructs: null,
      roots: {
        library: {
          localDigest: digestOf(local, 'library'),
          otherDigest: digestOf(other, 'library'),
          onlyLocal: ['b2'],
          onlyOther: [],
          differing: ['b1'],
        },
      },
    });
    expect(c.otherMissingBytes).toBeGreaterThan(EMPTY_UPDATE_BYTES);
  });

  it('other ahead: a remote writer this replica never integrated', () => {
    const local = new Y.Doc();
    const other = new Y.Doc();
    other.getMap('library').set('remote-book', { t: 3 });

    const c = compareReplicas(local, other);

    expect(c).toEqual({
      verdict: 'mismatch',
      snapshotsEqual: false,
      contentEqual: false,
      sameOpsDifferentContent: false,
      localAhead: [],
      otherAhead: [{ client: other.clientID, local: 0, other: 1 }],
      otherMissingBytes: EMPTY_UPDATE_BYTES,
      localMissingBytes: expect.any(Number),
      otherPendingStructs: null,
      roots: {
        library: {
          localDigest: null,
          otherDigest: digestOf(other, 'library'),
          onlyLocal: [],
          onlyOther: ['remote-book'],
          differing: [],
        },
      },
    });
    expect(c.localMissingBytes).toBeGreaterThan(EMPTY_UPDATE_BYTES);
  });

  it('a root the other side holds EMPTY lists every local key as one-sided; a text root has digests only', () => {
    const local = new Y.Doc();
    local.getMap('library').set('b1', { t: 1 });
    local.getText('notes').insert(0, 'hello');
    const other = new Y.Doc();

    const c = compareReplicas(local, other);

    expect(c.verdict).toBe('mismatch');
    expect(c.contentEqual).toBe(false);
    expect(c.roots).toEqual({
      library: {
        localDigest: digestOf(local, 'library'),
        otherDigest: EMPTY_MAP_DIGEST,
        onlyLocal: ['b1'],
        onlyOther: [],
        differing: [],
      },
      notes: { localDigest: digestOf(local, 'notes'), otherDigest: digestOf(other, 'notes') },
    });
  });

  it('THE library-bug signature: the same operations integrated, different content', () => {
    // Two fresh docs writing as the SAME client have identical state vectors
    // and empty delete sets — the snapshots are equal — yet hold different
    // values. That is what a CRDT library bug looks like from the outside.
    const local = new Y.Doc();
    local.clientID = 42;
    local.getMap('library').set('b1', { t: 1 });
    const other = new Y.Doc();
    other.clientID = 42;
    other.getMap('library').set('b1', { t: 2 });

    expect(compareReplicas(local, other)).toEqual({
      verdict: 'mismatch',
      snapshotsEqual: true,
      contentEqual: false,
      sameOpsDifferentContent: true,
      localAhead: [],
      otherAhead: [],
      otherMissingBytes: EMPTY_UPDATE_BYTES,
      localMissingBytes: EMPTY_UPDATE_BYTES,
      otherPendingStructs: null,
      roots: {
        library: {
          localDigest: digestOf(local, 'library'),
          otherDigest: digestOf(other, 'library'),
          onlyLocal: [],
          onlyOther: [],
          differing: ['b1'],
        },
      },
    });
  });

  it('equal content reached through different operations is NOT a match (snapshots differ)', () => {
    const local = new Y.Doc();
    local.clientID = 1;
    local.getMap('library').set('b1', { t: 1 });
    const other = new Y.Doc();
    other.clientID = 2;
    other.getMap('library').set('b1', { t: 1 });

    expect(compareReplicas(local, other)).toEqual({
      verdict: 'mismatch',
      snapshotsEqual: false,
      contentEqual: true,
      sameOpsDifferentContent: false,
      localAhead: [{ client: 1, local: 1, other: 0 }],
      otherAhead: [{ client: 2, local: 0, other: 1 }],
      otherMissingBytes: expect.any(Number),
      localMissingBytes: expect.any(Number),
      otherPendingStructs: null,
      roots: {},
    });
  });

  describe('empty roots', () => {
    it('a root touched on one side only but empty everywhere is not a difference', () => {
      // typed-but-empty on `other` only (an empty map's digest vs no root at all)
      const other = new Y.Doc();
      other.getMap('library');
      expect(compareReplicas(new Y.Doc(), other)).toEqual(MATCH);

      // on `local` only, of a kind alignRootTypes cannot give `other` (an untyped placeholder)
      const local = new Y.Doc();
      local.get('scratch');
      expect(compareReplicas(local, new Y.Doc())).toEqual(MATCH);
    });

    it('a root with content on one side only is reported, without per-key lists when it is untyped there', () => {
      const src = new Y.Doc();
      src.getMap('library').set('b1', 1);
      src.getMap('library').set('b2', 2);

      // local rebuilt from bytes (untyped root), other holds nothing
      const local = replicaOf(src);
      const c1 = compareReplicas(local, new Y.Doc());
      expect(c1.verdict).toBe('mismatch');
      expect(c1.localAhead).toEqual([{ client: src.clientID, local: 2, other: 0 }]);
      expect(c1.roots).toEqual({ library: { localDigest: digestOf(local, 'library'), otherDigest: null } });

      // the mirror image: other rebuilt from bytes, local holds nothing
      const other = replicaOf(src);
      const c2 = compareReplicas(new Y.Doc(), other);
      expect(c2.verdict).toBe('mismatch');
      expect(c2.otherAhead).toEqual([{ client: src.clientID, local: 0, other: 2 }]);
      expect(c2.roots).toEqual({ library: { localDigest: null, otherDigest: digestOf(other, 'library') } });
    });
  });

  describe('listing caps (MAX_LISTED = 200)', () => {
    it('lists exactly 200 keys and 200 clients without flagging truncation', () => {
      const other = docWithWriters(200);

      const c = compareReplicas(new Y.Doc(), other);

      expect(c.otherAhead).toHaveLength(200);
      expect(new Set(c.otherAhead.map((e) => e.client)).size).toBe(200);
      expect(c.roots).toEqual({
        library: {
          localDigest: null,
          otherDigest: digestOf(other, 'library'),
          onlyLocal: [],
          onlyOther: sortedKeys(200),
          differing: [],
        },
      });
    });

    it('caps every list at 200 and flags the root as truncated, in both directions', () => {
      const big = docWithWriters(201);

      const c = compareReplicas(new Y.Doc(), big);
      expect(c.otherAhead).toHaveLength(200);
      expect(c.otherAhead.every((e) => e.local === 0 && e.other === 1)).toBe(true);
      expect(c.roots).toEqual({
        library: {
          localDigest: null,
          otherDigest: digestOf(big, 'library'),
          onlyLocal: [],
          onlyOther: sortedKeys(201).slice(0, 200),
          differing: [],
          truncated: true,
        },
      });

      const empty = new Y.Doc();
      const d = compareReplicas(big, empty);
      expect(d.localAhead).toHaveLength(200);
      expect(d.localAhead.every((e) => e.local === 1 && e.other === 0)).toBe(true);
      expect(d.roots).toEqual({
        library: {
          localDigest: digestOf(big, 'library'),
          otherDigest: EMPTY_MAP_DIGEST,
          onlyLocal: sortedKeys(201).slice(0, 200),
          onlyOther: [],
          differing: [],
          truncated: true,
        },
      });
    });
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

describe('checkRoundTrip (yjs)', () => {
  it('a healthy doc round-trips, and the scratch copy is destroyed', () => {
    const destroy = vi.spyOn(Y.Doc.prototype, 'destroy');
    const doc = new Y.Doc();
    doc.getMap('library').set('b1', { t: 1 });

    expect(checkRoundTrip(doc)).toEqual({ verdict: 'match', snapshotsEqual: true, contentEqual: true, roots: {} });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('a doc that cannot be encoded is an error, never a false match', () => {
    expect(checkRoundTrip(null as unknown as Y.Doc)).toEqual({
      verdict: 'error',
      error: expect.stringMatching(/^TypeError: /),
    });
  });
});

describe('checkStoreBindings (zustand-middleware-yjs)', () => {
  it('flushes the outbound batch, then matches store state to the bound map', () => {
    const doc = new Y.Doc();
    doc.getMap('library').set('books', { b1: { title: 'x' } });
    doc.getMap('library').set('order', ['b1']);
    h.storeState = { books: { b1: { title: 'x', dropped: undefined } }, order: ['b1'], local: 'ignored' };

    expect(checkStoreBindings(doc)).toEqual({
      verdict: 'match',
      mismatchedStores: 0,
      stores: { library: { verdict: 'match', hydrated: true, obsolete: false } },
    });
    expect(h.flushes).toBe(1);
  });

  it('pinpoints entry-level drift between store and doc, down to the fields of each entry', () => {
    const doc = new Y.Doc();
    doc.getMap('library').set('books', {
      b1: { title: 'x' },
      b2: { title: 'doc-only' },
      b3: { title: 'old', author: 'same', gone: true },
    });
    h.storeState = {
      books: { b1: { title: 'x' }, b3: { title: 'new', author: 'same', extra: 1 }, b4: { title: 'store-only' } },
      order: [],
    };

    const r = checkStoreBindings(doc);

    expect(r.verdict).toBe('mismatch');
    expect(r.mismatchedStores).toBe(1);
    expect(storesOf(r).library).toEqual({
      verdict: 'mismatch',
      hydrated: true,
      obsolete: false,
      keys: {
        books: {
          onlyInStore: ['b4'],
          onlyInDoc: ['b2'],
          differing: ['b3'],
          // Hashes only, never values; `author` agrees and is not listed.
          fields: {
            b3: {
              title: { store: hashOf('new'), doc: hashOf('old') },
              extra: { store: hashOf(1), doc: '(absent)' },
              gone: { store: '(absent)', doc: hashOf(true) },
            },
          },
        },
        // `order` absent from the doc is the merge-defaults contract, reported apart.
        order: { absentInDoc: true, storeHash: hashOf([]) },
      },
    });
  });

  it('a synced key that is not a record on one side is compared by whole-value hash', () => {
    const doc = new Y.Doc();
    doc.getMap('library').set('books', 'not-a-record');
    doc.getMap('library').set('order', ['b1']);
    h.storeState = { books: { b1: { title: 'x' } }, order: null };

    const r = checkStoreBindings(doc);

    expect(r.mismatchedStores).toBe(1);
    expect(storesOf(r).library).toEqual({
      verdict: 'mismatch',
      hydrated: true,
      obsolete: false,
      keys: {
        books: { storeHash: hashOf({ b1: { title: 'x' } }), docHash: hashOf('not-a-record') },
        order: { storeHash: hashOf(null), docHash: hashOf(['b1']) },
      },
    });
  });

  it('field-level detail hashes the whole entry when it is not a record on either side', () => {
    const doc = new Y.Doc();
    doc.getMap('library').set('books', { p: 'x', m: { title: 'x' }, n: null, same: [1] });
    h.storeState = { books: { p: 'y', m: 'plain', n: { x: 1 }, same: [1] } };

    expect(storesOf(checkStoreBindings(doc)).library.keys).toEqual({
      books: {
        onlyInStore: [],
        onlyInDoc: [],
        differing: ['p', 'm', 'n'],
        fields: {
          p: { store: hashOf('y'), doc: hashOf('x') },
          m: { store: hashOf('plain'), doc: hashOf({ title: 'x' }) },
          n: { store: hashOf({ x: 1 }), doc: hashOf(null) },
        },
      },
    });
  });

  it('caps the field-level detail at the first 20 differing entries', () => {
    const storeBooks: Record<string, unknown> = {};
    const docBooks: Record<string, unknown> = {};
    for (let i = 0; i < 21; i++) {
      storeBooks[`k${i}`] = { v: 'store' };
      docBooks[`k${i}`] = { v: 'doc' };
    }
    const doc = new Y.Doc();
    doc.getMap('library').set('books', docBooks);
    h.storeState = { books: storeBooks };

    const keys = storesOf(checkStoreBindings(doc)).library.keys as Record<
      string,
      { differing: string[]; fields: Record<string, unknown> }
    >;

    expect(keys.books.differing).toHaveLength(21);
    expect(Object.keys(keys.books.fields)).toEqual(Object.keys(storeBooks).slice(0, 20));
  });

  it('reports null hydration/obsolescence for a store with no yjs handle, and reads a scoped store through its nested map', () => {
    h.syncedStores.push(
      {
        def: { name: 'vocab', syncedKeys: ['words'], hydration: 'replace', scopedDiff: false },
        store: { getState: () => ({}) },
      },
      {
        def: { name: 'preferences', syncedKeys: ['theme'], hydration: 'merge-defaults', scopedDiff: true, scope: { key: 'ui' } },
        store: {
          getState: () => ({ theme: 'dark' }),
          yjs: { flush: () => undefined, hasHydrated: () => false, isObsolete: () => true },
        },
      }
    );
    const doc = new Y.Doc();
    doc.getMap('preferences').set('ui', new Y.Map(Object.entries({ theme: 'dark' })));

    expect(checkStoreBindings(doc)).toEqual({
      verdict: 'match',
      mismatchedStores: 0,
      stores: {
        library: { verdict: 'match', hydrated: true, obsolete: false },
        vocab: { verdict: 'match', hydrated: null, obsolete: null },
        preferences: { verdict: 'match', hydrated: false, obsolete: true },
      },
    });
  });

  it('isolates a store whose state cannot be read: that store is an error, the others still report', () => {
    h.syncedStores.push({
      def: { name: 'broken', syncedKeys: ['x'], hydration: 'replace', scopedDiff: false },
      store: {
        getState: () => {
          throw new Error('store exploded');
        },
      },
    });

    expect(checkStoreBindings(new Y.Doc())).toEqual({
      verdict: 'match',
      mismatchedStores: 0,
      stores: {
        library: { verdict: 'match', hydrated: true, obsolete: false },
        broken: { verdict: 'error', error: 'Error: store exploded' },
      },
    });
  });

  it('a store value that cannot be serialized is an error for that store, never a silent match', () => {
    h.storeState = { books: BigInt(10) };

    expect(storesOf(checkStoreBindings(new Y.Doc())).library).toEqual({
      verdict: 'error',
      error: 'TypeError: Do not know how to serialize a BigInt',
    });
  });
});

describe('checkPersistence (y-idb)', () => {
  it('flags a database that holds nothing', async () => {
    const doc = new Y.Doc();
    doc.getMap('library').set('b1', 1);

    expect(await checkPersistence(doc)).toEqual({
      verdict: 'mismatch',
      flushed: 'ok',
      note: 'IndexedDB holds no Yjs state at all',
    });
  });

  it('matches when IndexedDB holds the in-memory state, and flags memory ahead of disk', async () => {
    const doc = new Y.Doc();
    doc.getMap('library').set('b1', 1);
    const diskDigest = digestOf(doc, 'library');
    await applySnapshot(Y.encodeStateAsUpdate(doc));
    const destroy = vi.spyOn(Y.Doc.prototype, 'destroy');

    const first = await checkPersistence(doc);

    expect(first).toEqual({ flushed: 'ok', diskBytes: expect.any(Number), ...MATCH });
    expect(first.diskBytes).toBeGreaterThan(0);
    expect(destroy).toHaveBeenCalledTimes(1); // the doc rebuilt from disk

    doc.getMap('library').set('b2', 2); // never persisted (no binding in this test)
    const second = await checkPersistence(doc);

    expect(second).toMatchObject({
      verdict: 'mismatch',
      flushed: 'ok',
      snapshotsEqual: false,
      contentEqual: false,
      localAhead: [{ client: doc.clientID, local: 2, other: 1 }],
      otherAhead: [],
    });
    expect(second.roots).toEqual({
      library: {
        localDigest: digestOf(doc, 'library'),
        otherDigest: diskDigest,
        onlyLocal: ['b2'],
        onlyOther: [],
        differing: [],
      },
    });
  });

  it('a doc that cannot be compared is an error, and the doc rebuilt from disk is still destroyed', async () => {
    const doc = new Y.Doc();
    doc.getMap('library').set('b1', 1);
    await applySnapshot(Y.encodeStateAsUpdate(doc));
    const destroy = vi.spyOn(Y.Doc.prototype, 'destroy');

    expect(await checkPersistence(null as unknown as Y.Doc)).toEqual({
      verdict: 'error',
      error: expect.stringMatching(/^TypeError: /),
    });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('clears its flush deadline once the flush settles (no timer left behind)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const doc = new Y.Doc();
    doc.getMap('library').set('b1', 1);

    const r = await checkPersistence(doc);

    expect(r.verdict).toBe('mismatch');
    expect(r.flushed).toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a flush that never settles is reported as "timeout" after 5s, and the disk is still read', async () => {
    startYjsPersistence();
    await waitForYjsSync();
    const binding = getYjsPersistence();
    if (!binding) throw new Error('y-idb persistence did not start');
    // A wedged y-idb write (a stalled WebKit transaction): flush() hangs forever.
    const hung = vi.spyOn(binding, 'flush').mockReturnValue(new Promise<void>(() => undefined));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const pending = checkPersistence(getYDoc());
      await vi.advanceTimersByTimeAsync(5000);

      expect(hung).toHaveBeenCalledTimes(1);
      expect(await pending).toEqual({
        verdict: 'mismatch',
        flushed: 'timeout',
        note: 'IndexedDB holds no Yjs state at all',
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
      hung.mockRestore();
      await disconnectYjs();
    }
  });
});

describe('checkRemote (y-cinder)', () => {
  it('skips when sync never composed', async () => {
    expect(await checkRemote(new Y.Doc(), 10)).toEqual({
      verdict: 'skipped',
      reason: 'sync never composed on this device',
    });
  });

  it('compares memory with the downloaded remote document, and destroys the rebuilt doc', async () => {
    const doc = new Y.Doc();
    doc.getMap('library').set('b1', 1);
    const remote = replicaOf(doc);
    remote.getMap('library').set('from-ipad', 2);
    const remoteUpdate = Y.encodeStateAsUpdate(remote);
    const timeouts: number[] = [];
    h.orchestrator = {
      getDiagnostics: () => ({ provider: { attached: true } }),
      downloadRemoteStateForDiagnostics: async (timeoutMs) => {
        timeouts.push(timeoutMs);
        return { ok: true, workspaceId: 'ws_1', update: remoteUpdate, ms: 5 };
      },
    };
    const destroy = vi.spyOn(Y.Doc.prototype, 'destroy');

    const r = await checkRemote(doc, 1234);

    expect(timeouts).toEqual([1234]);
    expect(r).toEqual({
      workspaceId: 'ws_1',
      ms: 5,
      remoteBytes: remoteUpdate.byteLength,
      providerBefore: { attached: true },
      verdict: 'mismatch',
      snapshotsEqual: false,
      contentEqual: false,
      sameOpsDifferentContent: false,
      localAhead: [],
      otherAhead: [{ client: remote.clientID, local: 0, other: 1 }],
      otherMissingBytes: EMPTY_UPDATE_BYTES,
      localMissingBytes: expect.any(Number),
      otherPendingStructs: null,
      roots: {
        library: {
          localDigest: digestOf(doc, 'library'),
          otherDigest: digestOf(remote, 'library'),
          onlyLocal: [],
          onlyOther: ['from-ipad'],
          differing: [],
        },
      },
    });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('an empty remote document (nothing uploaded yet) compares as memory ahead, not as an error', async () => {
    const doc = new Y.Doc();
    doc.getMap('library').set('b1', 1);
    h.orchestrator = {
      getDiagnostics: () => ({ provider: null }),
      downloadRemoteStateForDiagnostics: async () => ({ ok: true, workspaceId: 'ws_1', update: new Uint8Array(0), ms: 1 }),
    };

    const r = await checkRemote(doc, 10);

    expect(r).toMatchObject({
      workspaceId: 'ws_1',
      ms: 1,
      remoteBytes: 0,
      providerBefore: null,
      verdict: 'mismatch',
      localAhead: [{ client: doc.clientID, local: 1, other: 0 }],
      otherAhead: [],
    });
    expect(r.roots).toEqual({
      library: {
        localDigest: digestOf(doc, 'library'),
        otherDigest: EMPTY_MAP_DIGEST,
        onlyLocal: ['b1'],
        onlyOther: [],
        differing: [],
      },
    });
  });

  it('records a failed download as an error, never as "remote empty"', async () => {
    h.orchestrator = {
      getDiagnostics: () => ({ provider: null }),
      downloadRemoteStateForDiagnostics: async () => ({ ok: false, error: 'Error: timed out', ms: 20 }),
    };

    expect(await checkRemote(new Y.Doc(), 10)).toEqual({
      verdict: 'error',
      error: 'Error: timed out',
      ms: 20,
      providerBefore: null,
    });
  });
});

describe('runIntegrityChecks', () => {
  /** The live doc is a module singleton: give it one library entry the store agrees with. */
  const seedLiveDoc = (): Y.Doc => {
    const doc = getYDoc();
    doc.getMap('library').set('books', { b1: { title: 'x' } });
    h.storeState = { books: { b1: { title: 'x' } } };
    return doc;
  };

  it('runs all four layer checks with the 20s default remote timeout and summarizes their verdicts', async () => {
    const doc = seedLiveDoc();
    await applySnapshot(Y.encodeStateAsUpdate(doc));
    const timeouts: number[] = [];
    h.orchestrator = {
      getDiagnostics: () => ({ provider: { attached: true } }),
      downloadRemoteStateForDiagnostics: async (timeoutMs) => {
        timeouts.push(timeoutMs);
        return { ok: true, workspaceId: 'ws_1', update: Y.encodeStateAsUpdate(doc), ms: 3 };
      },
    };

    const r = await runIntegrityChecks();

    expect(timeouts).toEqual([20000]);
    expect(Object.keys(r)).toEqual(['verdicts', 'bindings', 'persistence', 'remote', 'roundTrip']);
    expect(r.verdicts).toEqual({
      'zustand-middleware-yjs (store ↔ doc)': 'match',
      'y-idb (doc ↔ IndexedDB)': 'match',
      'y-cinder (doc ↔ Firestore)': 'match',
      'yjs (encode round trip)': 'match',
    });
    expect(r.bindings).toEqual({
      verdict: 'match',
      mismatchedStores: 0,
      stores: { library: { verdict: 'match', hydrated: true, obsolete: false } },
    });
    expect(r.roundTrip).toEqual({ verdict: 'match', snapshotsEqual: true, contentEqual: true, roots: {} });
    expect(r.persistence).toMatchObject({ verdict: 'match', flushed: 'ok' });
    expect(r.remote).toMatchObject({ verdict: 'match', workspaceId: 'ws_1', ms: 3 });
  });

  it('passes an explicit remote timeout through, and each verdict reflects its own layer', async () => {
    seedLiveDoc();
    h.storeState = { books: { b1: { title: 'drifted' } } }; // store ≠ doc
    const timeouts: number[] = [];
    h.orchestrator = {
      getDiagnostics: () => ({ provider: null }),
      downloadRemoteStateForDiagnostics: async (timeoutMs) => {
        timeouts.push(timeoutMs);
        return { ok: false, error: 'Error: offline', ms: 1 };
      },
    };

    const r = await runIntegrityChecks({ remoteTimeoutMs: 777 });

    expect(timeouts).toEqual([777]);
    expect(r.verdicts).toEqual({
      'zustand-middleware-yjs (store ↔ doc)': 'mismatch',
      'y-idb (doc ↔ IndexedDB)': 'mismatch', // nothing on disk
      'y-cinder (doc ↔ Firestore)': 'error',
      'yjs (encode round trip)': 'match',
    });
    expect(r.remote).toEqual({ verdict: 'error', error: 'Error: offline', ms: 1, providerBefore: null });
  });
});

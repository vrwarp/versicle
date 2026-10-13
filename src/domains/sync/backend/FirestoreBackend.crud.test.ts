/**
 * `FirestoreBackend` — path construction, the read/write CRUD surface and
 * the shared-embedding artifact methods.
 *
 * FirestoreBackend.purge.test.ts owns the delete mechanics; the emulator
 * contract suite proves the real rules. This file covers everything else
 * over a scripted SDK: the exact document paths (a wrong one is a silent
 * cross-workspace read), the deliberately OPPOSITE failure polarities
 * (isWorkspaceAlive fails SAFE so an offline client can still queue;
 * getArtifact fails LOUD so a network blip is never mistaken for a cache
 * miss), and putArtifact's blob-before-head ordering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  db: { __db: true } as unknown | null,
  app: { __app: true } as unknown | null,
  /** doc path → the snapshot data it holds (absent = does not exist). */
  docs: new Map<string, Record<string, unknown>>(),
  /** collection path → array of {id, data}. */
  collections: new Map<string, Array<{ id: string; data: Record<string, unknown> }>>(),
  setDocCalls: [] as Array<{ path: string; data: Record<string, unknown>; opts?: unknown }>,
  deletedDocs: [] as string[],
  uploads: [] as Array<{ path: string; bytes: unknown }>,
  ops: [] as string[],
  getDocThrows: null as Error | null,
  getDocsThrows: null as Error | null,
  deleteDocThrows: null as Error | null,
  bytesByPath: new Map<string, ArrayBuffer>(),
  getBytesError: null as (Error & { code?: string }) | null,
  provider: null as Record<string, unknown> | null,
  /** waitForPendingWrites behavior: resolve, hang, or throw. */
  pendingWrites: 'ack' as 'ack' | 'hang' | 'throw',
}));

vi.mock('@lib/sync/firebase-config', () => ({
  getFirestoreDb: () => h.db,
  getFirebaseApp: () => h.app,
}));

vi.mock('y-cinder', () => ({
  FireProvider: class {
    /** y-cinder's ObservableV2 surface, scripted: `on` records, `emit` fires. */
    private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    destroys = 0;
    constructor(public readonly options: Record<string, unknown>) {
      h.ops.push('FireProvider');
      h.provider = this as unknown as Record<string, unknown>;
    }
    on(event: string, cb: (...args: unknown[]) => void) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), cb]);
    }
    off() {}
    destroy() {
      this.destroys += 1;
    }
    emit(event: string, ...args: unknown[]) {
      for (const cb of this.listeners.get(event) ?? []) cb(...args);
    }
  },
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  query: (ref: { path: string }, lim?: { n: number }) => ({ path: ref.path, limit: lim?.n }),
  limit: (n: number) => ({ n }),
  getDoc: async (ref: { path: string }) => {
    h.ops.push(`getDoc:${ref.path}`);
    if (h.getDocThrows) throw h.getDocThrows;
    const data = h.docs.get(ref.path);
    return { exists: () => data !== undefined, data: () => data };
  },
  getDocs: async (q: { path: string; limit?: number }) => {
    h.ops.push(`getDocs:${q.path}`);
    if (h.getDocsThrows) throw h.getDocsThrows;
    const all = h.collections.get(q.path) ?? [];
    const page = typeof q.limit === 'number' ? all.slice(0, q.limit) : all;
    return {
      size: page.length,
      empty: page.length === 0,
      docs: page.map((d) => ({ id: d.id, ref: { path: `${q.path}/${d.id}` }, data: () => d.data })),
    };
  },
  setDoc: async (ref: { path: string }, data: Record<string, unknown>, opts?: unknown) => {
    h.ops.push(`setDoc:${ref.path}`);
    h.setDocCalls.push({ path: ref.path, data, opts });
  },
  deleteDoc: async (ref: { path: string }) => {
    h.ops.push(`deleteDoc:${ref.path}`);
    if (h.deleteDocThrows) throw h.deleteDocThrows;
    h.deletedDocs.push(ref.path);
  },
  writeBatch: () => ({ delete: () => undefined, commit: async () => undefined }),
  waitForPendingWrites: () => {
    if (h.pendingWrites === 'throw') return Promise.reject(new Error('terminated'));
    if (h.pendingWrites === 'hang') return new Promise(() => undefined);
    return Promise.resolve();
  },
}));

vi.mock('firebase/storage', () => ({
  getStorage: () => ({ __storage: true }),
  ref: (_storage: unknown, path: string) => ({ fullPath: path }),
  listAll: async () => ({ items: [], prefixes: [] }),
  deleteObject: async () => undefined,
  uploadBytes: async (r: { fullPath: string }, bytes: unknown) => {
    h.ops.push(`uploadBytes:${r.fullPath}`);
    h.uploads.push({ path: r.fullPath, bytes });
  },
  getBytes: async (r: { fullPath: string }) => {
    h.ops.push(`getBytes:${r.fullPath}`);
    if (h.getBytesError) throw h.getBytesError;
    const bytes = h.bytesByPath.get(r.fullPath);
    if (!bytes) throw Object.assign(new Error('missing'), { code: 'storage/unknown' });
    return bytes;
  },
}));

import { FirestoreBackend } from './FirestoreBackend';

const UID = 'owner-uid';
const WS = 'ws_1';
const metaPath = `users/${UID}/workspaces/${WS}`;
const docPath = `users/${UID}/versicle/${WS}`;

const backend = () => new FirestoreBackend(UID);

/** The scripted y-cinder provider the last connect() constructed. */
const provider = () =>
  h.provider as unknown as {
    emit: (event: string, ...args: unknown[]) => void;
    destroys: number;
    options: Record<string, unknown>;
  };
const CONNECT = { maxWaitTimeMs: 1, maxUpdatesThreshold: 1 };

const notFound = (): Error & { code: string } =>
  Object.assign(new Error('not found'), { code: 'storage/object-not-found' });

beforeEach(() => {
  h.db = { __db: true };
  h.app = { __app: true };
  h.docs.clear();
  h.collections.clear();
  h.setDocCalls.length = 0;
  h.deletedDocs.length = 0;
  h.uploads.length = 0;
  h.ops.length = 0;
  h.getDocThrows = null;
  h.getDocsThrows = null;
  h.deleteDocThrows = null;
  h.bytesByPath.clear();
  h.getBytesError = null;
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FirestoreBackend — identity', () => {
  it('carries the uid it was bound to', () => {
    expect(backend().uid).toBe(UID);
  });
});

describe('FirestoreBackend.createWorkspace', () => {
  it('writes the metadata document under the workspaces index', async () => {
    const meta = { workspaceId: WS, name: 'Library', createdAt: 5, schemaVersion: 6 };

    await backend().createWorkspace(meta);

    expect(h.setDocCalls).toEqual([{ path: metaPath, data: meta, opts: undefined }]);
  });

  it('copies the metadata rather than storing the caller object', async () => {
    const meta = { workspaceId: WS, name: 'Library', createdAt: 5, schemaVersion: 6 };

    await backend().createWorkspace(meta);

    expect(h.setDocCalls[0].data).not.toBe(meta);
  });

  it('refuses when firestore is not initialized', async () => {
    h.db = null;

    await expect(
      backend().createWorkspace({ workspaceId: WS, name: 'x', createdAt: 1, schemaVersion: 6 })
    ).rejects.toThrow('Firestore not initialized');
  });
});

describe('FirestoreBackend.listWorkspaces', () => {
  const seed = (rows: Array<Record<string, unknown>>) =>
    h.collections.set(
      `users/${UID}/workspaces`,
      rows.map((r) => ({ id: r.workspaceId as string, data: r }))
    );

  it('FILTERS tombstoned workspaces by default', async () => {
    seed([
      { workspaceId: 'ws_live', name: 'Live', createdAt: 1, schemaVersion: 6 },
      { workspaceId: 'ws_gone', name: 'Gone', createdAt: 2, schemaVersion: 6, deletedAt: 9 },
    ]);

    const rows = await backend().listWorkspaces();

    expect(rows.map((r) => r.workspaceId)).toEqual(['ws_live']);
  });

  it('includes them when explicitly asked', async () => {
    seed([
      { workspaceId: 'ws_live', name: 'Live', createdAt: 1, schemaVersion: 6 },
      { workspaceId: 'ws_gone', name: 'Gone', createdAt: 2, schemaVersion: 6, deletedAt: 9 },
    ]);

    const rows = await backend().listWorkspaces({ includeDeleted: true });

    expect(rows.map((r) => r.workspaceId)).toEqual(['ws_live', 'ws_gone']);
  });

  it('filters when the option object omits the flag', async () => {
    seed([{ workspaceId: 'ws_gone', name: 'G', createdAt: 1, schemaVersion: 6, deletedAt: 1 }]);

    await expect(backend().listWorkspaces({})).resolves.toEqual([]);
  });

  it('reads the account-scoped index, not a workspace subcollection', async () => {
    seed([]);

    await backend().listWorkspaces();

    expect(h.ops).toEqual([`getDocs:users/${UID}/workspaces`]);
  });

  it('degrades to an empty list — never a throw — when the read fails', async () => {
    h.getDocsThrows = new Error('permission-denied');

    await expect(backend().listWorkspaces()).resolves.toEqual([]);
  });

  it('is empty when firestore is not initialized', async () => {
    h.db = null;

    await expect(backend().listWorkspaces()).resolves.toEqual([]);
  });
});

describe('FirestoreBackend.updateWorkspaceMetadata', () => {
  it('MERGES the patch into the metadata document', async () => {
    await backend().updateWorkspaceMetadata(WS, { schemaVersion: 7 });

    expect(h.setDocCalls).toEqual([
      { path: metaPath, data: { schemaVersion: 7 }, opts: { merge: true } },
    ]);
  });

  it('refuses when firestore is not initialized', async () => {
    h.db = null;

    await expect(backend().updateWorkspaceMetadata(WS, {})).rejects.toThrow(
      'Firestore not initialized'
    );
  });
});

describe('FirestoreBackend.isWorkspaceAlive — the fail-SAFE probe', () => {
  it('is false only for a positively tombstoned workspace', async () => {
    h.docs.set(docPath, { isDeleted: true });

    await expect(backend().isWorkspaceAlive(WS)).resolves.toBe(false);
  });

  it('is true for a document with no tombstone flag', async () => {
    h.docs.set(docPath, { content: 'x' });

    await expect(backend().isWorkspaceAlive(WS)).resolves.toBe(true);
  });

  it('is true for a MISSING document', async () => {
    await expect(backend().isWorkspaceAlive(WS)).resolves.toBe(true);
  });

  it('requires the flag to be exactly true, not merely truthy', async () => {
    h.docs.set(docPath, { isDeleted: 'yes' });

    await expect(backend().isWorkspaceAlive(WS)).resolves.toBe(true);
  });

  it('is true when the read FAILS — an offline client must still queue writes', async () => {
    h.getDocThrows = new Error('unavailable');

    await expect(backend().isWorkspaceAlive(WS)).resolves.toBe(true);
  });

  it('is true when firestore is not initialized', async () => {
    h.db = null;

    await expect(backend().isWorkspaceAlive(WS)).resolves.toBe(true);
    expect(h.ops).toEqual([]);
  });

  it('reads the replicated-document root, not the metadata index', async () => {
    await backend().isWorkspaceAlive(WS);

    expect(h.ops).toEqual([`getDoc:${docPath}`]);
  });
});

describe('FirestoreBackend.probeHasData', () => {
  it('is true from compacted CONTENT on the main document, without reading updates', async () => {
    h.docs.set(docPath, { content: 'base64' });

    await expect(backend().probeHasData(WS)).resolves.toBe(true);
    expect(h.ops.some((o) => o.includes('/updates'))).toBe(false);
  });

  it('is true from a stateVector alone', async () => {
    h.docs.set(docPath, { stateVector: 'sv' });

    await expect(backend().probeHasData(WS)).resolves.toBe(true);
  });

  it('falls through to the updates collection when the main doc is bare', async () => {
    h.docs.set(docPath, { isDeleted: false });
    h.collections.set(`${docPath}/updates`, [{ id: 'u1', data: {} }]);

    await expect(backend().probeHasData(WS)).resolves.toBe(true);
  });

  it('is false when neither the main doc nor the updates hold anything', async () => {
    await expect(backend().probeHasData(WS)).resolves.toBe(false);
  });

  it('reads at most ONE update — it is a probe, not a download', async () => {
    h.collections.set(
      `${docPath}/updates`,
      Array.from({ length: 50 }, (_, i) => ({ id: `u${i}`, data: {} }))
    );

    await expect(backend().probeHasData(WS)).resolves.toBe(true);
  });

  it('refuses when firestore is not initialized', async () => {
    h.db = null;

    await expect(backend().probeHasData(WS)).rejects.toThrow('Firestore not initialized');
  });
});

describe('FirestoreBackend.tombstoneWorkspace', () => {
  it('plants the tombstone on the DATA root first, then the metadata index', async () => {
    await backend().tombstoneWorkspace(WS);

    expect(h.setDocCalls.map((c) => c.path)).toEqual([docPath, metaPath]);
  });

  it('merges rather than replacing, so a retried delete is idempotent', async () => {
    await backend().tombstoneWorkspace(WS);

    expect(h.setDocCalls.every((c) => c.opts)).toEqual(true);
    expect(h.setDocCalls[0].opts).toEqual({ merge: true });
    expect(h.setDocCalls[1].opts).toEqual({ merge: true });
  });

  it('stamps both the flag and a real deletion time', async () => {
    await backend().tombstoneWorkspace(WS);

    expect(h.setDocCalls[0].data.isDeleted).toBe(true);
    expect(h.setDocCalls[0].data.deletedAt).toEqual(expect.any(Number));
    expect(h.setDocCalls[1].data).toEqual({ deletedAt: expect.any(Number) });
  });

  it('refuses when firestore is not initialized', async () => {
    h.db = null;

    await expect(backend().tombstoneWorkspace(WS)).rejects.toThrow('Firestore not initialized');
  });
});

describe('FirestoreBackend.headArtifact', () => {
  it('reads the head record under the workspace prefix and projects it', async () => {
    h.docs.set(`${docPath}/embedCache/abc`, { stamp: 's1', size: 42 });

    await expect(backend().headArtifact(WS, 'embedCache/abc')).resolves.toEqual({
      exists: true,
      stamp: 's1',
      size: 42,
    });
    expect(h.ops).toEqual([`getDoc:${docPath}/embedCache/abc`]);
  });

  it('is null on a miss — never `{ exists: false }`', async () => {
    await expect(backend().headArtifact(WS, 'embedCache/nope')).resolves.toBeNull();
  });

  it('refuses when firestore is not initialized', async () => {
    h.db = null;

    await expect(backend().headArtifact(WS, 'embedCache/abc')).rejects.toThrow(
      'Firestore not initialized'
    );
  });
});

describe('FirestoreBackend.putArtifact', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const meta = { stamp: 's1', size: 3 };

  it('uploads the BLOB first and writes the head second', async () => {
    await backend().putArtifact(WS, 'embeddings/abc.bin', bytes, meta);

    expect(h.ops).toEqual([
      `getDoc:${docPath}/embedCache/abc`,
      `uploadBytes:${docPath}/embeddings/abc.bin`,
      `setDoc:${docPath}/embedCache/abc`,
    ]);
  });

  it('stamps the head with the metadata and a creation time', async () => {
    await backend().putArtifact(WS, 'embeddings/abc.bin', bytes, meta);

    expect(h.setDocCalls[0].data).toEqual({
      stamp: 's1',
      size: 3,
      createdAt: expect.any(Number),
    });
  });

  it('is a NO-OP when the head already exists', async () => {
    h.docs.set(`${docPath}/embedCache/abc`, { stamp: 's1', size: 3 });

    await backend().putArtifact(WS, 'embeddings/abc.bin', bytes, meta);

    expect(h.uploads).toEqual([]);
    expect(h.setDocCalls).toEqual([]);
  });

  it('uploads the caller bytes verbatim', async () => {
    await backend().putArtifact(WS, 'embeddings/abc.bin', bytes, meta);

    expect(h.uploads[0].bytes).toBe(bytes);
  });

  it('refuses without firestore, and without a firebase app', async () => {
    h.db = null;
    await expect(backend().putArtifact(WS, 'embeddings/a.bin', bytes, meta)).rejects.toThrow(
      'Firestore not initialized'
    );

    h.db = { __db: true };
    h.app = null;
    await expect(backend().putArtifact(WS, 'embeddings/a.bin', bytes, meta)).rejects.toThrow(
      'Firebase app not available'
    );
    expect(h.uploads).toEqual([]);
  });
});

describe('FirestoreBackend.getArtifact — the fail-LOUD read', () => {
  it('returns the blob bytes from the workspace-scoped path', async () => {
    const buffer = new ArrayBuffer(8);
    h.bytesByPath.set(`${docPath}/embeddings/abc.bin`, buffer);

    await expect(backend().getArtifact(WS, 'embeddings/abc.bin')).resolves.toBe(buffer);
  });

  it('is null for a DEFINITIVE miss', async () => {
    h.getBytesError = notFound();

    await expect(backend().getArtifact(WS, 'embeddings/abc.bin')).resolves.toBeNull();
  });

  it('RETHROWS a transient failure — an offline blip is not a cache miss', async () => {
    h.getBytesError = Object.assign(new Error('unavailable'), { code: 'storage/retry-limit' });

    await expect(backend().getArtifact(WS, 'embeddings/abc.bin')).rejects.toThrow('unavailable');
  });

  it('rethrows an error with no code at all', async () => {
    h.getBytesError = new Error('boom');

    await expect(backend().getArtifact(WS, 'embeddings/abc.bin')).rejects.toThrow('boom');
  });

  it('refuses without a firebase app', async () => {
    h.app = null;

    await expect(backend().getArtifact(WS, 'embeddings/abc.bin')).rejects.toThrow(
      'Firebase app not available'
    );
  });
});

describe('FirestoreBackend.deleteArtifactHead', () => {
  it('deletes the HEAD record only — never the shared blob', async () => {
    await backend().deleteArtifactHead(WS, 'embedCache/abc');

    expect(h.deletedDocs).toEqual([`${docPath}/embedCache/abc`]);
    expect(h.ops.some((o) => o.startsWith('deleteObject'))).toBe(false);
  });

  it('is best-effort: an already-gone record is a clean no-op', async () => {
    h.deleteDocThrows = new Error('not-found');

    await expect(backend().deleteArtifactHead(WS, 'embedCache/abc')).resolves.toBeUndefined();
  });

  it('refuses when firestore is not initialized', async () => {
    h.db = null;

    await expect(backend().deleteArtifactHead(WS, 'embedCache/abc')).rejects.toThrow(
      'Firestore not initialized'
    );
  });
});

describe('FirestoreBackend.connect', () => {
  it('refuses without a firebase app', () => {
    h.app = null;

    expect(() => backend().connect({} as never, WS, CONNECT)).toThrow('Firebase app not available');
  });

  it('binds the provider to the workspace-scoped document path with the caller tuning', () => {
    const ydoc = {} as never;

    backend().connect(ydoc, WS, { maxWaitTimeMs: 250, maxUpdatesThreshold: 40 });

    expect(h.ops).toEqual(['FireProvider']);
    expect(provider().options).toEqual({
      firebaseApp: h.app,
      ydoc,
      path: docPath,
      maxWaitTime: 250,
      maxUpdatesThreshold: 40,
    });
  });

  it('forwards every normalized provider event onto the connection surface', () => {
    const conn = backend().connect({} as never, WS, CONNECT);
    const seen: Array<[string, unknown[]]> = [];
    conn.on('synced', () => seen.push(['synced', []]));
    conn.on('saved', (at) => seen.push(['saved', [at]]));
    conn.on('connection-error', (e) => seen.push(['connection-error', [e]]));
    conn.on('sync-failure', (e) => seen.push(['sync-failure', [e]]));
    conn.on('save-rejected', (e) => seen.push(['save-rejected', [e]]));
    conn.on('corrupted-document', (e) => seen.push(['corrupted-document', [e]]));
    conn.on('epoch-changed', (e) => seen.push(['epoch-changed', [e]]));

    // `sync(false)` is NOT a handshake; only `sync(true)` is `synced`.
    provider().emit('sync', false);
    expect(seen).toEqual([]);

    provider().emit('sync', true);
    provider().emit('saved', 1_700_000_000_000);
    provider().emit('connection-error', { code: 'unavailable' });
    provider().emit('sync-failure', { code: 'permission-denied' });
    provider().emit('save-rejected', { code: 'document-too-large', sizeBytes: 9 });
    provider().emit('corrupted-document', { docId: 'updates/u-9' });
    provider().emit('epoch-changed', { previousEpoch: 3, epoch: 4 });
    provider().emit('squashed', { epoch: 5 });

    expect(seen).toEqual([
      ['synced', []],
      ['saved', [1_700_000_000_000]],
      ['connection-error', [{ code: 'unavailable' }]],
      ['sync-failure', [{ code: 'permission-denied' }]],
      ['save-rejected', [{ code: 'document-too-large', sizeBytes: 9 }]],
      ['corrupted-document', [{ docId: 'updates/u-9' }]],
      ['epoch-changed', [{ epoch: 4, previousEpoch: 3, self: false }]],
      ['epoch-changed', [{ epoch: 5, previousEpoch: 4, self: true }]],
    ]);
  });

  it('leaves diagnostics breadcrumbs for the sync state and compaction failures', () => {
    backend().connect({} as never, WS, CONNECT);
    const quota = new Error('quota');

    provider().emit('sync', true);
    provider().emit('sync', false);
    provider().emit('compaction-failed', { consecutiveFailures: 3, retryInMs: 500, error: quota });
    provider().emit('compaction-failed', {});

    expect(console.info).toHaveBeenCalledWith('[FirestoreBackend]', 'Provider sync state: synced');
    expect(console.info).toHaveBeenCalledWith('[FirestoreBackend]', 'Provider sync state: not synced');
    expect(console.warn).toHaveBeenNthCalledWith(
      1,
      '[FirestoreBackend]',
      'Compaction failed (3 in a row; retry in 500ms)',
      quota
    );
    expect(console.warn).toHaveBeenNthCalledWith(
      2,
      '[FirestoreBackend]',
      'Compaction failed (? in a row; retry in ?ms)',
      undefined
    );
  });

  it('destroy() tears the provider down exactly once', () => {
    const conn = backend().connect({} as never, WS, CONNECT);

    conn.destroy();
    conn.destroy();

    expect(provider().destroys).toBe(1);
    expect(conn.describe?.()).toMatchObject({ destroyed: true });
  });

  it('describe() reports the provider state without driving it', () => {
    const before = Date.now();
    const conn = backend().connect({} as never, WS, CONNECT);
    const corrupted = Array.from({ length: 51 }, (_, i) => `d${i}`);
    Object.assign(h.provider!, {
      synced: true,
      epoch: 2,
      isCompacting: true,
      _isDestroyed: false,
      _epochFenced: false,
      _initialSyncInFlight: true,
      // Only byte payloads count towards pendingBytes; every entry counts as an update.
      _pendingUpdates: [new Uint8Array(3), new Uint8Array(4), 'not-bytes'],
      _pendingSince: 1_700_000_000_000,
      _inflightSave: Promise.resolve(),
      _deferredUpdateBlobs: new Map([
        ['b1', 1],
        ['b2', 2],
      ]),
      _saveRetryCount: 1,
      _syncRetryCount: 2,
      _offlineRetryCount: 3,
      _listenerRetryCount: 4,
      _listenersAttachedAt: 1_700_000_000_500,
      _unsubscribers: [() => undefined, () => undefined, () => undefined],
      _corruptedDocIds: new Set(corrupted),
      _compactionFailures: 5,
      _compactionBackoffUntil: 1_700_000_001_000,
      _cachedClockOffset: -42,
      maxWaitTime: 1,
      maxUpdatesThreshold: 1,
    });

    const d = conn.describe?.();

    expect(d).toEqual({
      transport: 'firestore',
      path: docPath,
      connectedAt: expect.any(Number),
      destroyed: false,
      synced: true,
      epoch: 2,
      isCompacting: true,
      providerDestroyed: false,
      epochFenced: false,
      initialSyncInFlight: true,
      pendingUpdates: 3,
      pendingBytes: 7,
      pendingSince: 1_700_000_000_000,
      saveInFlight: true,
      deferredUpdateBlobs: 2,
      saveRetryCount: 1,
      syncRetryCount: 2,
      offlineRetryCount: 3,
      listenerRetryCount: 4,
      listenersAttachedAt: 1_700_000_000_500,
      activeListeners: 3,
      // Capped at 50 ids — the export must stay small.
      corruptedDocIds: corrupted.slice(0, 50),
      compactionFailures: 5,
      compactionBackoffUntil: 1_700_000_001_000,
      clockOffsetMs: -42,
      maxWaitTime: 1,
      maxUpdatesThreshold: 1,
    });
    expect(d?.connectedAt as number).toBeGreaterThanOrEqual(before);
    expect(d?.connectedAt as number).toBeLessThanOrEqual(Date.now());
    expect(provider().destroys).toBe(0);
    conn.destroy();
    expect(conn.describe?.()).toMatchObject({ destroyed: true });
  });

  it('describe() on a bare provider reports absent fields as undefined and no save in flight — never throws', () => {
    const conn = backend().connect({} as never, WS, CONNECT);
    Object.assign(h.provider!, { _corruptedDocIds: ['not-a-set'], _deferredUpdateBlobs: new Set(['x']) });

    expect(conn.describe?.()).toEqual({
      transport: 'firestore',
      path: docPath,
      connectedAt: expect.any(Number),
      destroyed: false,
      saveInFlight: false,
      // A Set counts like a Map; an array of ids is not the Set the provider keeps.
      deferredUpdateBlobs: 1,
      corruptedDocIds: undefined,
      pendingUpdates: undefined,
      pendingBytes: undefined,
    });
  });

  it('describe() survives a provider whose getters throw', () => {
    const conn = backend().connect({} as never, WS, CONNECT);
    const boom = () => {
      throw new Error('getter exploded');
    };
    Object.defineProperty(h.provider!, 'synced', { get: boom });
    Object.defineProperty(h.provider!, '_pendingSince', { get: boom });
    Object.assign(h.provider!, { epoch: 7 });

    expect(conn.describe?.()).toMatchObject({ epoch: 7, destroyed: false });
    expect(conn.describe?.()).toEqual(
      expect.not.objectContaining({ synced: expect.anything(), pendingSince: expect.anything() })
    );
  });
});

describe('FirestoreBackend.probePendingWrites (diagnostics)', () => {
  afterEach(() => {
    h.pendingWrites = 'ack';
  });

  it('acknowledged when the issued writes are acked in time', async () => {
    expect(await backend().probePendingWrites(50)).toMatchObject({ state: 'acknowledged' });
  });

  it("stuck when they are not — the 'receives but never sends' signature", async () => {
    h.pendingWrites = 'hang';
    expect(await backend().probePendingWrites(20)).toMatchObject({ state: 'stuck', ms: expect.any(Number) });
  });

  it('unavailable without a db, or when the SDK throws', async () => {
    h.pendingWrites = 'throw';
    expect(await backend().probePendingWrites(20)).toMatchObject({ state: 'unavailable', error: 'Error: terminated' });
    h.db = null;
    expect(await backend().probePendingWrites(20)).toMatchObject({ state: 'unavailable' });
  });
});

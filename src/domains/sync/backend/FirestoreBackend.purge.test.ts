/**
 * FirestoreBackend honest-delete purge mechanics (P4-6) — the unit half of
 * the purge acceptance: the emulator contract case proves the Firestore
 * residual sweep under the REAL rules (syncBackendContract.emulator.test.ts,
 * capabilities.purge), but the Storage-blob half needs a Storage emulator
 * the lane doesn't run — so the listAll recursion, the ≤500 batching, the
 * exact prefix scoping (risk R8), and the storage-failure tolerance are
 * pinned here over mocked SDK modules.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  /** Firestore residual docs: collection path → fake doc refs. */
  const docsByPath = new Map<string, Array<{ id: number }>>();
  /** Storage tree: folder path → { items: file names, prefixes: subfolder names }. */
  const storageTree = new Map<string, { items: string[]; prefixes: string[] }>();
  return {
    docsByPath,
    storageTree,
    deletedBlobs: [] as string[],
    failingBlobs: new Set<string>(),
    batchCommits: [] as number[],
    setDocCalls: [] as Array<{ path: string; data: Record<string, unknown> }>,
    storageBroken: false,
  };
});

vi.mock('@lib/sync/firebase-config', () => ({
  getFirestoreDb: vi.fn(() => ({ __db: true })),
  getFirebaseApp: vi.fn(() => ({ __app: true })),
}));

vi.mock('y-cinder', () => ({ FireProvider: vi.fn() }));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => undefined })),
  setDoc: vi.fn(async (ref: { path: string }, data: Record<string, unknown>) => {
    h.setDocCalls.push({ path: ref.path, data });
  }),
  collection: vi.fn((_db: unknown, path: string) => ({ path })),
  query: vi.fn((ref: { path: string }, lim: { n: number }) => ({ path: ref.path, limit: lim.n })),
  limit: vi.fn((n: number) => ({ n })),
  getDocs: vi.fn(async (q: { path: string; limit?: number }) => {
    const docs = h.docsByPath.get(q.path) ?? [];
    const page = typeof q.limit === 'number' ? docs.slice(0, q.limit) : docs;
    return {
      size: page.length,
      empty: page.length === 0,
      docs: page.map((d) => ({
        ref: { __collection: q.path, __id: d.id },
        data: () => ({}),
      })),
    };
  }),
  writeBatch: vi.fn(() => {
    const pending: Array<{ __collection: string; __id: number }> = [];
    return {
      delete: (ref: { __collection: string; __id: number }) => pending.push(ref),
      commit: async () => {
        for (const ref of pending) {
          const docs = h.docsByPath.get(ref.__collection) ?? [];
          h.docsByPath.set(
            ref.__collection,
            docs.filter((d) => d.id !== ref.__id)
          );
        }
        h.batchCommits.push(pending.length);
      },
    };
  }),
}));

vi.mock('firebase/storage', () => ({
  getStorage: vi.fn(() => {
    if (h.storageBroken) throw new Error('No default bucket configured');
    return { __storage: true };
  }),
  ref: vi.fn((_storage: unknown, path: string) => ({ fullPath: path })),
  listAll: vi.fn(async (folder: { fullPath: string }) => {
    const node = h.storageTree.get(folder.fullPath) ?? { items: [], prefixes: [] };
    return {
      items: node.items.map((name) => ({ fullPath: `${folder.fullPath}/${name}` })),
      prefixes: node.prefixes.map((name) => ({ fullPath: `${folder.fullPath}/${name}` })),
    };
  }),
  deleteObject: vi.fn(async (item: { fullPath: string }) => {
    if (h.failingBlobs.has(item.fullPath)) {
      const error = new Error('not found') as Error & { code: string };
      error.code = 'storage/object-not-found';
      throw error;
    }
    h.deletedBlobs.push(item.fullPath);
  }),
}));

import { FirestoreBackend } from './FirestoreBackend';

const UID = 'owner-uid';
const WS = 'ws_doomed';
const root = `users/${UID}/versicle/${WS}`;

const seedDocs = (path: string, count: number): void => {
  h.docsByPath.set(
    path,
    Array.from({ length: count }, (_, i) => ({ id: i }))
  );
};

describe('FirestoreBackend.purgeWorkspace (P4-6 honest delete)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.docsByPath.clear();
    h.storageTree.clear();
    h.deletedBlobs.length = 0;
    h.failingBlobs.clear();
    h.batchCommits.length = 0;
    h.setDocCalls.length = 0;
    h.storageBroken = false;
  });

  it('sweeps all four y-cinder subcollections and reports the doc count', async () => {
    seedDocs(`${root}/updates`, 3);
    seedDocs(`${root}/history`, 2);
    seedDocs(`${root}/maintenance`, 1);
    seedDocs(`${root}/metadata`, 1);
    // A sibling workspace's residuals must be untouched (risk R8).
    seedDocs(`users/${UID}/versicle/ws_sibling/updates`, 5);

    const report = await new FirestoreBackend(UID).purgeWorkspace(WS);

    expect(report.docsDeleted).toBe(7);
    for (const sub of ['updates', 'history', 'maintenance', 'metadata']) {
      expect(h.docsByPath.get(`${root}/${sub}`)).toEqual([]);
    }
    expect(h.docsByPath.get(`users/${UID}/versicle/ws_sibling/updates`)).toHaveLength(5);
  });

  it('loops the ≤500 batch window until a subcollection is drained', async () => {
    seedDocs(`${root}/updates`, 1203);

    const report = await new FirestoreBackend(UID).purgeWorkspace(WS);

    expect(report.docsDeleted).toBe(1203);
    expect(h.docsByPath.get(`${root}/updates`)).toEqual([]);
    // 500 + 500 + 203 for updates; the other three subcollections are empty.
    expect(h.batchCommits.filter((n) => n > 0)).toEqual([500, 500, 203]);
  });

  it('deletes Storage blobs recursively under exactly the workspace prefix', async () => {
    h.storageTree.set(root, {
      items: ['snapshot_v3.bin', 'snapshot_v4.bin'],
      prefixes: ['large_updates'],
    });
    h.storageTree.set(`${root}/large_updates`, {
      items: ['oversize-1.bin'],
      prefixes: [],
    });
    // Sibling blobs exist but are never listed/deleted (scoping is by the
    // ref the backend constructs — assert the deleted set, R8).
    h.storageTree.set(`users/${UID}/versicle/ws_sibling`, {
      items: ['snapshot_v9.bin'],
      prefixes: [],
    });

    const report = await new FirestoreBackend(UID).purgeWorkspace(WS);

    expect(report.blobsDeleted).toBe(3);
    expect(h.deletedBlobs.sort()).toEqual([
      `${root}/large_updates/oversize-1.bin`,
      `${root}/snapshot_v3.bin`,
      `${root}/snapshot_v4.bin`,
    ]);
  });

  it('treats already-gone blobs as deleted-by-someone-else, not failures', async () => {
    h.storageTree.set(root, { items: ['snapshot_v3.bin', 'gone.bin'], prefixes: [] });
    h.failingBlobs.add(`${root}/gone.bin`);

    const report = await new FirestoreBackend(UID).purgeWorkspace(WS);

    expect(report.blobsDeleted).toBe(1);
    expect(h.deletedBlobs).toEqual([`${root}/snapshot_v3.bin`]);
  });

  it('a project without Storage still purges Firestore residuals (blobs reported 0)', async () => {
    seedDocs(`${root}/history`, 4);
    h.storageBroken = true;

    const report = await new FirestoreBackend(UID).purgeWorkspace(WS);

    expect(report).toEqual({ docsDeleted: 4, blobsDeleted: 0 });
  });

  it('tombstoneWorkspace plants the root tombstone and the metadata deletedAt (no data purge)', async () => {
    seedDocs(`${root}/updates`, 2);

    await new FirestoreBackend(UID).tombstoneWorkspace(WS);

    expect(h.setDocCalls).toHaveLength(2);
    expect(h.setDocCalls[0].path).toBe(root);
    expect(h.setDocCalls[0].data).toMatchObject({ isDeleted: true });
    expect(h.setDocCalls[1].path).toBe(`users/${UID}/workspaces/${WS}`);
    expect(h.setDocCalls[1].data).toMatchObject({ deletedAt: expect.any(Number) });
    // Tombstoning closes the workspace; the residual sweep is purge's job.
    expect(h.docsByPath.get(`${root}/updates`)).toHaveLength(2);
  });
});

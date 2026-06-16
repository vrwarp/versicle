/**
 * `MockBackend` — the E2E/dev C3 implementation, absorbing
 * FirestoreSyncManager's `__VERSICLE_MOCK_FIRESTORE__` branches verbatim
 * (FirestoreSyncManager.ts @ fb3dcd3f: validateWorkspaceIsAlive :213-227,
 * performCleanSync mock probe :408-425, createWorkspace :684-690,
 * listWorkspaces :863-867, deleteWorkspace :894-918) plus the
 * MockFireProvider transport.
 *
 * Selected ONLY at the composition root (src/app/sync/createSync.ts) behind
 * `import.meta.env.DEV || VITE_E2E` + `isMockFirestoreEnabled()` via a
 * dynamic import in a dead-in-prod branch (boundary rule 9), so Rollup
 * drops this module — and MockFireProvider with it — from production
 * bundles. The chunk-content check (scripts/check-worker-chunk.mjs) is the
 * gate, not this comment.
 *
 * Storage layout (shared with the Playwright suite, which seeds/reads it):
 *  - `__VERSICLE_WORKSPACES__`: JSON WorkspaceMetadata[] directory
 *  - `versicle_mock_firestore_snapshot`: per-path doc snapshots/tombstones
 *
 * Shared embedding cache: the head/put/get/delete methods are an in-memory
 * `Map` round-trip (no real Cloud Storage tier — purgeWorkspace still reports
 * `blobsDeleted:0`). It gives the shared C3 contract cases real put/head/get
 * semantics WITHOUT an emulator, but the blob-before-head write ordering and
 * the crash/offline fail-safes are pinned ONLY by the emulator suite
 * (syncBackendContract.emulator.test.ts).
 */
import type * as Y from 'yjs';
import { createLogger } from '@lib/logger';
import type { WorkspaceMetadata } from '~types/workspace';
import type {
  ArtifactHead,
  ConnectOptions,
  PurgeReport,
  SyncBackend,
  SyncConnection,
} from './SyncBackend';
import { artifactHeadTail, observeWorkspaceMetadata } from './SyncBackend';
import { createSyncConnectionEmitter } from './connectionEvents';
import { MockFireProvider } from './MockFireProvider';

const logger = createLogger('MockBackend');

const WORKSPACES_KEY = '__VERSICLE_WORKSPACES__';
const SNAPSHOT_KEY = 'versicle_mock_firestore_snapshot';

const readWorkspaces = (): WorkspaceMetadata[] =>
  JSON.parse(localStorage.getItem(WORKSPACES_KEY) || '[]');

const writeWorkspaces = (workspaces: WorkspaceMetadata[]): void =>
  localStorage.setItem(WORKSPACES_KEY, JSON.stringify(workspaces));

type MockSnapshotEntry = {
  snapshotBase64?: string;
  isDeleted?: boolean;
  deletedAt?: number;
};

const readSnapshots = (): Record<string, MockSnapshotEntry> =>
  JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || '{}');

const writeSnapshots = (snapshots: Record<string, MockSnapshotEntry>): void =>
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshots));

/**
 * The in-memory store for the shared embedding cache: the mock has no real
 * Cloud Storage tier, so the put/head/get round-trip is one `Map` keyed by the
 * full artifact path. Module-level (not localStorage: ArrayBuffers don't
 * serialize and this store is test-only here); {@link clearMockArtifacts} wipes
 * it for the harness's per-test reset, mirroring
 * MockFireProvider.clearMockStorage.
 */
const artifactStore = new Map<
  string,
  { bytes: ArrayBuffer; stamp: string; size: number; createdAt: number }
>();

/** Wipe the embedding-cache store (per-test reset; mirrors clearMockStorage). */
export const clearMockArtifacts = (): void => {
  artifactStore.clear();
};

/** Normalize a put payload to an owned ArrayBuffer copy (Uint8Array view → buffer). */
const toArrayBuffer = (bytes: ArrayBuffer | Uint8Array): ArrayBuffer =>
  bytes instanceof Uint8Array
    ? bytes.slice().buffer
    : bytes.slice(0);

export class MockBackend implements SyncBackend {
  constructor(readonly uid: string) {}

  private docPath(workspaceId: string): string {
    return `users/${this.uid}/versicle/${workspaceId}`;
  }

  /** Full artifact path from an in-workspace tail (mirrors FirestoreBackend). */
  private artifactPath(workspaceId: string, relPath: string): string {
    return `${this.docPath(workspaceId)}/${relPath}`;
  }

  async createWorkspace(meta: WorkspaceMetadata): Promise<void> {
    writeWorkspaces([...readWorkspaces(), meta]);
    logger.info(`[Mock] Created workspace: ${meta.name} (${meta.workspaceId})`);
  }

  async listWorkspaces(opts?: { includeDeleted?: boolean }): Promise<WorkspaceMetadata[]> {
    const all = observeWorkspaceMetadata(readWorkspaces(), 'mock.listWorkspaces');
    return opts?.includeDeleted ? all : all.filter((ws) => !ws.deletedAt);
  }

  async updateWorkspaceMetadata(
    workspaceId: string,
    patch: Partial<WorkspaceMetadata>
  ): Promise<void> {
    writeWorkspaces(
      readWorkspaces().map((ws) =>
        ws.workspaceId === workspaceId ? { ...ws, ...patch } : ws
      )
    );
  }

  async isWorkspaceAlive(workspaceId: string): Promise<boolean> {
    // Check both the metadata list and the document snapshot.
    const ws = readWorkspaces().find((w) => w.workspaceId === workspaceId);
    if (ws && ws.deletedAt) return false;
    if (readSnapshots()[this.docPath(workspaceId)]?.isDeleted) return false;
    return true;
  }

  async probeHasData(workspaceId: string): Promise<boolean> {
    return Boolean(readSnapshots()[this.docPath(workspaceId)]?.snapshotBase64);
  }

  async tombstoneWorkspace(workspaceId: string): Promise<void> {
    // Tombstone the directory entry…
    writeWorkspaces(
      readWorkspaces().map((ws) =>
        ws.workspaceId === workspaceId ? { ...ws, deletedAt: Date.now() } : ws
      )
    );
    // …and the snapshot store. MERGE (not replace): the tombstone closes
    // the workspace; removing the residual data is purgeWorkspace's job —
    // the same split the real backend has (tombstone vs subcollection
    // sweep).
    const snapshots = readSnapshots();
    snapshots[this.docPath(workspaceId)] = {
      ...snapshots[this.docPath(workspaceId)],
      isDeleted: true,
      deletedAt: Date.now(),
    };
    writeSnapshots(snapshots);
    logger.info(`[Mock] Workspace tombstoned: ${workspaceId}`);
  }

  async purgeWorkspace(workspaceId: string): Promise<PurgeReport> {
    const snapshots = readSnapshots();
    const entry = snapshots[this.docPath(workspaceId)];
    const hadData = Boolean(entry?.snapshotBase64);
    if (hadData) {
      delete entry.snapshotBase64;
      writeSnapshots(snapshots);
    }
    // Sweep the cached-embedding head records (+ their in-Map "blobs") under
    // this workspace's prefix — the mock mirror of the real backend's
    // `embedCache` PURGE_SUBCOLLECTIONS entry. Each Map entry stands in for one
    // head record; counted as a doc (the mock has no separate Storage tier).
    const prefix = `${this.docPath(workspaceId)}/`;
    let artifactDocs = 0;
    for (const key of [...artifactStore.keys()]) {
      if (key.startsWith(prefix)) {
        artifactStore.delete(key);
        artifactDocs += 1;
      }
    }
    logger.info(`[Mock] Workspace purged: ${workspaceId} (hadData=${hadData})`);
    // The mock's "subcollections" are its one snapshot blob + cached-embedding
    // head records; no Storage tier.
    return { docsDeleted: (hadData ? 1 : 0) + artifactDocs, blobsDeleted: 0 };
  }

  // Shared embedding cache. The store is keyed by the head-record path so
  // head/put/get all resolve to one canonical entry; put/get pass the blob tail
  // and derive the sibling head tail via artifactHeadTail (same as
  // FirestoreBackend).

  async headArtifact(
    workspaceId: string,
    relPath: string
  ): Promise<ArtifactHead | null> {
    // relPath is the head-record tail (`embedCache/{key}`).
    const entry = artifactStore.get(this.artifactPath(workspaceId, relPath));
    if (!entry) return null;
    return { exists: true, stamp: entry.stamp, size: entry.size };
  }

  async putArtifact(
    workspaceId: string,
    relPath: string,
    bytes: ArrayBuffer | Uint8Array,
    meta: { stamp: string; size: number }
  ): Promise<void> {
    // relPath is the blob tail (`embeddings/{key}.bin`); key by the sibling
    // head-record path so headArtifact finds it.
    const headPath = this.artifactPath(workspaceId, artifactHeadTail(relPath));
    // Skip-if-present: a no-op if the key already exists (the key is derived
    // from the embedding inputs, so identical inputs mean identical content).
    if (artifactStore.has(headPath)) return;
    artifactStore.set(headPath, {
      bytes: toArrayBuffer(bytes),
      stamp: meta.stamp,
      size: meta.size,
      // createdAt drives the sweepArtifacts TTL/budget math (mirrors the
      // FirestoreBackend head-record createdAt field).
      createdAt: Date.now(),
    });
  }

  async getArtifact(
    workspaceId: string,
    relPath: string
  ): Promise<ArrayBuffer | null> {
    // relPath is the blob tail (`embeddings/{key}.bin`); look it up by its
    // sibling head-record path.
    const headPath = this.artifactPath(workspaceId, artifactHeadTail(relPath));
    return artifactStore.get(headPath)?.bytes ?? null;
  }

  async deleteArtifactHead(workspaceId: string, relPath: string): Promise<void> {
    // relPath is the head-record tail (`embedCache/{key}`). The mock has no
    // separate Storage tier, so the single Map entry collapses head record +
    // blob: deleting it removes both. The "delete the head record but KEEP the
    // shared blob" guarantee therefore CANNOT be proven on the mock — that
    // invariant is pinned only on the FirestoreBackend/emulator path; the mock
    // pins the head-removal semantics.
    artifactStore.delete(this.artifactPath(workspaceId, relPath));
  }

  async sweepArtifacts(
    workspaceId: string,
    opts: { ttlMs: number; now: number; budgetBytes?: number }
  ): Promise<{ headsDeleted: number; blobsDeleted: number }> {
    // Iterate the head-record-keyed Map entries under this workspace's prefix;
    // the mock collapses head record + blob into one entry, so blobsDeleted
    // mirrors headsDeleted (counted once per entry).
    const prefix = `${this.docPath(workspaceId)}/embedCache/`;
    const entries: { path: string; createdAt: number; size: number }[] = [];
    for (const [path, entry] of artifactStore) {
      if (path.startsWith(prefix)) {
        entries.push({ path, createdAt: entry.createdAt, size: entry.size });
      }
    }

    const cutoff = opts.now - opts.ttlMs;
    const victims = new Set<string>();
    for (const entry of entries) {
      if (entry.createdAt < cutoff) victims.add(entry.path);
    }

    if (typeof opts.budgetBytes === 'number') {
      const survivors = entries.filter((e) => !victims.has(e.path));
      let totalBytes = survivors.reduce((s, e) => s + e.size, 0);
      const oldestFirst = survivors.slice().sort((a, b) => a.createdAt - b.createdAt);
      for (const entry of oldestFirst) {
        if (totalBytes <= opts.budgetBytes) break;
        victims.add(entry.path);
        totalBytes -= entry.size;
      }
    }

    let headsDeleted = 0;
    for (const path of victims) {
      artifactStore.delete(path);
      headsDeleted += 1;
    }
    return { headsDeleted, blobsDeleted: headsDeleted };
  }

  connect(ydoc: Y.Doc, workspaceId: string, opts: ConnectOptions): SyncConnection {
    const provider = new MockFireProvider({
      firebaseApp: null,
      ydoc,
      path: this.docPath(workspaceId),
      maxWaitTime: opts.maxWaitTimeMs,
      maxUpdatesThreshold: opts.maxUpdatesThreshold,
    });

    const emitter = createSyncConnectionEmitter();
    provider.on('sync', (isSynced) => {
      if (isSynced) emitter.emit('synced');
    });
    provider.on('connection-error', (event) => emitter.emit('connection-error', event));
    provider.on('sync-failure', (error) => emitter.emit('sync-failure', error));
    provider.on('save-rejected', (event) => emitter.emit('save-rejected', event));
    provider.on('corrupted-document', (event) => emitter.emit('corrupted-document', event));
    provider.on('saved', (at) => emitter.emit('saved', at));

    let destroyed = false;
    return {
      on: emitter.on,
      off: emitter.off,
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        provider.destroy();
      },
    };
  }
}

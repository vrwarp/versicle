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
 */
import type * as Y from 'yjs';
import { createLogger } from '@lib/logger';
import type { WorkspaceMetadata } from '~types/workspace';
import type {
  ConnectOptions,
  PurgeReport,
  SyncBackend,
  SyncConnection,
} from './SyncBackend';
import { observeWorkspaceMetadata } from './SyncBackend';
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

export class MockBackend implements SyncBackend {
  constructor(readonly uid: string) {}

  private docPath(workspaceId: string): string {
    return `users/${this.uid}/versicle/${workspaceId}`;
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
    logger.info(`[Mock] Workspace purged: ${workspaceId} (hadData=${hadData})`);
    // The mock's "subcollections" are its one snapshot blob; no Storage.
    return { docsDeleted: hadData ? 1 : 0, blobsDeleted: 0 };
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

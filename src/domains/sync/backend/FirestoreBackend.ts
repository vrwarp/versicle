/**
 * `FirestoreBackend` — the production C3 implementation, absorbing
 * FirestoreSyncManager's real (non-mock) branches verbatim
 * (phase4-sync-strangler.md §D1/§D2; FirestoreSyncManager.ts @ fb3dcd3f:
 * validateWorkspaceIsAlive :229-247, performCleanSync probe :386-407,
 * connectFireProviderNormal :515-535, createWorkspace :691-698,
 * listWorkspaces :869-882, deleteWorkspace :920-957).
 *
 * This is the ONLY sync module that may import `firebase/firestore` or
 * `firebase/storage` (boundary: every other sync module talks
 * `SyncBackend`; the storage import exists solely for the P4-6 honest
 * delete's blob purge).
 *
 * Paths (the live layout — `~types/workspace.ts` documents the same):
 *   - metadata directory: `users/{uid}/workspaces/{workspaceId}`
 *   - replicated doc:     `users/{uid}/versicle/{workspaceId}` (+ `updates`,
 *     `history`, `maintenance`, `metadata` subcollections, managed by
 *     y-cinder)
 */
import type * as Y from 'yjs';
import { FireProvider } from 'y-cinder';
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  limit,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import {
  getStorage,
  ref,
  listAll,
  deleteObject,
  type StorageReference,
} from 'firebase/storage';
import { getFirebaseApp, getFirestoreDb } from '@lib/sync/firebase-config';
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

const logger = createLogger('FirestoreBackend');

/**
 * The y-cinder-managed subcollections an honest delete must sweep
 * (firestore.rules documents the same four; the legacy delete purged only
 * `updates` — sync.md debt #2).
 */
const PURGE_SUBCOLLECTIONS = ['updates', 'history', 'maintenance', 'metadata'] as const;

/**
 * The provider event surface the adapter listens to. y-cinder's emitter is
 * an untyped ObservableV2 at this boundary; `saved` was forward-wired here
 * ahead of the fork delta, and since the P9 vendoring + surgery 1
 * (packages/y-cinder/PROVENANCE.md) the provider emits it after every
 * committed save — `lastSyncTime`-from-flush is live on this backend.
 */
interface ProviderEmitter {
  on(event: string, cb: (...args: never[]) => void): void;
  destroy(): void;
}

export class FirestoreBackend implements SyncBackend {
  constructor(readonly uid: string) {}

  private metaPath(workspaceId: string): string {
    return `users/${this.uid}/workspaces/${workspaceId}`;
  }

  private docPath(workspaceId: string): string {
    return `users/${this.uid}/versicle/${workspaceId}`;
  }

  async createWorkspace(meta: WorkspaceMetadata): Promise<void> {
    const db = getFirestoreDb();
    if (!db) throw new Error('Firestore not initialized');
    await setDoc(doc(db, this.metaPath(meta.workspaceId)), { ...meta });
  }

  async listWorkspaces(opts?: { includeDeleted?: boolean }): Promise<WorkspaceMetadata[]> {
    const db = getFirestoreDb();
    if (!db) return [];
    try {
      const snapshot = await getDocs(collection(db, `users/${this.uid}/workspaces`));
      const all = observeWorkspaceMetadata(
        snapshot.docs.map((d) => d.data() as WorkspaceMetadata),
        'firestore.listWorkspaces'
      );
      return opts?.includeDeleted ? all : all.filter((ws) => !ws.deletedAt);
    } catch (error) {
      logger.error('Failed to list workspaces:', error);
      return [];
    }
  }

  async updateWorkspaceMetadata(
    workspaceId: string,
    patch: Partial<WorkspaceMetadata>
  ): Promise<void> {
    const db = getFirestoreDb();
    if (!db) throw new Error('Firestore not initialized');
    await setDoc(doc(db, this.metaPath(workspaceId)), { ...patch }, { merge: true });
  }

  async isWorkspaceAlive(workspaceId: string): Promise<boolean> {
    const db = getFirestoreDb();
    if (!db) return true; // Fail-safe (let it pass to allow offline queuing if config is missing)

    try {
      const snapshot = await getDoc(doc(db, this.docPath(workspaceId)));
      if (snapshot.exists() && snapshot.data()?.isDeleted === true) {
        return false; // Tombstone found
      }
      return true; // Doc missing or not deleted
    } catch (error) {
      logger.error('Failed to validate workspace state', error);
      // If offline, let it pass to allow offline queuing
      return true;
    }
  }

  async probeHasData(workspaceId: string): Promise<boolean> {
    const db = getFirestoreDb();
    if (!db) throw new Error('Firestore not initialized');

    // Check the main document for compacted state. (The legacy probe also
    // sniffed `snapshotBase64` — a mock-only field that never exists on real
    // Firestore docs; dropped here per §D1.)
    const docSnap = await getDoc(doc(db, this.docPath(workspaceId)));
    const hasMainDocData = Boolean(
      docSnap.exists() && (docSnap.data()?.content || docSnap.data()?.stateVector)
    );
    if (hasMainDocData) return true;

    // Check the updates collection in case compaction hasn't run yet.
    const updatesSnap = await getDocs(
      query(collection(db, this.docPath(workspaceId), 'updates'), limit(1))
    );
    return !updatesSnap.empty;
  }

  async tombstoneWorkspace(workspaceId: string): Promise<void> {
    const db = getFirestoreDb();
    if (!db) throw new Error('Firestore not initialized');

    // 1. Plant the tombstone on the root document. Rules-side, this closes
    // the workspace to all new data writes (and allows this exact merge to
    // be re-asserted on a retried delete).
    await setDoc(
      doc(db, this.docPath(workspaceId)),
      { isDeleted: true, deletedAt: Date.now() },
      { merge: true }
    );

    // 2. Update the metadata index (filtered out of future lists).
    await setDoc(
      doc(db, `users/${this.uid}/workspaces`, workspaceId),
      { deletedAt: Date.now() },
      { merge: true }
    );
  }

  /** Batched (≤500) delete loop over one subcollection; returns the count. */
  private async purgeSubcollection(db: Firestore, path: string): Promise<number> {
    const subRef = collection(db, path);
    let deleted = 0;
    for (;;) {
      const snapshot = await getDocs(query(subRef, limit(500)));
      if (snapshot.size === 0) break;
      const batch = writeBatch(db);
      snapshot.docs.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });
      await batch.commit();
      deleted += snapshot.size;
    }
    return deleted;
  }

  /**
   * Recursive Cloud Storage sweep under one prefix (`listAll` returns one
   * level of items + sub-prefixes — `large_updates/` lives one level down).
   * Already-gone objects count as deleted by someone else, not as errors.
   */
  private async purgeStoragePrefix(prefix: StorageReference): Promise<number> {
    const listing = await listAll(prefix);
    let deleted = 0;
    for (const item of listing.items) {
      try {
        await deleteObject(item);
        deleted++;
      } catch (error) {
        if ((error as { code?: string })?.code === 'storage/object-not-found') continue;
        throw error;
      }
    }
    for (const sub of listing.prefixes) {
      deleted += await this.purgeStoragePrefix(sub);
    }
    return deleted;
  }

  async purgeWorkspace(workspaceId: string): Promise<PurgeReport> {
    const db = getFirestoreDb();
    if (!db) throw new Error('Firestore not initialized');

    // 1. Sweep the residual subcollection docs (rules permit deletes in a
    // tombstoned workspace — cleanup must stay possible).
    let docsDeleted = 0;
    for (const sub of PURGE_SUBCOLLECTIONS) {
      docsDeleted += await this.purgeSubcollection(
        db,
        `${this.docPath(workspaceId)}/${sub}`
      );
    }

    // 2. Sweep the Cloud Storage blobs under exactly this workspace's
    // prefix (risk R8: never broader). Storage failures must not strand
    // the delete flow: BYO projects without a Storage bucket have nothing
    // y-cinder could have uploaded — log and report zero; the purge
    // maintenance action retries any genuine residue later.
    let blobsDeleted = 0;
    try {
      const app = getFirebaseApp();
      if (app) {
        const storage = getStorage(app);
        blobsDeleted = await this.purgeStoragePrefix(
          ref(storage, this.docPath(workspaceId))
        );
      }
    } catch (error) {
      logger.warn(
        `Storage purge for ${workspaceId} failed (project without Storage?). ` +
          'Firestore residuals were still purged; re-run "Purge deleted workspaces" to retry.',
        error
      );
    }

    logger.info(
      `Purged workspace ${workspaceId}: ${docsDeleted} docs, ${blobsDeleted} blobs.`
    );
    return { docsDeleted, blobsDeleted };
  }

  connect(ydoc: Y.Doc, workspaceId: string, opts: ConnectOptions): SyncConnection {
    const app = getFirebaseApp();
    if (!app) {
      throw new Error('Firebase app not available');
    }

    const provider = new FireProvider({
      firebaseApp: app,
      ydoc,
      path: this.docPath(workspaceId),
      maxWaitTime: opts.maxWaitTimeMs,
      maxUpdatesThreshold: opts.maxUpdatesThreshold,
    });

    const emitter = createSyncConnectionEmitter();
    const p = provider as unknown as ProviderEmitter;
    p.on('sync', ((isSynced: boolean) => {
      if (isSynced) emitter.emit('synced');
    }) as never);
    p.on('connection-error', ((event: unknown) =>
      emitter.emit('connection-error', event)) as never);
    p.on('sync-failure', ((error: unknown) => emitter.emit('sync-failure', error)) as never);
    p.on('save-rejected', ((event: never) => emitter.emit('save-rejected', event)) as never);
    p.on('corrupted-document', ((event: never) =>
      emitter.emit('corrupted-document', event)) as never);
    // Live since the y-cinder `saved` fork delta (P9 surgery 1).
    p.on('saved', ((at: number) => emitter.emit('saved', at)) as never);

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

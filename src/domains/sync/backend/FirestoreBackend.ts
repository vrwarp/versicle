/**
 * `FirestoreBackend` — the production C3 implementation, absorbing
 * FirestoreSyncManager's real (non-mock) branches verbatim
 * (phase4-sync-strangler.md §D1/§D2; FirestoreSyncManager.ts @ fb3dcd3f:
 * validateWorkspaceIsAlive :229-247, performCleanSync probe :386-407,
 * connectFireProviderNormal :515-535, createWorkspace :691-698,
 * listWorkspaces :869-882, deleteWorkspace :920-957).
 *
 * This is the ONLY sync module that may import `firebase/firestore`
 * (boundary: every other sync module talks `SyncBackend`). It gains the
 * only `firebase/storage` import when P4-6 lands the purge.
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
} from 'firebase/firestore';
import { getFirebaseApp, getFirestoreDb } from '@lib/sync/firebase-config';
import { createLogger } from '@lib/logger';
import type { WorkspaceMetadata } from '~types/workspace';
import type {
  ConnectOptions,
  LegacyDeleteBehavior,
  SyncBackend,
  SyncConnection,
} from './SyncBackend';
import { observeWorkspaceMetadata } from './SyncBackend';
import { createSyncConnectionEmitter } from './connectionEvents';

const logger = createLogger('FirestoreBackend');

/**
 * The provider event surface the adapter listens to. y-cinder's emitter is
 * an untyped ObservableV2 at this boundary; `saved` is forward-wired so the
 * fork delta (§D6.1) lights up `lastSyncTime`-from-flush without touching
 * this adapter again.
 */
interface ProviderEmitter {
  on(event: string, cb: (...args: never[]) => void): void;
  destroy(): void;
}

export class FirestoreBackend implements SyncBackend {
  // P4-6 unifies delete semantics; until then this preserves the real
  // branch's behavior exactly (full destroy + unconditional sever).
  readonly legacyDeleteBehavior: LegacyDeleteBehavior = {
    destroyConnectionFirst: true,
    severActiveUnconditionally: true,
  };

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

  async deleteWorkspace(workspaceId: string): Promise<void> {
    const db = getFirestoreDb();
    if (!db) throw new Error('Firestore not initialized');

    // 1. Reclaim storage: recursively delete the updates subcollection.
    // (KNOWN-INCOMPLETE purge, pinned by the contract suite's P4 todo case:
    // `history`/`maintenance`/`metadata` docs and Cloud Storage blobs
    // survive — P4-6's purgeWorkspace finishes the job.)
    const updatesRef = collection(db, `${this.docPath(workspaceId)}/updates`);
    let isDeleting = true;
    while (isDeleting) {
      const snapshot = await getDocs(query(updatesRef, limit(500)));
      if (snapshot.size === 0) {
        isDeleting = false;
        break;
      }
      const batch = writeBatch(db);
      snapshot.docs.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });
      await batch.commit();
    }

    // 2. Plant the tombstone on the root document.
    await setDoc(
      doc(db, this.docPath(workspaceId)),
      { isDeleted: true, deletedAt: Date.now() },
      { merge: true }
    );

    // 3. Update the metadata index (filtered out of future lists).
    await setDoc(
      doc(db, `users/${this.uid}/workspaces`, workspaceId),
      { deletedAt: Date.now() },
      { merge: true }
    );
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
    // Forward-wired: emitted once the y-cinder `saved` fork delta lands.
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

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
 * `SyncBackend`). The storage import was delete-only (the P4-6 honest
 * delete's blob purge: `getStorage`/`ref`/`listAll`/`deleteObject`); the
 * artifact lane (shared-ai-cache-design.md §2.1, M-1) WIDENS it to
 * read/write by ADDING `uploadBytes`/`getBytes` for putArtifact/getArtifact.
 * FirestoreBackend remains the sole `firebase/storage` importer — no other
 * sync module gains a storage import.
 *
 * Paths (the live layout — `~types/workspace.ts` documents the same):
 *   - metadata directory: `users/{uid}/workspaces/{workspaceId}`
 *   - replicated doc:     `users/{uid}/versicle/{workspaceId}` (+ `updates`,
 *     `history`, `maintenance`, `metadata` subcollections, managed by
 *     y-cinder)
 *   - artifact blob:      `users/{uid}/versicle/{workspaceId}/embeddings/{key}.bin`
 *     (Cloud Storage; swept by purgeStoragePrefix under the workspace prefix)
 *   - artifact HEAD doc:  `users/{uid}/versicle/{workspaceId}/embedCache/{key}`
 *     (Firestore; swept by the `embedCache` PURGE_SUBCOLLECTIONS entry)
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
  uploadBytes,
  getBytes,
  type StorageReference,
} from 'firebase/storage';
import { getFirebaseApp, getFirestoreDb } from '@lib/sync/firebase-config';
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

const logger = createLogger('FirestoreBackend');

/**
 * The Firestore subcollections an honest delete must sweep. The first four
 * are y-cinder-managed (firestore.rules documents the same; the legacy
 * delete purged only `updates` — sync.md debt #2). `embedCache` is the
 * artifact-lane HEAD-doc subcollection (shared-ai-cache-design.md §2.7, H-3):
 * `purgeStoragePrefix` is Storage-only and sweeps the blob for free under
 * the workspace prefix, but the Firestore HEAD doc is NOT swept "for free" —
 * it needs this explicit entry so a workspace delete leaves no orphaned
 * HEAD docs.
 */
const PURGE_SUBCOLLECTIONS = [
  'updates',
  'history',
  'maintenance',
  'metadata',
  'embedCache',
] as const;

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

  /**
   * The full path of an artifact-lane object (blob or HEAD doc) from its
   * in-workspace tail (`embeddings/{key}.bin` or `embedCache/{key}`):
   * `users/{uid}/versicle/{workspaceId}/{relPath}` (shared-ai-cache-design.md
   * §2.1). Both tiers live inside the workspace prefix so the blob is swept
   * by purgeStoragePrefix and the HEAD doc by the `embedCache`
   * PURGE_SUBCOLLECTIONS entry.
   */
  private artifactPath(workspaceId: string, relPath: string): string {
    return `${this.docPath(workspaceId)}/${relPath}`;
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

  async headArtifact(
    workspaceId: string,
    relPath: string
  ): Promise<ArtifactHead | null> {
    const db = getFirestoreDb();
    if (!db) throw new Error('Firestore not initialized');

    // relPath is the HEAD-doc tail (`embedCache/{key}`) — a Firestore getDoc,
    // never a Storage list.
    const snapshot = await getDoc(doc(db, this.artifactPath(workspaceId, relPath)));
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    return { exists: true, stamp: data.stamp as string, size: data.size as number };
  }

  async putArtifact(
    workspaceId: string,
    relPath: string,
    bytes: ArrayBuffer | Uint8Array,
    meta: { stamp: string; size: number }
  ): Promise<void> {
    const db = getFirestoreDb();
    if (!db) throw new Error('Firestore not initialized');

    // relPath is the blob tail (`embeddings/{key}.bin`); the companion HEAD
    // doc is the sibling `embedCache/{key}` tail (§2.1).
    const headRelPath = artifactHeadTail(relPath);

    // ifAbsent: head-before-put. A HEAD hit means the bytes already landed
    // (HEAD-after-Storage), so this is a no-op — content-addressed writes are
    // byte-idempotent (§2.5).
    if (await this.headArtifact(workspaceId, headRelPath)) return;

    const app = getFirebaseApp();
    if (!app) throw new Error('Firebase app not available');
    const storage = getStorage(app);

    // HEAD-after-Storage: upload the bytes FIRST, then write the HEAD doc, so
    // a HEAD hit always implies the blob is present (a crash between the two
    // leaves a recoverable blob with no HEAD doc).
    await uploadBytes(ref(storage, this.artifactPath(workspaceId, relPath)), bytes);
    await setDoc(doc(db, this.artifactPath(workspaceId, headRelPath)), {
      stamp: meta.stamp,
      size: meta.size,
      createdAt: Date.now(),
    });
  }

  async getArtifact(
    workspaceId: string,
    relPath: string
  ): Promise<ArrayBuffer | null> {
    const app = getFirebaseApp();
    if (!app) throw new Error('Firebase app not available');
    const storage = getStorage(app);

    // relPath is the blob tail (`embeddings/{key}.bin`).
    try {
      return await getBytes(ref(storage, this.artifactPath(workspaceId, relPath)));
    } catch (error) {
      // §2.7 taxonomy (OPPOSITE polarity to isWorkspaceAlive's fail-safe): a
      // definitive miss => null (caller re-embeds); transient/permission =>
      // rethrow (never mistake an offline blip for a miss and burn quota).
      if ((error as { code?: string })?.code === 'storage/object-not-found') return null;
      throw error;
    }
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
        // y-cinder's destroy() drains the pending update cache (one final
        // committed save) before resolving — returned so durability-needing
        // callers can await it (C3 additive evolution, P9).
        return provider.destroy();
      },
    };
  }
}

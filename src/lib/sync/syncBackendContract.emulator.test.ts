/**
 * SyncBackend contract (C3) run against the REAL `FirestoreBackend` + the
 * vendored y-cinder FireProvider, on the auth+firestore+storage emulator
 * trio under the repo's real `firestore.rules`/`storage.rules` — the §D8
 * collapse (phase4-sync-strangler.md) this file's previous compat-SDK
 * mirror was a placeholder for. The P9 y-cinder vendoring (+ the `saved`/
 * `sync` fork deltas) unlocked `capabilities.connect = true`: realtime
 * round-trips, the saved→lastSyncTime case, and the Storage half of the
 * honest-delete purge now run against the production code path.
 *
 * Auto-skips when the emulators are not reachable, so the default
 * `npx vitest run` stays green. Start the trio with:
 *
 *   npx firebase-tools emulators:start --project demo-versicle-sync-contract
 *   npx vitest run src/lib/sync/syncBackendContract.emulator.test.ts
 *
 * Wiring notes:
 *  - `@firebase/rules-unit-testing` is used ONLY to load the repo rules
 *    into the emulators for this suite's project id and for its
 *    clearFirestore/clearStorage utilities. The system under test runs on
 *    the production modular SDK: a real FirebaseApp connected to the
 *    emulators, a REAL anonymous Auth user (so `request.auth.uid` in the
 *    rules is a genuine token claim, not a baked-in test context), and
 *    `new FirestoreBackend(uid)`.
 *  - `@lib/sync/firebase-config` is module-mocked to hand the backend this
 *    emulator-connected app/db — the config module's own job (reading the
 *    BYO config from settings) is meaningless under emulators, and
 *    FirestoreBackend is this suite's system under test, not the config
 *    loader.
 *
 * Runs in the node environment: the Firebase SDK's emulator transports are
 * unreliable under jsdom's XMLHttpRequest.
 *
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type * as Y from 'yjs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  terminate,
  collection,
  addDoc,
  getDocs,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import {
  getStorage,
  connectStorageEmulator,
  ref,
  uploadBytes,
  getBytes,
  listAll,
} from 'firebase/storage';
import type { StorageReference } from 'firebase/storage';
import { CURRENT_SCHEMA_VERSION } from '@store/yjs-provider';
import type { WorkspaceMetadata } from '~types/workspace';
import { FirestoreBackend } from '@domains/sync/backend/FirestoreBackend';
import {
  describeSyncBackendContract,
  type SyncBackendContractHarness,
} from './syncBackendContract';

const emulatorState = vi.hoisted(() => ({
  app: null as import('firebase/app').FirebaseApp | null,
  db: null as import('firebase/firestore').Firestore | null,
}));

// FirestoreBackend resolves its app/db through the config module; hand it
// the emulator-connected instances instead (see module docs).
vi.mock('@lib/sync/firebase-config', () => ({
  getFirebaseApp: () => emulatorState.app,
  getFirestoreDb: () => emulatorState.db,
}));

const FIRESTORE_RULES_PATH = resolve(process.cwd(), 'firestore.rules');
const STORAGE_RULES_PATH = resolve(process.cwd(), 'storage.rules');
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const STORAGE_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? '127.0.0.1:9199';

// Distinct demo project id: the emulator namespaces data per project, so
// this suite cannot race security-rules.test.ts (same emulator,
// 'demo-versicle-rules'), whose beforeEach clearFirestore() would otherwise
// wipe contract-suite data when vitest runs the files in parallel.
const PROJECT_ID = 'demo-versicle-sync-contract';

function splitHostPort(hostPort: string): { host: string; port: number } {
  const idx = hostPort.lastIndexOf(':');
  return { host: hostPort.slice(0, idx), port: Number(hostPort.slice(idx + 1)) };
}

async function emulatorReachable(hostPort: string): Promise<boolean> {
  try {
    await fetch(`http://${hostPort}/`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

// The trio is all-or-nothing: connect cases need auth (real request.auth)
// and the purge cases need storage.
const emulatorUp =
  (await emulatorReachable(FIRESTORE_HOST)) &&
  (await emulatorReachable(AUTH_HOST)) &&
  (await emulatorReachable(STORAGE_HOST));

describe.skipIf(!emulatorUp)('firestore emulator (real FirestoreBackend + y-cinder)', () => {
  let testEnv: RulesTestEnvironment;
  let app: FirebaseApp;
  let db: Firestore;
  let uid: string;
  let backend: FirestoreBackend;
  let nextWorkspaceId = 0;

  beforeAll(async () => {
    // Load the repo rules for THIS project id (and get clear* utilities).
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: readFileSync(FIRESTORE_RULES_PATH, 'utf8'),
        ...splitHostPort(FIRESTORE_HOST),
      },
      storage: {
        rules: readFileSync(STORAGE_RULES_PATH, 'utf8'),
        ...splitHostPort(STORAGE_HOST),
      },
    });

    // The production stack under test: modular SDK on the emulators.
    app = initializeApp(
      {
        projectId: PROJECT_ID,
        apiKey: 'fake-api-key',
        storageBucket: `${PROJECT_ID}.appspot.com`,
      },
      'sync-contract-emulator'
    );
    db = getFirestore(app);
    const firestoreHost = splitHostPort(FIRESTORE_HOST);
    connectFirestoreEmulator(db, firestoreHost.host, firestoreHost.port);
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
    const storageHost = splitHostPort(STORAGE_HOST);
    connectStorageEmulator(getStorage(app), storageHost.host, storageHost.port);

    // A REAL signed-in user: the rules' request.auth.uid is a genuine
    // emulator-minted token, not a rules-unit-testing context.
    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;
    backend = new FirestoreBackend(uid);
    emulatorState.app = app;
    emulatorState.db = db;
  }, 30000);

  afterAll(async () => {
    if (db) await terminate(db);
    if (app) await deleteApp(app);
    await testEnv?.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.clearStorage();
  });

  const rootPath = (workspaceId: string) => `users/${uid}/versicle/${workspaceId}`;

  /**
   * The Firestore subcollections an honest delete sweeps. Mirrors the SUT's
   * FirestoreBackend.PURGE_SUBCOLLECTIONS: the four y-cinder subcollections
   * (P4-6) plus `embedCache`, the artifact-lane HEAD-doc subcollection
   * (shared-ai-cache-design.md §2.7, H-3). Both copies must include
   * `embedCache` or countResiduals would under-count the HEAD-doc residual.
   */
  const PURGE_SUBCOLLECTIONS = [
    'updates',
    'history',
    'maintenance',
    'metadata',
    'embedCache',
  ] as const;

  // The artifact-lane tails the trio cases exercise (§2.1).
  const ARTIFACT_BLOB_REL_PATH = 'embeddings/contract-key.bin';
  const ARTIFACT_HEAD_REL_PATH = 'embedCache/contract-key';

  /** Recursive object count under a Storage prefix (mirrors the purge sweep). */
  const countStorageObjects = async (prefix: StorageReference): Promise<number> => {
    const listing = await listAll(prefix);
    let count = listing.items.length;
    for (const sub of listing.prefixes) {
      count += await countStorageObjects(sub);
    }
    return count;
  };

  const makeHarness = (): SyncBackendContractHarness => ({
    // The REAL provider attach: y-cinder connects in the background and the
    // fork's `sync` handshake (surgery 2) resolves the wait — exactly what
    // ProviderConnection/downloadWorkspaceState consume in production.
    connect: async (ydoc: Y.Doc, workspaceId: string) => {
      const connection = backend.connect(ydoc, workspaceId, {
        maxWaitTimeMs: 50,
        maxUpdatesThreshold: 500,
      });
      await new Promise<void>((resolveSynced, reject) => {
        // Generous budget: success resolves in well under a second on an
        // idle machine, but a FULL `vitest run` oversubscribes every core
        // (parallel jsdom workers) and the multi-round-trip initial sync
        // can starve for tens of seconds.
        const timer = setTimeout(
          () => reject(new Error('FirestoreBackend connection never emitted synced')),
          55000
        );
        connection.on('synced', () => {
          clearTimeout(timer);
          resolveSynced();
        });
      });
      return {
        // destroy() returns y-cinder's teardown promise (C3 additive
        // evolution): awaiting it = the final batch is COMMITTED, so a
        // later connection on the same workspace must see the data.
        disconnect: () => connection.destroy(),
        on: (event, cb) => connection.on(event, cb as never),
      };
    },

    createWorkspace: async (name) => {
      const metadata: WorkspaceMetadata = {
        workspaceId: `ws_contract_${nextWorkspaceId++}`,
        name,
        createdAt: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      };
      await backend.createWorkspace(metadata);
      return metadata;
    },

    listWorkspaces: (opts) => backend.listWorkspaces(opts),

    updateWorkspaceMetadata: (workspaceId, patch) =>
      backend.updateWorkspaceMetadata(workspaceId, patch),

    probeHasData: (workspaceId) => backend.probeHasData(workspaceId),

    // The production delete semantics (P4-6 honest delete): tombstone
    // first, then purge — exactly what WorkspaceService.delete runs.
    deleteWorkspace: async (workspaceId) => {
      await backend.tombstoneWorkspace(workspaceId);
      await backend.purgeWorkspace(workspaceId);
    },

    isWorkspaceAlive: (workspaceId) => backend.isWorkspaceAlive(workspaceId),

    // One residual doc in each y-cinder subcollection (what every pre-P4-6
    // delete left behind) plus the Cloud Storage blobs the provider
    // offloads (a compacted snapshot + a large_updates spill) — the
    // Storage-emulator half the P4 §Follow-ups deferred to this collapse.
    // Plus the artifact-lane residual: a real putArtifact lands an
    // `embedCache/{key}` HEAD doc (swept by the new PURGE_SUBCOLLECTIONS
    // entry) AND an `embeddings/{key}.bin` blob (swept by purgeStoragePrefix
    // under the workspace prefix) — pins the H-3 fix end-to-end.
    seedResiduals: async (workspaceId) => {
      for (const sub of PURGE_SUBCOLLECTIONS) {
        if (sub === 'embedCache') continue; // seeded via the real putArtifact below
        await addDoc(collection(db, `${rootPath(workspaceId)}/${sub}`), {
          residual: sub,
          createdAt: Date.now(),
        });
      }
      const storage = getStorage(app);
      const blob = new Uint8Array([1, 2, 3, 4]);
      await uploadBytes(ref(storage, `${rootPath(workspaceId)}/snapshot_v1.bin`), blob);
      await uploadBytes(
        ref(storage, `${rootPath(workspaceId)}/large_updates/u1.bin`),
        blob
      );
      // The artifact residual (HEAD doc + blob) via the real backend path.
      await backend.putArtifact(workspaceId, ARTIFACT_BLOB_REL_PATH, blob, {
        stamp: 'residual-stamp',
        size: blob.byteLength,
      });
    },

    countResiduals: async (workspaceId) => {
      let count = 0;
      for (const sub of PURGE_SUBCOLLECTIONS) {
        const snapshot = await getDocs(collection(db, `${rootPath(workspaceId)}/${sub}`));
        count += snapshot.size;
      }
      count += await countStorageObjects(ref(getStorage(app), rootPath(workspaceId)));
      return count;
    },

    purgeWorkspace: (workspaceId) => backend.purgeWorkspace(workspaceId),

    attemptWriteToTombstoned: async (workspaceId) => {
      try {
        await addDoc(collection(db, `${rootPath(workspaceId)}/updates`), {
          update: 'zombie-after-delete',
        });
        return false; // backend accepted the write — enforcement failed
      } catch {
        return true; // rules denied it
      }
    },

    // The artifact lane (C3 trio) against the real Cloud Storage + Firestore
    // HEAD-doc path (the production code under test).
    putArtifact: (workspaceId, relPath, bytes, meta) =>
      backend.putArtifact(workspaceId, relPath, bytes, meta),
    headArtifact: (workspaceId, relPath) => backend.headArtifact(workspaceId, relPath),
    getArtifact: (workspaceId, relPath) => backend.getArtifact(workspaceId, relPath),
  });

  // ── Artifact-lane emulator cases (CI-PENDING) ──────────────────────────
  // These exercise the REAL Firestore+Storage round trip and the
  // HEAD-after-Storage write ordering the MockBackend cannot model (no
  // Storage tier). They live INSIDE the describe.skipIf(!emulatorUp) block,
  // so they auto-skip when the emulator trio is unreachable — DO NOT report
  // them green unless the emulator suite actually ran (shared-ai-cache-
  // design.md §4a, M-2/M-3).
  describe('artifact lane (emulator: real Storage + HEAD-after-Storage ordering)', () => {
    let workspaceId: string;
    let backendRef: FirestoreBackend;
    let nextLocalId = 0;

    beforeEach(() => {
      workspaceId = `ws_artifact_${nextLocalId++}`;
      backendRef = backend;
    });

    it('put → head → get round-trip over real Cloud Storage', async () => {
      const payload = new TextEncoder().encode('int8-vectors-and-scales');
      await backendRef.putArtifact(workspaceId, ARTIFACT_BLOB_REL_PATH, payload, {
        stamp: 'model-a|dims-256|q8',
        size: payload.byteLength,
      });

      const head = await backendRef.headArtifact(workspaceId, ARTIFACT_HEAD_REL_PATH);
      expect(head).not.toBeNull();
      expect(head!.stamp).toBe('model-a|dims-256|q8');
      expect(head!.size).toBe(payload.byteLength);

      const got = await backendRef.getArtifact(workspaceId, ARTIFACT_BLOB_REL_PATH);
      expect(got).not.toBeNull();
      expect(Array.from(new Uint8Array(got!))).toEqual(Array.from(payload));
    });

    it('getArtifact returns null on a definitive Storage miss (object-not-found)', async () => {
      await expect(
        backendRef.getArtifact(workspaceId, ARTIFACT_BLOB_REL_PATH)
      ).resolves.toBeNull();
    });

    it('HEAD-after-Storage: after putArtifact both the Storage blob AND the Firestore HEAD doc are present', async () => {
      const payload = new Uint8Array([9, 8, 7, 6]);
      await backendRef.putArtifact(workspaceId, ARTIFACT_BLOB_REL_PATH, payload, {
        stamp: 'ordering-stamp',
        size: payload.byteLength,
      });

      // Storage blob present (the bytes landed FIRST).
      const blobBytes = await getBytes(
        ref(getStorage(app), `${rootPath(workspaceId)}/${ARTIFACT_BLOB_REL_PATH}`)
      );
      expect(Array.from(new Uint8Array(blobBytes))).toEqual(Array.from(payload));

      // HEAD doc present (written AFTER the blob, so a hit implies the bytes).
      const headSnap = await getDocs(
        collection(db, `${rootPath(workspaceId)}/embedCache`)
      );
      expect(headSnap.size).toBe(1);
    });

    it('putArtifact is idempotent (ifAbsent): a second put with the same key does not overwrite', async () => {
      const original = new TextEncoder().encode('original-bytes');
      await backendRef.putArtifact(workspaceId, ARTIFACT_BLOB_REL_PATH, original, {
        stamp: 'stamp-1',
        size: original.byteLength,
      });
      const overwrite = new TextEncoder().encode('different-bytes');
      await backendRef.putArtifact(workspaceId, ARTIFACT_BLOB_REL_PATH, overwrite, {
        stamp: 'stamp-2',
        size: overwrite.byteLength,
      });

      const head = await backendRef.headArtifact(workspaceId, ARTIFACT_HEAD_REL_PATH);
      expect(head!.stamp).toBe('stamp-1');
      const got = await backendRef.getArtifact(workspaceId, ARTIFACT_BLOB_REL_PATH);
      expect(Array.from(new Uint8Array(got!))).toEqual(Array.from(original));
    });
  });

  describeSyncBackendContract({
    backendName: 'FirestoreBackend (emulator trio, real rules, vendored y-cinder)',
    capabilities: {
      // The §D8 flip: the vendored provider (with the sync handshake) runs
      // against the emulator — realtime replication is testable here.
      connect: true,
      serverSideTombstoneEnforcement: true,
      // The P9 `saved` fork delta (§D6.1) — committed saves announce.
      savedEvent: true,
      // Real Firestore listeners cannot be made to fail on demand.
      eventInjection: false,
      // Honest-delete purge under the real rules, BOTH halves: Firestore
      // residuals and the Cloud Storage blobs (storage emulator wired).
      purge: true,
      // The artifact-lane trio against real Storage + HEAD docs.
      artifacts: true,
    },
    makeHarness,
  });
});

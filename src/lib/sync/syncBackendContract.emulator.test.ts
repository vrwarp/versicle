/**
 * SyncBackend contract (C3) run against the Firestore EMULATOR, under the
 * repo's real `firestore.rules` — the rules-enforcing counterpart of
 * syncBackendContract.mock.test.ts.
 *
 * Auto-skips when no emulator is reachable (same gate as
 * security-rules.test.ts), so the default `npx vitest run` stays green.
 * Start it with:
 *
 *   npx firebase-tools emulators:start --only firestore \
 *     --project demo-versicle-rules
 *   npx vitest run src/lib/sync/syncBackendContract.emulator.test.ts
 *
 * The harness mirrors `FirestoreBackend`
 * (src/domains/sync/backend/FirestoreBackend.ts) over raw Firestore. It
 * cannot host the backend class directly yet: FirestoreBackend talks the
 * MODULAR firebase SDK through firebase-config (which needs a real app +
 * signed-in auth to satisfy the rules' request.auth), while
 * rules-unit-testing hands out COMPAT Firestore instances with baked-in
 * auth contexts. The collapse to `new FirestoreBackend(...)` happens when
 * the y-cinder vendoring item wires the auth+firestore+storage emulator
 * trio and flips capabilities.connect = true (phase4-sync-strangler.md
 * §D8). Until then this mirror + the shared contract keep the REAL branch
 * semantics pinned (risk R3).
 *
 * Runs in the node environment: the Firebase SDK's emulator transports are
 * unreliable under jsdom's XMLHttpRequest.
 *
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, beforeAll, afterAll } from 'vitest';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { CURRENT_SCHEMA_VERSION } from '@store/yjs-provider';
import type { WorkspaceMetadata } from '~types/workspace';
import {
  describeSyncBackendContract,
  type SyncBackendContractHarness,
} from './syncBackendContract';

const FIRESTORE_RULES_PATH = resolve(process.cwd(), 'firestore.rules');
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';

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

const emulatorUp = await emulatorReachable(FIRESTORE_HOST);

const OWNER = 'owner-uid';

describe.skipIf(!emulatorUp)('firestore emulator', () => {
  let testEnv: RulesTestEnvironment;
  let nextWorkspaceId = 0;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      // Distinct demo project id: the emulator namespaces data per project,
      // so this suite cannot race security-rules.test.ts (same emulator,
      // 'demo-versicle-rules'), whose beforeEach clearFirestore() would
      // otherwise wipe contract-suite data when vitest runs the files in
      // parallel.
      projectId: 'demo-versicle-sync-contract',
      firestore: {
        rules: readFileSync(FIRESTORE_RULES_PATH, 'utf8'),
        ...splitHostPort(FIRESTORE_HOST),
      },
    });
  });

  afterAll(async () => {
    await testEnv?.cleanup();
  });

  const db = () => testEnv.authenticatedContext(OWNER).firestore();
  const metaPath = (workspaceId: string) => `users/${OWNER}/workspaces/${workspaceId}`;
  const rootPath = (workspaceId: string) => `users/${OWNER}/versicle/${workspaceId}`;

  /** The four y-cinder subcollections an honest delete sweeps (P4-6). */
  const PURGE_SUBCOLLECTIONS = ['updates', 'history', 'maintenance', 'metadata'] as const;

  /** Batched residual sweep mirroring FirestoreBackend.purgeWorkspace. */
  const purgeResiduals = async (workspaceId: string): Promise<number> => {
    let deleted = 0;
    for (const sub of PURGE_SUBCOLLECTIONS) {
      for (;;) {
        const snapshot = await db()
          .collection(`${rootPath(workspaceId)}/${sub}`)
          .limit(500)
          .get();
        if (snapshot.size === 0) break;
        const batch = db().batch();
        snapshot.docs.forEach((docSnap) => batch.delete(docSnap.ref));
        await batch.commit();
        deleted += snapshot.size;
      }
    }
    return deleted;
  };

  const makeHarness = async (): Promise<SyncBackendContractHarness> => {
    await testEnv.clearFirestore();
    return {
      createWorkspace: async (name) => {
        const metadata: WorkspaceMetadata = {
          workspaceId: `ws_contract_${nextWorkspaceId++}`,
          name,
          createdAt: Date.now(),
          schemaVersion: CURRENT_SCHEMA_VERSION,
        };
        await db().doc(metaPath(metadata.workspaceId)).set(metadata);
        return metadata;
      },

      listWorkspaces: async (opts) => {
        const snapshot = await db().collection(`users/${OWNER}/workspaces`).get();
        const all = snapshot.docs.map((d) => d.data() as WorkspaceMetadata);
        return opts?.includeDeleted ? all : all.filter((ws) => !ws.deletedAt);
      },

      // Mirrors P4's post-migration metadata stamp (quarantine layer 3):
      // a merge-write onto the metadata doc, under the real rules.
      updateWorkspaceMetadata: async (workspaceId, patch) => {
        await db().doc(metaPath(workspaceId)).set(patch, { merge: true });
      },

      // Mirrors performCleanSync's REAL branch (~:390-403): main doc holds
      // content/stateVector/snapshotBase64, or the updates subcollection is
      // non-empty.
      probeHasData: async (workspaceId) => {
        const docSnap = await db().doc(rootPath(workspaceId)).get();
        const data = docSnap.data();
        const hasMainDocData = Boolean(
          docSnap.exists && (data?.content || data?.stateVector || data?.snapshotBase64)
        );
        if (hasMainDocData) return true;
        const updatesSnap = await db()
          .collection(`${rootPath(workspaceId)}/updates`)
          .limit(1)
          .get();
        return !updatesSnap.empty;
      },

      // Realtime connect is still pending (capabilities.connect = false), so
      // the probe cases seed data the way the provider would: an update doc
      // in the updates subcollection.
      seedWorkspaceData: async (workspaceId) => {
        await db()
          .collection(`${rootPath(workspaceId)}/updates`)
          .add({ update: 'seeded-update-blob', createdAt: Date.now() });
      },

      // Mirrors the P4-6 honest delete: tombstone FIRST (root isDeleted +
      // metadata deletedAt — rules then deny new data writes), then purge
      // the four y-cinder subcollections under the real rules (which keep
      // residual-cleanup deletes legal in a tombstoned workspace).
      deleteWorkspace: async (workspaceId) => {
        await db()
          .doc(rootPath(workspaceId))
          .set({ isDeleted: true, deletedAt: Date.now() }, { merge: true });
        await db()
          .doc(metaPath(workspaceId))
          .set({ deletedAt: Date.now() }, { merge: true });
        await purgeResiduals(workspaceId);
      },

      isWorkspaceAlive: async (workspaceId) => {
        const snapshot = await db().doc(rootPath(workspaceId)).get();
        if (snapshot.exists && snapshot.data()?.isDeleted === true) return false;
        return true;
      },

      // One residual doc in each y-cinder subcollection — what every
      // pre-P4-6 delete left behind (history/maintenance/metadata survived
      // the legacy updates-only purge).
      seedResiduals: async (workspaceId) => {
        for (const sub of PURGE_SUBCOLLECTIONS) {
          await db()
            .collection(`${rootPath(workspaceId)}/${sub}`)
            .add({ residual: sub, createdAt: Date.now() });
        }
      },

      countResiduals: async (workspaceId) => {
        let count = 0;
        for (const sub of PURGE_SUBCOLLECTIONS) {
          const snapshot = await db()
            .collection(`${rootPath(workspaceId)}/${sub}`)
            .get();
          count += snapshot.size;
        }
        return count;
      },

      purgeWorkspace: async (workspaceId) => ({
        docsDeleted: await purgeResiduals(workspaceId),
        blobsDeleted: 0,
      }),

      attemptWriteToTombstoned: async (workspaceId) => {
        try {
          await db()
            .collection(`${rootPath(workspaceId)}/updates`)
            .add({ update: 'zombie-after-delete' });
          return false; // backend accepted the write — enforcement failed
        } catch {
          return true; // rules denied it
        }
      },
    };
  };

  describeSyncBackendContract({
    backendName: 'Firestore (emulator, real firestore.rules)',
    capabilities: {
      // P4: drive the real y-cinder FireProvider against the emulator.
      connect: false,
      serverSideTombstoneEnforcement: true,
      // `saved` needs the P4 y-cinder fork delta (§D6.1) — flips with it.
      savedEvent: false,
      // Real Firestore listeners cannot be made to fail on demand.
      eventInjection: false,
      // Honest-delete purge under the real rules (Firestore residuals; the
      // Storage-blob half needs a Storage emulator and is pinned by the
      // FirestoreBackend purge unit suite instead).
      purge: true,
    },
    makeHarness,
  });
});

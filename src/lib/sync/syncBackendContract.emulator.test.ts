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
 * The harness mirrors FirestoreSyncManager's REAL (non-mock) workspace
 * branches over raw Firestore (createWorkspace ~:690, listWorkspaces
 * ~:870, deleteWorkspace tombstoning ~:940-962, validateWorkspaceIsAlive
 * ~:225). Realtime `connect` needs the full y-cinder FireProvider (app +
 * auth + storage emulators) — that lands with P4's backend extraction, so
 * those cases register as todo here (capabilities.connect = false).
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

      listWorkspaces: async () => {
        const snapshot = await db().collection(`users/${OWNER}/workspaces`).get();
        return snapshot.docs
          .map((d) => d.data() as WorkspaceMetadata)
          .filter((ws) => !ws.deletedAt);
      },

      // Mirrors the real deleteWorkspace tombstoning: plant isDeleted on the
      // root doc, stamp deletedAt on the metadata doc. (The updates-purge
      // step is the P4 todo case in the shared contract.)
      deleteWorkspace: async (workspaceId) => {
        await db()
          .doc(rootPath(workspaceId))
          .set({ isDeleted: true, deletedAt: Date.now() }, { merge: true });
        await db()
          .doc(metaPath(workspaceId))
          .set({ deletedAt: Date.now() }, { merge: true });
      },

      isWorkspaceAlive: async (workspaceId) => {
        const snapshot = await db().doc(rootPath(workspaceId)).get();
        if (snapshot.exists && snapshot.data()?.isDeleted === true) return false;
        return true;
      },

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
    },
    makeHarness,
  });
});

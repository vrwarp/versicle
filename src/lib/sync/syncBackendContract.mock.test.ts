/**
 * SyncBackend contract (C3) run against the mock backend: MockFireProvider
 * for doc replication plus the exact localStorage workspace-directory
 * semantics of FirestoreSyncManager's `__VERSICLE_MOCK_FIRESTORE__`
 * branches (createWorkspace ~:680, listWorkspaces ~:862, deleteWorkspace
 * ~:895, validateWorkspaceIsAlive ~:209). When P4 extracts `MockBackend`,
 * this harness collapses to `new MockBackend(...)` and the storage-key
 * mirroring below is deleted with the inline branches it documents.
 */
import { MockFireProvider } from './drivers/MockFireProvider';
import { CURRENT_SCHEMA_VERSION } from '@store/yjs-provider';
import type { WorkspaceMetadata } from '~types/workspace';
import {
  describeSyncBackendContract,
  type SyncBackendContractHarness,
} from './syncBackendContract';

const UID = 'mock-user';
/** Same keys as the manager's mock branches — shared state is the point. */
const WORKSPACES_KEY = '__VERSICLE_WORKSPACES__';
const SNAPSHOT_KEY = 'versicle_mock_firestore_snapshot';

const pathFor = (workspaceId: string) => `users/${UID}/versicle/${workspaceId}`;

const readWorkspaces = (): WorkspaceMetadata[] =>
  JSON.parse(localStorage.getItem(WORKSPACES_KEY) || '[]');

const writeWorkspaces = (workspaces: WorkspaceMetadata[]): void =>
  localStorage.setItem(WORKSPACES_KEY, JSON.stringify(workspaces));

let nextWorkspaceId = 0;

function makeHarness(): SyncBackendContractHarness {
  // Fresh backend state per test.
  localStorage.removeItem(WORKSPACES_KEY);
  MockFireProvider.clearMockStorage();
  MockFireProvider.setMockFailure(false);
  MockFireProvider.setSyncDelay(1);

  return {
    connect: async (doc, workspaceId) => {
      const provider = new MockFireProvider({
        firebaseApp: null,
        ydoc: doc,
        path: pathFor(workspaceId),
        // Keep the mock's debounced snapshot save fast; destroy() always
        // performs a final save, which is what durability relies on.
        maxWaitTime: 5,
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('MockFireProvider never emitted synced')),
          2000
        );
        provider.on('synced', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      return {
        disconnect: () => provider.destroy(),
        on: (event, cb) =>
          provider.on(
            event as Parameters<typeof provider.on>[0],
            cb as never
          ),
      };
    },

    createWorkspace: async (name) => {
      const metadata: WorkspaceMetadata = {
        workspaceId: `ws_contract_${nextWorkspaceId++}`,
        name,
        createdAt: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      };
      writeWorkspaces([...readWorkspaces(), metadata]);
      return metadata;
    },

    listWorkspaces: async (opts) =>
      opts?.includeDeleted
        ? readWorkspaces()
        : readWorkspaces().filter((ws) => !ws.deletedAt),

    updateWorkspaceMetadata: async (workspaceId, patch) => {
      writeWorkspaces(
        readWorkspaces().map((ws) =>
          ws.workspaceId === workspaceId ? { ...ws, ...patch } : ws
        )
      );
    },

    // Mirrors performCleanSync's mock branch: cloud data exists when the
    // mock snapshot store holds a snapshotBase64 for the workspace path.
    probeHasData: async (workspaceId) => {
      const snapshots = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || '{}');
      return Boolean(snapshots[pathFor(workspaceId)]?.snapshotBase64);
    },

    injectConnectionEvent: (workspaceId, event, payload) =>
      MockFireProvider.simulateEvent(event, [payload] as never, {
        pathIncludes: workspaceId,
      }),

    deleteWorkspace: async (workspaceId) => {
      writeWorkspaces(
        readWorkspaces().map((ws) =>
          ws.workspaceId === workspaceId ? { ...ws, deletedAt: Date.now() } : ws
        )
      );
      const snapshots = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || '{}');
      snapshots[pathFor(workspaceId)] = { isDeleted: true, deletedAt: Date.now() };
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshots));
    },

    isWorkspaceAlive: async (workspaceId) => {
      const ws = readWorkspaces().find((w) => w.workspaceId === workspaceId);
      if (ws?.deletedAt) return false;
      const snapshots = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || '{}');
      return !snapshots[pathFor(workspaceId)]?.isDeleted;
    },

    dispose: () => {
      localStorage.removeItem(WORKSPACES_KEY);
      MockFireProvider.clearMockStorage();
    },
  };
}

describeSyncBackendContract({
  backendName: 'MockFireProvider (localStorage)',
  capabilities: {
    connect: true,
    // The mock enforces tombstones by client convention only — rules live
    // on the Firestore side (see syncBackendContract.emulator.test.ts).
    serverSideTombstoneEnforcement: false,
    savedEvent: true,
    eventInjection: true,
  },
  makeHarness,
});

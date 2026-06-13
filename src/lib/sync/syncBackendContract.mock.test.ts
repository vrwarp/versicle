/**
 * SyncBackend contract (C3) run against the REAL `MockBackend`
 * (src/domains/sync/backend/MockBackend.ts) — P4-2 collapsed the original
 * localStorage-mirroring harness to thin adapters over the extracted
 * backend, exactly as the P0 skeleton planned. The storage-key semantics
 * formerly duplicated here now live in (and are pinned through) the
 * backend itself.
 */
import { MockBackend } from '@domains/sync/backend/MockBackend';
import { MockFireProvider } from '@domains/sync/backend/MockFireProvider';
import { CURRENT_SCHEMA_VERSION } from '@store/yjs-provider';
import type { WorkspaceMetadata } from '~types/workspace';
import {
  describeSyncBackendContract,
  type SyncBackendContractHarness,
} from './syncBackendContract';

const UID = 'mock-user';
const WORKSPACES_KEY = '__VERSICLE_WORKSPACES__';

let nextWorkspaceId = 0;

function makeHarness(): SyncBackendContractHarness {
  // Fresh backend state per test.
  localStorage.removeItem(WORKSPACES_KEY);
  MockFireProvider.clearMockStorage();
  MockFireProvider.setMockFailure(false);
  MockFireProvider.setSyncDelay(1);

  const backend = new MockBackend(UID);

  return {
    connect: async (doc, workspaceId) => {
      const connection = backend.connect(doc, workspaceId, {
        // Keep the mock's debounced snapshot save fast; destroy() always
        // performs a final save, which is what durability relies on.
        maxWaitTimeMs: 5,
        maxUpdatesThreshold: 50,
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('MockBackend connection never emitted synced')),
          2000
        );
        connection.on('synced', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      return {
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

    // The mock's residual surface is its one snapshot blob per workspace.
    seedResiduals: async (workspaceId) => {
      MockFireProvider.injectSnapshot(
        `users/${UID}/versicle/${workspaceId}`,
        btoa('residual-update-bytes')
      );
    },
    countResiduals: async (workspaceId) =>
      (await backend.probeHasData(workspaceId)) ? 1 : 0,
    purgeWorkspace: (workspaceId) => backend.purgeWorkspace(workspaceId),

    injectConnectionEvent: (workspaceId, event, payload) =>
      MockFireProvider.simulateEvent(event, [payload] as never, {
        pathIncludes: workspaceId,
      }),

    dispose: () => {
      localStorage.removeItem(WORKSPACES_KEY);
      MockFireProvider.clearMockStorage();
    },
  };
}

describeSyncBackendContract({
  backendName: 'MockBackend (localStorage + MockFireProvider)',
  capabilities: {
    connect: true,
    // The mock enforces tombstones by client convention only — rules live
    // on the Firestore side (see syncBackendContract.emulator.test.ts).
    serverSideTombstoneEnforcement: false,
    savedEvent: true,
    eventInjection: true,
    purge: true,
  },
  makeHarness,
});

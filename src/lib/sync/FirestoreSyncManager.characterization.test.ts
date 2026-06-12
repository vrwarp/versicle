/**
 * P4-0 ENTRY GATE — characterization of FirestoreSyncManager's mock-path
 * workspace lifecycle AT CURRENT BEHAVIOR (phase4-sync-strangler.md
 * §Execution order P4-0; program rule 7: characterization before change).
 *
 * Unlike FirestoreSyncManager.test.ts (which vi.mocks y-cinder/firebase and
 * pins the REAL-path event wiring), this suite runs the manager's
 * `__VERSICLE_MOCK_FIRESTORE__` branches end-to-end against the real
 * MockFireProvider and the real localStorage workspace directory — the
 * exact seams P4-2 extracts into `MockBackend`. Every assertion here is
 * about observable behavior (stores, localStorage, status, toasts), not
 * implementation lines, so the suite must stay green unchanged through the
 * SyncBackend extraction and the manager decomposition.
 *
 * The only spied collaborators are CheckpointService statics (IDB-touching
 * infrastructure that is NOT under test here, and applyRemoteState would
 * reload the page).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { FirestoreSyncManager, getFirestoreSyncManager } from './FirestoreSyncManager';
import { MockFireProvider } from '@domains/sync/backend/MockFireProvider';
import { configureSyncBackendSelection } from '@app/sync/createSync';
import { CheckpointService } from './CheckpointService';
import { MigrationStateService } from './MigrationStateService';
import { useSyncStore } from '@store/useSyncStore';
import { useToastStore } from '@store/useToastStore';
import { CURRENT_SCHEMA_VERSION } from '@store/yjs-provider';
import { WorkspaceDeletedError } from '~types/errors';
import type { WorkspaceMetadata } from '~types/workspace';

const WORKSPACES_KEY = '__VERSICLE_WORKSPACES__';
const UID = 'mock-user';
const pathFor = (workspaceId: string) => `users/${UID}/versicle/${workspaceId}`;

const readWorkspaces = (): WorkspaceMetadata[] =>
  JSON.parse(localStorage.getItem(WORKSPACES_KEY) || '[]');

const seedWorkspace = (workspaceId: string, extra: Partial<WorkspaceMetadata> = {}): void => {
  const metadata: WorkspaceMetadata = {
    workspaceId,
    name: `Workspace ${workspaceId}`,
    createdAt: Date.now(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    ...extra,
  };
  localStorage.setItem(WORKSPACES_KEY, JSON.stringify([...readWorkspaces(), metadata]));
};

/** Encode a scratch doc and plant it as the workspace's "cloud" snapshot. */
const injectCloudSnapshot = (workspaceId: string, build: (doc: Y.Doc) => void): void => {
  const doc = new Y.Doc();
  build(doc);
  const update = Y.encodeStateAsUpdate(doc);
  let b64 = '';
  for (let i = 0; i < update.byteLength; i++) b64 += String.fromCharCode(update[i]);
  MockFireProvider.injectSnapshot(pathFor(workspaceId), btoa(b64));
};

describe('characterization: mock-path workspace lifecycle (P4 entry gate)', () => {
  let showToast: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    window.__VERSICLE_MOCK_FIRESTORE__ = true;
    window.__VERSICLE_FIRESTORE_DEBOUNCE_MS__ = 5;
    MockFireProvider.setMockFailure(false);
    MockFireProvider.setSyncDelay(1);
    MockFireProvider.clearMockStorage();
    localStorage.removeItem(WORKSPACES_KEY);
    MigrationStateService.clear();

    FirestoreSyncManager.resetInstance();
    // Since P4-2, backend selection is the composition root's job — the
    // manager no longer reads `__VERSICLE_MOCK_FIRESTORE__` itself. This is
    // the same call the `syncInit` boot task makes before initialize().
    await configureSyncBackendSelection();
    useSyncStore.getState().setActiveWorkspaceId(null);
    useSyncStore.getState().setFirebaseEnabled(false);
    useSyncStore.getState().setFirestoreStatus('disconnected');
    useSyncStore.getState().setFirebaseAuthStatus('loading');
    useSyncStore.getState().setFirebaseUserEmail(null);

    // Infrastructure spies: checkpoints hit IndexedDB and applyRemoteState
    // reloads the page — neither is the subject of this suite.
    vi.spyOn(CheckpointService, 'createAutomaticCheckpoint').mockResolvedValue(null);

    showToast = vi.spyOn(useToastStore.getState(), 'showToast');
  });

  afterEach(() => {
    FirestoreSyncManager.resetInstance();
    MigrationStateService.clear();
    MockFireProvider.clearMockStorage();
    localStorage.removeItem(WORKSPACES_KEY);
    delete window.__VERSICLE_MOCK_FIRESTORE__;
    delete window.__VERSICLE_MOCK_USER_ID__;
    delete window.__VERSICLE_FIRESTORE_DEBOUNCE_MS__;
    vi.restoreAllMocks();
  });

  describe('initialize() — mock auth synthesis and smart routing', () => {
    it('auto-provisions "My Library" and connects when zero remote workspaces exist', async () => {
      const manager = getFirestoreSyncManager();
      await manager.initialize();

      await vi.waitFor(() => expect(manager.getStatus()).toBe('connected'), {
        timeout: 5000,
      });

      // Mock auth was synthesized and mirrored into the sync store.
      expect(manager.getAuthStatus()).toBe('signed-in');
      expect(manager.getCurrentUser()?.uid).toBe(UID);
      expect(useSyncStore.getState().firebaseEnabled).toBe(true);
      expect(useSyncStore.getState().firebaseAuthStatus).toBe('signed-in');
      expect(useSyncStore.getState().firebaseUserEmail).toBe(`${UID}@example.com`);

      // The auto-provisioned workspace exists, carries the current schema
      // version, and became the active workspace.
      const workspaces = readWorkspaces();
      expect(workspaces).toHaveLength(1);
      expect(workspaces[0].name).toBe('My Library');
      expect(workspaces[0].schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(workspaces[0].deletedAt).toBeUndefined();
      expect(useSyncStore.getState().activeWorkspaceId).toBe(workspaces[0].workspaceId);
    });

    it('halts (disconnected, no workspace assigned) when remote workspaces exist but none is selected', async () => {
      seedWorkspace('ws_existing');

      const manager = getFirestoreSyncManager();
      await manager.initialize();

      // Routing decision is async — wait until auth lands, then assert halt.
      await vi.waitFor(
        () => expect(useSyncStore.getState().firebaseAuthStatus).toBe('signed-in'),
        { timeout: 5000 }
      );
      await vi.waitFor(() => expect(manager.getStatus()).toBe('disconnected'), {
        timeout: 5000,
      });

      expect(useSyncStore.getState().activeWorkspaceId).toBeNull();
      // No auto-provisioning happened.
      expect(readWorkspaces()).toHaveLength(1);
    });

    it('honors __VERSICLE_MOCK_USER_ID__ when synthesizing the mock user', async () => {
      window.__VERSICLE_MOCK_USER_ID__ = 'custom-user';
      // The id flag is read at composition time — re-run the root.
      await configureSyncBackendSelection();
      const manager = getFirestoreSyncManager();
      await manager.initialize();

      await vi.waitFor(() => expect(manager.getStatus()).toBe('connected'), {
        timeout: 5000,
      });
      expect(manager.getCurrentUser()?.uid).toBe('custom-user');
      expect(useSyncStore.getState().firebaseUserEmail).toBe('custom-user@example.com');
    });
  });

  describe('connect / disconnect lifecycle', () => {
    it('connects an assigned clean client as the first device when no cloud data exists', async () => {
      seedWorkspace('ws_fresh');
      useSyncStore.getState().setActiveWorkspaceId('ws_fresh');

      const manager = getFirestoreSyncManager();
      await manager.initialize();

      await vi.waitFor(() => expect(manager.getStatus()).toBe('connected'), {
        timeout: 5000,
      });
      expect(useSyncStore.getState().firestoreStatus).toBe('connected');
      expect(useSyncStore.getState().activeWorkspaceId).toBe('ws_fresh');
    });

    it('destroy() disconnects the provider and reports disconnected', async () => {
      seedWorkspace('ws_fresh');
      useSyncStore.getState().setActiveWorkspaceId('ws_fresh');

      const manager = getFirestoreSyncManager();
      await manager.initialize();
      await vi.waitFor(() => expect(manager.getStatus()).toBe('connected'), {
        timeout: 5000,
      });

      manager.destroy();
      expect(manager.getStatus()).toBe('disconnected');
      expect(useSyncStore.getState().firestoreStatus).toBe('disconnected');
    });

    it('refuses to connect to a tombstoned workspace: severs the local tie and stays disconnected', async () => {
      seedWorkspace('ws_dead', { deletedAt: Date.now() });
      useSyncStore.getState().setActiveWorkspaceId('ws_dead');

      const manager = getFirestoreSyncManager();
      // Call the connect path directly (handleAuthStateChange fires it
      // without awaiting — pinned debt, phase4-sync-strangler.md item 17 —
      // so going through initialize() would leave an unhandled rejection).
      await expect(
        (manager as unknown as { connectFireProvider(uid: string): Promise<void> })
          .connectFireProvider(UID)
      ).rejects.toThrow(WorkspaceDeletedError);

      expect(useSyncStore.getState().activeWorkspaceId).toBeNull();
      expect(manager.getStatus()).toBe('disconnected');
      expect(showToast).toHaveBeenCalledWith(
        'Sync disconnected: Remote workspace was deleted. Operating offline.',
        'error',
        8000
      );
    });

    it('clean-sync downloads existing cloud data into the live doc, then connects', async () => {
      seedWorkspace('ws_cloud');
      useSyncStore.getState().setActiveWorkspaceId('ws_cloud');
      injectCloudSnapshot('ws_cloud', (doc) => {
        doc.getMap('library').set('characterization-probe', 'cloud-data');
      });

      const manager = getFirestoreSyncManager();
      await manager.initialize();

      await vi.waitFor(() => expect(manager.getStatus()).toBe('connected'), {
        timeout: 10000,
      });

      // The downloaded state was applied to the LIVE doc before the main
      // provider connected.
      const { getYDoc } = await import('@store/yjs-provider');
      expect(getYDoc().getMap('library').get('characterization-probe')).toBe('cloud-data');
      expect(showToast).toHaveBeenCalledWith('Syncing library from cloud...', 'info');
      expect(showToast).toHaveBeenCalledWith('Sync complete!', 'success');
    });
  });

  describe('switchWorkspace — multi-stage commit (mock path)', () => {
    let createCheckpointSpy: ReturnType<typeof vi.spyOn>;
    let applyRemoteStateSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      createCheckpointSpy = vi
        .spyOn(CheckpointService, 'createCheckpoint')
        .mockResolvedValue(7) as ReturnType<typeof vi.spyOn>;
      applyRemoteStateSpy = vi
        .spyOn(CheckpointService, 'applyRemoteState')
        .mockResolvedValue(undefined) as ReturnType<typeof vi.spyOn>;
    });

    it('downloads the target workspace, pins a protected checkpoint, locks the state machine, and applies', async () => {
      seedWorkspace('ws_a');
      seedWorkspace('ws_b');
      useSyncStore.getState().setActiveWorkspaceId('ws_a');
      injectCloudSnapshot('ws_b', (doc) => {
        doc.getMap('library').set('characterization-probe', 'workspace-b-data');
      });

      const manager = getFirestoreSyncManager();
      await manager.switchWorkspace('ws_b');

      // Protected pre-migration checkpoint (P0 pinning semantics).
      expect(createCheckpointSpy).toHaveBeenCalledWith('pre-migration', { protected: true });
      // State machine survives the (spied-out) reload as AWAITING_CONFIRMATION.
      expect(MigrationStateService.getState()).toEqual({
        status: 'AWAITING_CONFIRMATION',
        targetWorkspaceId: 'ws_b',
        backupCheckpointId: 7,
      });
      // The active workspace id flips BEFORE apply (current pre-commit
      // ordering — the staged-swap item re-orders this; see §D4 step 3).
      expect(useSyncStore.getState().activeWorkspaceId).toBe('ws_b');
      expect(showToast).toHaveBeenCalledWith('Downloading workspace data...', 'info');

      // The blob handed to applyRemoteState is the downloaded ws_b state.
      expect(applyRemoteStateSpy).toHaveBeenCalledTimes(1);
      const blob = applyRemoteStateSpy.mock.calls[0][0] as Uint8Array;
      const decoded = new Y.Doc();
      Y.applyUpdate(decoded, blob);
      expect(decoded.getMap('library').get('characterization-probe')).toBe('workspace-b-data');
    });

    it('is a no-op when switching to the already-active workspace', async () => {
      seedWorkspace('ws_a');
      useSyncStore.getState().setActiveWorkspaceId('ws_a');

      const manager = getFirestoreSyncManager();
      await manager.switchWorkspace('ws_a');

      expect(createCheckpointSpy).not.toHaveBeenCalled();
      expect(applyRemoteStateSpy).not.toHaveBeenCalled();
      expect(MigrationStateService.getState()).toBeNull();
    });

    it('pre-flight rejects a tombstoned target before any destructive step', async () => {
      seedWorkspace('ws_a');
      seedWorkspace('ws_dead', { deletedAt: Date.now() });
      useSyncStore.getState().setActiveWorkspaceId('ws_a');

      const manager = getFirestoreSyncManager();
      await expect(manager.switchWorkspace('ws_dead')).rejects.toThrow(WorkspaceDeletedError);

      expect(showToast).toHaveBeenCalledWith(
        'Cannot switch: This workspace has been deleted.',
        'error'
      );
      // Nothing destructive ran: no checkpoint, no state machine, no id flip.
      expect(createCheckpointSpy).not.toHaveBeenCalled();
      expect(MigrationStateService.getState()).toBeNull();
      expect(useSyncStore.getState().activeWorkspaceId).toBe('ws_a');
    });
  });

  describe('deleteWorkspace / listWorkspaces (mock path)', () => {
    it('tombstones the workspace in both the directory and the snapshot store', async () => {
      seedWorkspace('ws_doomed');

      const manager = getFirestoreSyncManager();
      await manager.deleteWorkspace('ws_doomed');

      const ws = readWorkspaces().find((w) => w.workspaceId === 'ws_doomed');
      expect(ws?.deletedAt).toBeGreaterThan(0);
      const snapshots = MockFireProvider.getMockStorageData();
      expect(
        (snapshots?.[pathFor('ws_doomed')] as { isDeleted?: boolean } | undefined)?.isDeleted
      ).toBe(true);
    });

    it('severs activeWorkspaceId only when the deleted workspace was active', async () => {
      seedWorkspace('ws_active');
      seedWorkspace('ws_other');
      useSyncStore.getState().setActiveWorkspaceId('ws_active');

      const manager = getFirestoreSyncManager();

      // Deleting a NON-active workspace keeps the active tie.
      await manager.deleteWorkspace('ws_other');
      expect(useSyncStore.getState().activeWorkspaceId).toBe('ws_active');

      // Deleting the ACTIVE workspace severs it.
      await manager.deleteWorkspace('ws_active');
      expect(useSyncStore.getState().activeWorkspaceId).toBeNull();
    });

    it('listWorkspaces filters tombstoned workspaces', async () => {
      seedWorkspace('ws_alive');
      seedWorkspace('ws_dead', { deletedAt: Date.now() });

      const manager = getFirestoreSyncManager();
      const listed = await manager.listWorkspaces();
      expect(listed.map((w) => w.workspaceId)).toEqual(['ws_alive']);
    });
  });
});

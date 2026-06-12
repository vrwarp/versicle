/**
 * P4-0 ENTRY GATE — characterization of the mock-path workspace lifecycle
 * AT LEGACY BEHAVIOR (phase4-sync-strangler.md §Execution order P4-0;
 * program rule 7: characterization before change). Written against
 * FirestoreSyncManager; retargeted to the SyncOrchestrator when P4-3
 * decomposed and deleted the manager — every ASSERTION is unchanged (the
 * suite pins observable behavior: stores, localStorage, status, toasts),
 * only the construction plumbing moved to the composition root.
 *
 * Runs the mock stack end-to-end against the real MockFireProvider and the
 * real localStorage workspace directory (MockBackend, selected by
 * configureSyncBackendSelection exactly like the syncInit boot task does).
 *
 * The only spied collaborators are CheckpointService statics (IDB-touching
 * infrastructure that is NOT under test here, and applyRemoteState would
 * reload the page).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { MockFireProvider } from '../backend/MockFireProvider';
import {
  configureSyncBackendSelection,
  getSyncOrchestratorAsync,
  stopSyncForWipe,
} from '@app/sync/createSync';
import { wireSyncEvents } from '@app/sync/wireSyncEvents';
import { CheckpointService } from '../checkpoints/CheckpointService';
import { MigrationStateService } from '../workspaces/MigrationStateService';
import {
  readSnapshot,
  deleteYjsDatabase,
  YJS_STAGING_DB_NAME,
} from '@data/snapshot/YjsSnapshotService';
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
  let unwireSyncEvents: () => void;

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

    stopSyncForWipe();
    // Backend selection and the single presentation subscriber are the
    // composition root's job — the orchestrator never reads
    // `__VERSICLE_MOCK_FIRESTORE__` or shows toasts itself. These are
    // the same calls the `syncInit` boot task makes before start().
    await configureSyncBackendSelection();
    unwireSyncEvents = wireSyncEvents();
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
    unwireSyncEvents();
    stopSyncForWipe();
    MigrationStateService.clear();
    MockFireProvider.clearMockStorage();
    localStorage.removeItem(WORKSPACES_KEY);
    delete window.__VERSICLE_MOCK_FIRESTORE__;
    delete window.__VERSICLE_MOCK_USER_ID__;
    delete window.__VERSICLE_FIRESTORE_DEBOUNCE_MS__;
    vi.restoreAllMocks();
  });

  describe('start() — mock auth synthesis and smart routing', () => {
    it('auto-provisions "My Library" and connects when zero remote workspaces exist', async () => {
      const manager = await getSyncOrchestratorAsync();
      await manager.start();

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

      const manager = await getSyncOrchestratorAsync();
      await manager.start();

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
      const manager = await getSyncOrchestratorAsync();
      await manager.start();

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

      const manager = await getSyncOrchestratorAsync();
      await manager.start();

      await vi.waitFor(() => expect(manager.getStatus()).toBe('connected'), {
        timeout: 5000,
      });
      expect(useSyncStore.getState().firestoreStatus).toBe('connected');
      expect(useSyncStore.getState().activeWorkspaceId).toBe('ws_fresh');
    });

    it('stop() disconnects the provider and reports disconnected', async () => {
      seedWorkspace('ws_fresh');
      useSyncStore.getState().setActiveWorkspaceId('ws_fresh');

      const manager = await getSyncOrchestratorAsync();
      await manager.start();
      await vi.waitFor(() => expect(manager.getStatus()).toBe('connected'), {
        timeout: 5000,
      });

      manager.stop();
      expect(manager.getStatus()).toBe('disconnected');
      expect(useSyncStore.getState().firestoreStatus).toBe('disconnected');
    });

    it('refuses to connect to a tombstoned workspace: severs the local tie and stays disconnected', async () => {
      seedWorkspace('ws_dead', { deletedAt: Date.now() });
      useSyncStore.getState().setActiveWorkspaceId('ws_dead');

      const manager = await getSyncOrchestratorAsync();
      // Call the connect path directly (handleAuthStateChange fires it
      // without awaiting — pinned debt, phase4-sync-strangler.md item 17 —
      // so going through start() would leave an unhandled rejection).
      await expect(manager.connect(UID)).rejects.toThrow(WorkspaceDeletedError);

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

      const manager = await getSyncOrchestratorAsync();
      await manager.start();

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

  describe('switchWorkspace — staged swap (mock path, P4-5 §D4 ordering)', () => {
    let createCheckpointSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      createCheckpointSpy = vi
        .spyOn(CheckpointService, 'createCheckpoint')
        .mockResolvedValue(7) as ReturnType<typeof vi.spyOn>;
      await deleteYjsDatabase({ dbName: YJS_STAGING_DB_NAME });
    });

    it('downloads, pins a protected checkpoint, stages durably, then commits STAGED + the id flip', async () => {
      seedWorkspace('ws_a');
      seedWorkspace('ws_b');
      useSyncStore.getState().setActiveWorkspaceId('ws_a');
      injectCloudSnapshot('ws_b', (doc) => {
        doc.getMap('library').set('characterization-probe', 'workspace-b-data');
      });

      const manager = await getSyncOrchestratorAsync();
      await manager.switchWorkspace('ws_b');

      // Protected pre-migration checkpoint (P0 pinning semantics).
      expect(createCheckpointSpy).toHaveBeenCalledWith('pre-migration', { protected: true });

      // The commit point: STAGED, carrying the rollback target AND the
      // pre-switch workspace (so a later rollback reverts the local tie).
      // AWAITING_CONFIRMATION engagement moved to the boot interceptor's
      // idempotent apply (stagedSwap.applyStagedSwap).
      expect(MigrationStateService.getState()).toEqual({
        status: 'STAGED',
        targetWorkspaceId: 'ws_b',
        backupCheckpointId: 7,
        previousWorkspaceId: 'ws_a',
      });
      // The id flips only at the commit point (legacy flipped it BEFORE the
      // download — a crash mid-download left a dangling state).
      expect(useSyncStore.getState().activeWorkspaceId).toBe('ws_b');
      expect(showToast).toHaveBeenCalledWith('Downloading workspace data...', 'info');

      // The downloaded ws_b state is durably in the staging database.
      const staged = await readSnapshot({ dbName: YJS_STAGING_DB_NAME });
      expect(staged).not.toBeNull();
      const decoded = new Y.Doc();
      Y.applyUpdate(decoded, staged!);
      expect(decoded.getMap('library').get('characterization-probe')).toBe('workspace-b-data');
      decoded.destroy();
    });

    it('is a no-op when switching to the already-active workspace', async () => {
      seedWorkspace('ws_a');
      useSyncStore.getState().setActiveWorkspaceId('ws_a');

      const manager = await getSyncOrchestratorAsync();
      await manager.switchWorkspace('ws_a');

      expect(createCheckpointSpy).not.toHaveBeenCalled();
      expect(MigrationStateService.getState()).toBeNull();
      await expect(readSnapshot({ dbName: YJS_STAGING_DB_NAME })).resolves.toBeNull();
    });

    it('pre-flight rejects a tombstoned target before any destructive step', async () => {
      seedWorkspace('ws_a');
      seedWorkspace('ws_dead', { deletedAt: Date.now() });
      useSyncStore.getState().setActiveWorkspaceId('ws_a');

      const manager = await getSyncOrchestratorAsync();
      await expect(manager.switchWorkspace('ws_dead')).rejects.toThrow(WorkspaceDeletedError);

      expect(showToast).toHaveBeenCalledWith(
        'Cannot switch: This workspace has been deleted.',
        'error'
      );
      // Nothing destructive ran: no checkpoint, no state machine, no id
      // flip, nothing staged.
      expect(createCheckpointSpy).not.toHaveBeenCalled();
      expect(MigrationStateService.getState()).toBeNull();
      expect(useSyncStore.getState().activeWorkspaceId).toBe('ws_a');
      await expect(readSnapshot({ dbName: YJS_STAGING_DB_NAME })).resolves.toBeNull();
    });

    // The per-stage abort/crash rows (kill between every pair of stages,
    // idempotent re-apply) are pinned by the owning suite:
    // src/domains/sync/workspaces/stagedSwap.test.ts.
  });

  describe('deleteWorkspace / listWorkspaces (mock path)', () => {
    it('tombstones the workspace in both the directory and the snapshot store', async () => {
      seedWorkspace('ws_doomed');

      const manager = await getSyncOrchestratorAsync();
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

      const manager = await getSyncOrchestratorAsync();

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

      const manager = await getSyncOrchestratorAsync();
      const listed = await manager.listWorkspaces();
      expect(listed.map((w) => w.workspaceId)).toEqual(['ws_alive']);
    });

    it('deleting a NON-active workspace keeps the active one connected (P4-6 unification)', async () => {
      seedWorkspace('ws_active');
      seedWorkspace('ws_other');
      useSyncStore.getState().setActiveWorkspaceId('ws_active');

      const manager = await getSyncOrchestratorAsync();
      await manager.start();
      await vi.waitFor(() => expect(manager.getStatus()).toBe('connected'), {
        timeout: 5000,
      });

      await manager.deleteWorkspace('ws_other');

      // The legacy REAL path destroyed the whole manager on any delete;
      // unified semantics never touch the live connection for non-active
      // deletions.
      expect(manager.getStatus()).toBe('connected');
      expect(useSyncStore.getState().activeWorkspaceId).toBe('ws_active');
      // …and the delete was honest: tombstone everywhere + purge toast.
      const ws = readWorkspaces().find((w) => w.workspaceId === 'ws_other');
      expect(ws?.deletedAt).toBeGreaterThan(0);
      expect(showToast).toHaveBeenCalledWith(
        expect.stringMatching(/^Remote workspace data purged/),
        'info'
      );
    });

    it('the purge maintenance action sweeps residuals of every tombstoned workspace', async () => {
      seedWorkspace('ws_alive');
      seedWorkspace('ws_dead', { deletedAt: Date.now() });
      // Residual data a pre-P4-6 delete left behind in the dead workspace.
      injectCloudSnapshot('ws_dead', (doc) => {
        doc.getMap('library').set('residual', 'leftover');
      });
      injectCloudSnapshot('ws_alive', (doc) => {
        doc.getMap('library').set('keep', 'me');
      });

      const manager = await getSyncOrchestratorAsync();
      // Authenticated context without connecting: start() routes to the
      // halt branch (no active workspace) but signs the mock user in.
      await manager.start();
      await vi.waitFor(
        () => expect(useSyncStore.getState().firebaseAuthStatus).toBe('signed-in'),
        { timeout: 5000 }
      );

      const report = await manager.purgeDeletedWorkspaces();

      expect(report.docsDeleted).toBe(1);
      const snapshots = MockFireProvider.getMockStorageData();
      // The dead workspace's residual blob is gone; the tombstone survives.
      const deadEntry = snapshots?.[pathFor('ws_dead')] as
        | { snapshotBase64?: string; isDeleted?: boolean }
        | undefined;
      expect(deadEntry?.snapshotBase64).toBeUndefined();
      expect(deadEntry?.isDeleted).toBe(true);
      // The living workspace's data survives (scoping).
      expect(snapshots?.[pathFor('ws_alive')]?.snapshotBase64).toBeTruthy();
    });
  });
});

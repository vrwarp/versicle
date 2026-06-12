/**
 * P4-4 doc-level quarantine enforcement — the two-client obsolete suite
 * (phase4-sync-strangler.md §D5; program rule 6's standing two-client
 * upgrade test at the vitest tier).
 *
 * Client A is simulated through the mock backend's storage (a v7-stamped
 * workspace doc synthesized from the committed v5 fixture via the migration
 * coordinator — never hand-rolled, per the prep doc's fixture rule). Client
 * B is the real orchestrator + MockBackend + wireSyncEvents stack at
 * CURRENT_SCHEMA_VERSION (written against FirestoreSyncManager; retargeted
 * when P4-3 decomposed and deleted it — assertions unchanged). Asserted,
 * per layer:
 *
 *  1. PRE-ATTACH metadata probe: B locks before any download.
 *  1b. PRE-APPLY scratch check: downloaded v7 state never touches the live
 *      doc (clean-sync) / never reaches the destructive apply (switch).
 *  2. LIVE observer: an incoming v7 update destroys the provider — B locks
 *     AND zero outbound writes reach the backend afterwards (the upgraded
 *     assertion over P2's label-only behavior).
 *  3. Metadata stamp: a migrated doc's version is written back to the
 *     workspace directory (the mock-side twin of the emulator
 *     updateWorkspaceMetadata contract case).
 *
 * In every case the device heartbeat is stopped — pre-P4 it kept writing
 * from behind the lock screen.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Y from 'yjs';
import { MockFireProvider } from '../backend/MockFireProvider';
import { getSyncEventBus, type SyncEvent } from '../events';
import {
  configureSyncBackendSelection,
  getSyncOrchestratorAsync,
  stopSyncForWipe,
} from '@app/sync/createSync';
import { wireSyncEvents } from '@app/sync/wireSyncEvents';
import {
  startDeviceHeartbeat,
  stopDeviceHeartbeat,
  isDeviceHeartbeatRunning,
} from '@app/boot/backgroundTasks';
import { runCrdtMigrationsOnDoc, __resetCrdtMigrationsForTests } from '@app/migrations';
import { CheckpointService } from '../checkpoints/CheckpointService';
import { MigrationStateService } from '../workspaces/MigrationStateService';
import { readSnapshot, YJS_STAGING_DB_NAME } from '@data/snapshot/YjsSnapshotService';
import { useSyncStore } from '@store/useSyncStore';
import { useUIStore } from '@store/useUIStore';
import { getYDoc, CURRENT_SCHEMA_VERSION } from '@store/yjs-provider';
import type { WorkspaceMetadata } from '~types/workspace';

const WORKSPACES_KEY = '__VERSICLE_WORKSPACES__';
const UID = 'mock-user';
const FUTURE_VERSION = CURRENT_SCHEMA_VERSION + 1;
const pathFor = (workspaceId: string) => `users/${UID}/versicle/${workspaceId}`;
const fixtureDir = join(process.cwd(), 'src', 'test', 'fixtures', 'ydoc');

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

/**
 * Client A's doc: the committed v5 fixture, migrated through the real
 * coordinator to CURRENT, then stamped one version into the future (both
 * halves of the dual-write, like a real v7 migration would).
 */
async function buildFutureVersionUpdate(): Promise<Uint8Array> {
  const doc = new Y.Doc();
  // Deterministic merge outcome: Y.Map resolves CONCURRENT same-key sets
  // toward the higher clientID, and both docs draw random ids — when the
  // live doc already carries meta.schemaVersion (the layer-3 stamp test
  // writes it on the shared singleton), the v7 stamp's victory in the
  // layer-2 residual assertion was a coin flip. Pin client A above the
  // live client (same trick as CheckpointService.test.ts tempDocCounter)
  // so the merged value is always the future version.
  doc.clientID = getYDoc().clientID + 1;
  Y.applyUpdate(doc, new Uint8Array(readFileSync(join(fixtureDir, 'v5.update.bin'))));
  await runCrdtMigrationsOnDoc(doc, { createCheckpoint: () => Promise.resolve(1) });
  doc.transact(() => {
    doc.getMap('meta').set('schemaVersion', FUTURE_VERSION);
    doc.getMap('library').set('__schemaVersion', FUTURE_VERSION);
  });
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

const injectCloudUpdate = (workspaceId: string, update: Uint8Array): void => {
  let b64 = '';
  for (let i = 0; i < update.byteLength; i++) b64 += String.fromCharCode(update[i]);
  MockFireProvider.injectSnapshot(pathFor(workspaceId), btoa(b64));
};

describe('quarantine enforcement: two-client obsolete (P4-4 §D5)', () => {
  let unwireSyncEvents: () => void;
  let busEvents: SyncEvent[];
  let unsubscribeBusProbe: () => void;

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
    await configureSyncBackendSelection();
    unwireSyncEvents = wireSyncEvents();

    busEvents = [];
    unsubscribeBusProbe = getSyncEventBus().on((e) => busEvents.push(e));

    useSyncStore.getState().setActiveWorkspaceId(null);
    useUIStore.getState().setObsoleteLock(false);
    vi.spyOn(CheckpointService, 'createAutomaticCheckpoint').mockResolvedValue(null);

    startDeviceHeartbeat();
  });

  afterEach(() => {
    unsubscribeBusProbe();
    unwireSyncEvents();
    stopDeviceHeartbeat();
    stopSyncForWipe();
    MigrationStateService.clear();
    MockFireProvider.clearMockStorage();
    localStorage.removeItem(WORKSPACES_KEY);
    useSyncStore.getState().setActiveWorkspaceId(null);
    useUIStore.getState().setObsoleteLock(false);
    __resetCrdtMigrationsForTests();
    delete window.__VERSICLE_MOCK_FIRESTORE__;
    delete window.__VERSICLE_FIRESTORE_DEBOUNCE_MS__;
    vi.restoreAllMocks();
  });

  const expectLocked = async (incomingVersion: number) => {
    await vi.waitFor(() => expect(useUIStore.getState().obsoleteLock).toBe(true), {
      timeout: 5000,
    });
    expect(busEvents).toContainEqual({ type: 'obsolete', incomingVersion });
    expect((await getSyncOrchestratorAsync()).getStatus()).toBe('disconnected');
    expect(isDeviceHeartbeatRunning()).toBe(false);
  };

  it('layer 1 — pre-attach probe: fleet-migrated workspace metadata locks the client BEFORE any download', async () => {
    seedWorkspace('ws_fleet', { schemaVersion: FUTURE_VERSION });
    injectCloudUpdate('ws_fleet', await buildFutureVersionUpdate());
    useSyncStore.getState().setActiveWorkspaceId('ws_fleet');

    await (await getSyncOrchestratorAsync()).start();
    await expectLocked(FUTURE_VERSION);

    // No remote byte reached the live doc (the gate fired pre-download).
    expect(JSON.stringify(getYDoc().getMap('library').toJSON())).not.toContain(
      'fixture-book-alice'
    );
    expect(getYDoc().getMap('meta').get('schemaVersion')).not.toBe(FUTURE_VERSION);
    // The workspace tie is NOT severed: lock, don't wipe (recoverable —
    // re-probed on next start; risk R4 mitigation).
    expect(useSyncStore.getState().activeWorkspaceId).toBe('ws_fleet');
  });

  it('layer 1 — clean-sync pre-apply check: downloaded v7 state never touches the live doc', async () => {
    // Metadata stamp lagging (still CURRENT) — the pre-attach probe passes,
    // the scratch check after download must catch it.
    seedWorkspace('ws_v7doc');
    injectCloudUpdate('ws_v7doc', await buildFutureVersionUpdate());
    useSyncStore.getState().setActiveWorkspaceId('ws_v7doc');

    await (await getSyncOrchestratorAsync()).start();
    await expectLocked(FUTURE_VERSION);

    expect(JSON.stringify(getYDoc().getMap('library').toJSON())).not.toContain(
      'fixture-book-alice'
    );
    expect(getYDoc().getMap('meta').get('schemaVersion')).not.toBe(FUTURE_VERSION);
  });

  it('layer 1 — switchWorkspace verify: a v7 target aborts non-destructively before apply', async () => {
    seedWorkspace('ws_a');
    seedWorkspace('ws_b');
    injectCloudUpdate('ws_b', await buildFutureVersionUpdate());
    useSyncStore.getState().setActiveWorkspaceId('ws_a');
    vi.spyOn(CheckpointService, 'createCheckpoint').mockResolvedValue(7);

    await expect((await getSyncOrchestratorAsync()).switchWorkspace('ws_b')).rejects.toThrow(
      /requires schema/
    );
    await expectLocked(FUTURE_VERSION);

    // Nothing destructive ran and the state machine resolved cleanly: the
    // verify gate fires BEFORE the staged swap's stage step, so the
    // staging database was never written and no STAGED commit happened.
    await expect(readSnapshot({ dbName: YJS_STAGING_DB_NAME })).resolves.toBeNull();
    expect(MigrationStateService.getState()).toBeNull();
    expect(useSyncStore.getState().activeWorkspaceId).toBe('ws_a');
  });

  it('layer 3 — metadata stamp: connect writes the migrated doc version back to the directory', async () => {
    seedWorkspace('ws_stamp', { schemaVersion: 2 });
    useSyncStore.getState().setActiveWorkspaceId('ws_stamp');
    // The local doc was migrated to CURRENT (the coordinator's dual-write).
    getYDoc().getMap('meta').set('schemaVersion', CURRENT_SCHEMA_VERSION);

    const manager = await getSyncOrchestratorAsync();
    await manager.start();
    await vi.waitFor(() => expect(manager.getStatus()).toBe('connected'), { timeout: 5000 });

    await vi.waitFor(() => {
      const ws = readWorkspaces().find((w) => w.workspaceId === 'ws_stamp');
      expect(ws?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });
    // No quarantine fired — stamping is maintenance, not enforcement.
    expect(useUIStore.getState().obsoleteLock).toBe(false);
    expect(isDeviceHeartbeatRunning()).toBe(true);
  });

  // LAST in the file on purpose: the live merge poisons the shared doc +
  // store middleware for the rest of the worker (the accepted §D5.2
  // residual — the one transaction's Y-merge has happened).
  it('layer 2 — live observer: an incoming v7 update destroys the provider; zero outbound after lock', async () => {
    seedWorkspace('ws_live');
    useSyncStore.getState().setActiveWorkspaceId('ws_live');

    const manager = await getSyncOrchestratorAsync();
    await manager.start();
    await vi.waitFor(() => expect(manager.getStatus()).toBe('connected'), { timeout: 5000 });

    // The fleet moves on: a v7 update lands on the live doc (this is what
    // the provider does internally with remote updates).
    Y.applyUpdate(getYDoc(), await buildFutureVersionUpdate());

    await expectLocked(FUTURE_VERSION);

    // The accepted residual: that one transaction DID merge locally…
    expect(getYDoc().getMap('meta').get('schemaVersion')).toBe(FUTURE_VERSION);

    // …but the provider is destroyed: a local write after the lock never
    // reaches the backend (upgraded assertion vs P2's label-only severing).
    const storageAfterLock = JSON.stringify(MockFireProvider.getMockStorageData());
    getYDoc().getMap('library').set('post-lock-probe', 'must-not-sync');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(JSON.stringify(MockFireProvider.getMockStorageData())).toBe(storageAfterLock);
  });
});

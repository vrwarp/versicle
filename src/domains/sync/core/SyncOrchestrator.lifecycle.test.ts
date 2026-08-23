/**
 * `SyncOrchestrator` — the lifecycle and connect sequence, over pure ports.
 *
 * SyncOrchestrator.test.ts drives the orchestrator through the REAL
 * FirestoreBackend with a mocked firestore SDK; the characterization and
 * quarantine suites pin the legacy-parity flows. This file replaces the
 * backend with a scripted double so each decision on the connect path can
 * be isolated: the enablement gate, smart routing, the tombstone
 * pre-flight, both pre-attach quarantine layers, the reconnect-on-app-swap
 * rule, the metadata stamp, and the clean-sync fork.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import type { User } from 'firebase/auth';
import { WorkspaceDeletedError } from '~types/errors';
import type { WorkspaceMetadata } from '~types/workspace';
import type { FirestoreSyncStatus } from '~types/sync';
import type { SyncBackend, SyncConnection } from '../backend/SyncBackend';
import type { SyncEvent } from '../events';
import type { SyncOrchestratorDeps } from './ports';
import { createSyncOrchestrator, type SyncOrchestrator } from './SyncOrchestrator';

const SCHEMA_VERSION = 6;

// ── module doubles ─────────────────────────────────────────────────────────

let firebaseApp: object | null = { app: 1 };
const onAuthStateChanged = vi.fn();

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (...args: unknown[]) => onAuthStateChanged(...args),
}));

vi.mock('@lib/sync/firebase-config', () => ({
  isFirebaseConfigured: () => true,
  initializeFirebase: () => true,
  getFirebaseAuth: () => ({ currentUser: null }),
  getFirebaseApp: () => firebaseApp,
}));

vi.mock('@lib/sync/auth-helper', () => ({
  signInWithGoogle: async () => undefined,
  signOutWithGoogle: async () => undefined,
}));

// ── fixtures ───────────────────────────────────────────────────────────────

const user = (uid = 'uid-1'): User => ({ uid, email: `${uid}@x` }) as User;

const meta = (over: Partial<WorkspaceMetadata> = {}): WorkspaceMetadata => ({
  workspaceId: 'ws_1',
  name: 'Library',
  createdAt: 1,
  schemaVersion: SCHEMA_VERSION,
  ...over,
});

const idleConnection = (): SyncConnection => ({
  on: () => undefined,
  off: () => undefined,
  destroy: () => undefined,
});

const syncedConnection = (): SyncConnection => ({
  on: (event, cb) => {
    if (event === 'synced') setTimeout(() => (cb as () => void)(), 0);
  },
  off: () => undefined,
  destroy: () => undefined,
});

interface Harness {
  orchestrator: SyncOrchestrator;
  backend: SyncBackend;
  calls: string[];
  events: SyncEvent[];
  doc: Y.Doc;
  activeWorkspaceId: () => string | null;
  obsolete: number[];
  connectOptions: Array<Record<string, unknown>>;
  signIn: (u?: User | null) => Promise<void>;
  logs: { warn: string[]; info: string[]; error: unknown[][] };
}

const build = (
  over: {
    backend?: Partial<SyncBackend>;
    deps?: Partial<SyncOrchestratorDeps>;
    activeWorkspaceId?: string | null;
  } = {}
): Harness => {
  const calls: string[] = [];
  const events: SyncEvent[] = [];
  const obsolete: number[] = [];
  const connectOptions: Array<Record<string, unknown>> = [];
  const doc = new Y.Doc();
  let active: string | null =
    over.activeWorkspaceId === undefined ? 'ws_1' : over.activeWorkspaceId;
  const logs = { warn: [] as string[], info: [] as string[], error: [] as unknown[][] };

  vi.spyOn(console, 'info').mockImplementation((...a: unknown[]) => logs.info.push(a.map(String).join(' ')));
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => logs.warn.push(a.map(String).join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => logs.error.push(a));
  vi.spyOn(console, 'debug').mockImplementation(() => {});

  const backend: SyncBackend = {
    uid: 'uid-1',
    createWorkspace: async (m) => {
      calls.push(`createWorkspace:${m.name}`);
    },
    listWorkspaces: async () => {
      calls.push('listWorkspaces');
      return [meta()];
    },
    updateWorkspaceMetadata: async (id, patch) => {
      calls.push(`updateWorkspaceMetadata:${id}:${JSON.stringify(patch)}`);
    },
    isWorkspaceAlive: async () => true,
    probeHasData: async () => false,
    tombstoneWorkspace: async () => undefined,
    purgeWorkspace: async () => ({ docsDeleted: 0, blobsDeleted: 0 }),
    headArtifact: async () => null,
    putArtifact: async () => undefined,
    getArtifact: async () => null,
    deleteArtifactHead: async () => undefined,
    sweepArtifacts: async () => ({ headsDeleted: 0, blobsDeleted: 0 }),
    connect: (_doc, workspaceId, opts) => {
      calls.push(`connect:${workspaceId}`);
      connectOptions.push({ ...(opts as Record<string, unknown>) });
      return idleConnection();
    },
    ...over.backend,
  };

  const orchestrator = createSyncOrchestrator({
    backendSelection: { factory: () => backend },
    events: {
      emit: (e) => {
        events.push(e);
      },
      on: () => () => undefined,
    },
    doc: () => doc,
    whenLocalSynced: async () => {
      calls.push('whenLocalSynced');
    },
    onObsolete: (v) => obsolete.push(v),
    currentSchemaVersion: SCHEMA_VERSION,
    isCleanClient: () => false,
    isEnabled: () => true,
    debounceOverrideMs: () => 0,
    syncState: {
      getActiveWorkspaceId: () => active,
      setActiveWorkspaceId: (id) => {
        calls.push(`setActiveWorkspaceId:${id}`);
        active = id;
      },
      setFirebaseEnabled: (v) => calls.push(`setFirebaseEnabled:${v}`),
    },
    checkpoints: {
      createCheckpoint: async () => 1,
      createAutomaticCheckpoint: async (trigger, intervalMs) => {
        calls.push(`createAutomaticCheckpoint:${trigger}:${intervalMs}`);
        return 5;
      },
    },
    migrationState: {
      setStaged: () => undefined,
      setAwaitingConfirmation: () => undefined,
      setRestoringBackup: () => undefined,
      clear: () => undefined,
    },
    ...over.deps,
  });

  /** Start the orchestrator and deliver an auth state to it. */
  const signIn = async (u: User | null = user()): Promise<void> => {
    await orchestrator.start();
    const listener = onAuthStateChanged.mock.calls.at(-1)?.[1] as
      | ((u: User | null) => void)
      | undefined;
    listener?.(u);
    // handleAuthStateChange is async and deliberately un-awaited internally.
    await new Promise((r) => setTimeout(r, 0));
  };

  return {
    orchestrator,
    backend,
    calls,
    events,
    doc,
    activeWorkspaceId: () => active,
    obsolete,
    connectOptions,
    signIn,
    logs,
  };
};

beforeEach(() => {
  firebaseApp = { app: 1 };
  onAuthStateChanged.mockReset().mockReturnValue(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SyncOrchestrator.start — the enablement gate', () => {
  it('refuses to start when sync is disabled, and reports signed-out', async () => {
    const h = build({ deps: { isEnabled: () => false } });

    await h.orchestrator.start();

    expect(onAuthStateChanged).not.toHaveBeenCalled();
    expect(h.orchestrator.getAuthStatus()).toBe('signed-out');
    expect(h.events).toEqual([{ type: 'auth', status: 'signed-out', email: null }]);
  });

  it('starts when the gate is open', async () => {
    const h = build();

    await h.orchestrator.start();

    expect(onAuthStateChanged).toHaveBeenCalledTimes(1);
  });

  it('bypasses the gate for the explicit sign-in path', async () => {
    const h = build({ deps: { isEnabled: () => false } });

    await h.orchestrator.start({ bypassEnabledGate: true });

    expect(onAuthStateChanged).toHaveBeenCalledTimes(1);
  });

  it('signIn starts the session first when it was never started', async () => {
    const h = build({ deps: { isEnabled: () => false } });

    await h.orchestrator.signIn();

    expect(onAuthStateChanged).toHaveBeenCalledTimes(1);
  });

  it('signIn does NOT re-start an already-started session', async () => {
    const h = build();
    await h.orchestrator.start();

    await h.orchestrator.signIn();

    expect(onAuthStateChanged).toHaveBeenCalledTimes(1);
  });

  it('stop clears `started`, so a later signIn starts again', async () => {
    const h = build();
    await h.orchestrator.start();

    h.orchestrator.stop();
    await h.orchestrator.signIn();

    expect(onAuthStateChanged).toHaveBeenCalledTimes(2);
  });
});

describe('SyncOrchestrator — auth state changes', () => {
  it('a signed-in user stamps the persisted enablement flag and connects', async () => {
    const h = build();

    await h.signIn();

    expect(h.orchestrator.getAuthStatus()).toBe('signed-in');
    expect(h.calls).toContain('setFirebaseEnabled:true');
    expect(h.calls).toContain('connect:ws_1');
  });

  it('auto-provisions "My Library" for a client with no workspace and none remote', async () => {
    const h = build({
      activeWorkspaceId: null,
      backend: { listWorkspaces: async () => [] },
    });

    await h.signIn();

    expect(h.calls).toContain('createWorkspace:My Library');
    expect(h.orchestrator.getActiveWorkspaceId()).toMatch(/^ws_/);
  });

  it('HALTS for user selection when several remote workspaces exist', async () => {
    const h = build({
      activeWorkspaceId: null,
      backend: {
        listWorkspaces: async () => [meta({ workspaceId: 'ws_a' }), meta({ workspaceId: 'ws_b' })],
      },
    });

    await h.signIn();

    expect(h.orchestrator.getStatus()).toBe('disconnected');
    expect(h.orchestrator.getActiveWorkspaceId()).toBeNull();
    expect(h.calls.some((c) => c.startsWith('connect:'))).toBe(false);
    expect(h.calls).not.toContain('createWorkspace:My Library');
  });

  it('a signed-out state detaches the provider and reports signed-out', async () => {
    const h = build();
    await h.signIn();

    await h.signIn(null);

    expect(h.orchestrator.getAuthStatus()).toBe('signed-out');
    expect(h.orchestrator.getStatus()).toBe('disconnected');
  });
});

describe('SyncOrchestrator.connect — the pre-flight gates', () => {
  it('halts with no active workspace', async () => {
    const h = build({ activeWorkspaceId: null });

    await h.orchestrator.connect('uid-1');

    expect(h.orchestrator.getStatus()).toBe('disconnected');
    expect(h.calls.some((c) => c.startsWith('connect:'))).toBe(false);
  });

  it('severs the local tie and throws for a TOMBSTONED workspace', async () => {
    const h = build({ backend: { isWorkspaceAlive: async () => false } });

    await expect(h.orchestrator.connect('uid-1')).rejects.toBeInstanceOf(WorkspaceDeletedError);

    expect(h.activeWorkspaceId()).toBeNull();
    expect(h.events).toContainEqual({
      type: 'workspace-tombstoned',
      workspaceId: 'ws_1',
      context: 'connect',
    });
    expect(h.orchestrator.getStatus()).toBe('disconnected');
  });

  it('quarantines a workspace whose METADATA declares a future schema', async () => {
    const h = build({
      backend: { listWorkspaces: async () => [meta({ schemaVersion: SCHEMA_VERSION + 1 })] },
    });

    await h.orchestrator.connect('uid-1');

    expect(h.obsolete).toEqual([SCHEMA_VERSION + 1]);
    expect(h.calls.some((c) => c.startsWith('connect:'))).toBe(false);
    expect(h.logs.warn.some((l) => l.includes('Pre-attach quarantine'))).toBe(true);
  });

  it('admits metadata at EXACTLY the supported version', async () => {
    const h = build({
      backend: { listWorkspaces: async () => [meta({ schemaVersion: SCHEMA_VERSION })] },
    });

    await h.orchestrator.connect('uid-1');

    expect(h.obsolete).toEqual([]);
    expect(h.calls).toContain('connect:ws_1');
  });

  it('proceeds when the workspace has NO metadata row at all', async () => {
    const h = build({ backend: { listWorkspaces: async () => [] } });

    await h.orchestrator.connect('uid-1');

    expect(h.calls).toContain('connect:ws_1');
  });
});

describe('SyncOrchestrator.connect — reconnect discipline', () => {
  it('skips a redundant connect while already attached to the same app', async () => {
    const h = build();
    await h.orchestrator.connect('uid-1');
    const before = h.calls.filter((c) => c.startsWith('connect:')).length;

    await h.orchestrator.connect('uid-1');

    expect(h.calls.filter((c) => c.startsWith('connect:'))).toHaveLength(before);
  });

  it('RE-attaches when the firebase app instance changed underneath', async () => {
    const h = build();
    await h.orchestrator.connect('uid-1');

    firebaseApp = { app: 2 };
    await h.orchestrator.connect('uid-1');

    expect(h.calls.filter((c) => c.startsWith('connect:'))).toHaveLength(2);
  });
});

describe('SyncOrchestrator.connect — checkpoint, tuning and the metadata stamp', () => {
  it('asks for a pre-sync checkpoint at most daily', async () => {
    const h = build();

    await h.orchestrator.connect('uid-1');

    expect(h.calls).toContain('createAutomaticCheckpoint:pre-sync:86400000');
  });

  it('a checkpoint failure never blocks the connect', async () => {
    const h = build({
      deps: {
        checkpoints: {
          createCheckpoint: async () => 1,
          createAutomaticCheckpoint: async () => {
            throw new Error('idb closed');
          },
        },
      },
    });

    await h.orchestrator.connect('uid-1');

    expect(h.calls).toContain('connect:ws_1');
    expect(h.logs.warn.some((l) => l.includes('Failed to create pre-sync checkpoint'))).toBe(true);
  });

  it('waits for local persistence BEFORE attaching', async () => {
    const h = build();

    await h.orchestrator.connect('uid-1');

    expect(h.calls.indexOf('whenLocalSynced')).toBeLessThan(h.calls.indexOf('connect:ws_1'));
  });

  it('uses the configured debounce, or the test override when one is armed', async () => {
    const configured = build({ deps: { config: { maxWaitFirestoreTime: 4321 } } });
    await configured.orchestrator.connect('uid-1');
    expect(configured.connectOptions[0]).toEqual({
      maxWaitTimeMs: 4321,
      maxUpdatesThreshold: 50,
    });

    const overridden = build({ deps: { debounceOverrideMs: () => 7 } });
    await overridden.orchestrator.connect('uid-1');
    expect(overridden.connectOptions[0]).toMatchObject({ maxWaitTimeMs: 7 });
  });

  it('defaults the provider tuning when no config is supplied', async () => {
    const h = build();

    await h.orchestrator.connect('uid-1');

    expect(h.connectOptions[0]).toEqual({ maxWaitTimeMs: 2000, maxUpdatesThreshold: 50 });
  });

  it('honours a partial config, defaulting the rest', async () => {
    const h = build({ deps: { config: { maxUpdatesThreshold: 3 } } });

    await h.orchestrator.connect('uid-1');

    expect(h.connectOptions[0]).toEqual({ maxWaitTimeMs: 2000, maxUpdatesThreshold: 3 });
  });

  it('stamps the workspace metadata when the LOCAL doc is ahead (layer 3)', async () => {
    const h = build({
      backend: { listWorkspaces: async () => [meta({ schemaVersion: 5 })] },
    });
    h.doc.getMap('meta').set('schemaVersion', SCHEMA_VERSION);

    await h.orchestrator.connect('uid-1');
    await new Promise((r) => setTimeout(r, 0));

    expect(h.calls).toContain('updateWorkspaceMetadata:ws_1:{"schemaVersion":6}');
    expect(h.logs.info.some((l) => l.includes('Stamped workspace ws_1 metadata'))).toBe(true);
  });

  it('does NOT stamp when the metadata already matches the doc', async () => {
    const h = build();
    h.doc.getMap('meta').set('schemaVersion', SCHEMA_VERSION);

    await h.orchestrator.connect('uid-1');
    await new Promise((r) => setTimeout(r, 0));

    expect(h.calls.some((c) => c.startsWith('updateWorkspaceMetadata'))).toBe(false);
  });

  it('a failed stamp is logged and retried on a later connect, never fatal', async () => {
    const h = build({
      backend: {
        listWorkspaces: async () => [meta({ schemaVersion: 1 })],
        updateWorkspaceMetadata: async () => {
          throw new Error('offline');
        },
      },
    });
    h.doc.getMap('meta').set('schemaVersion', SCHEMA_VERSION);

    await h.orchestrator.connect('uid-1');
    await new Promise((r) => setTimeout(r, 0));

    expect(h.calls).toContain('connect:ws_1');
    expect(h.logs.warn.some((l) => l.includes('Failed to stamp workspace metadata'))).toBe(true);
  });
});

describe('SyncOrchestrator — the clean-sync fork', () => {
  const cleanDeps = { isCleanClient: () => true };

  it('a dirty client attaches directly, without probing for cloud data', async () => {
    const probe = vi.fn(async () => true);
    const h = build({ backend: { probeHasData: probe } });

    await h.orchestrator.connect('uid-1');

    expect(probe).not.toHaveBeenCalled();
    expect(h.calls).toContain('connect:ws_1');
  });

  it('a clean client with an EMPTY remote attaches as the first device', async () => {
    const h = build({ deps: cleanDeps, backend: { probeHasData: async () => false } });

    await h.orchestrator.connect('uid-1');
    await new Promise((r) => setTimeout(r, 5));

    expect(h.events.some((e) => e.type === 'clean-sync')).toBe(false);
    expect(h.calls).toContain('connect:ws_1');
  });

  it('a clean client downloads, applies and then attaches', async () => {
    const remote = new Y.Doc();
    remote.getMap('library').set('probe', 'from-cloud');
    const update = Y.encodeStateAsUpdate(remote);
    const h = build({
      deps: cleanDeps,
      backend: {
        probeHasData: async () => true,
        connect: (doc, workspaceId) => {
          if (workspaceId === 'ws_1') Y.applyUpdate(doc, update);
          return syncedConnection();
        },
      },
    });

    await h.orchestrator.connect('uid-1');
    await new Promise((r) => setTimeout(r, 20));

    expect(h.doc.getMap('library').get('probe')).toBe('from-cloud');
    expect(h.events.filter((e) => e.type === 'clean-sync').map((e) => (e as { phase: string }).phase)).toEqual(
      ['started', 'applied']
    );
  });

  it('QUARANTINES cloud data from the future — nothing is applied', async () => {
    const remote = new Y.Doc();
    remote.getMap('meta').set('schemaVersion', SCHEMA_VERSION + 1);
    remote.getMap('library').set('probe', 'poison');
    const update = Y.encodeStateAsUpdate(remote);
    const h = build({
      deps: cleanDeps,
      backend: {
        probeHasData: async () => true,
        connect: (doc) => {
          Y.applyUpdate(doc, update);
          return syncedConnection();
        },
      },
    });

    await h.orchestrator.connect('uid-1');
    await new Promise((r) => setTimeout(r, 20));

    expect(h.obsolete).toEqual([SCHEMA_VERSION + 1]);
    expect(h.doc.getMap('library').get('probe')).toBeUndefined();
    expect(h.events.some((e) => e.type === 'clean-sync' && e.phase === 'applied')).toBe(false);
  });

  it('reports a failed clean sync without leaving the caller hanging', async () => {
    const h = build({
      deps: cleanDeps,
      backend: {
        probeHasData: async () => {
          throw new Error('probe failed');
        },
      },
    });

    await h.orchestrator.connect('uid-1');
    await new Promise((r) => setTimeout(r, 5));

    expect(h.orchestrator.getStatus()).toBe('error');
    expect(h.events).toContainEqual({ type: 'clean-sync', phase: 'failed' });
  });
});

describe('SyncOrchestrator — workspace delegation', () => {
  it('refuses every workspace mutation while signed out', async () => {
    const h = build();

    await expect(h.orchestrator.createWorkspace('X')).rejects.toThrow('Must be signed in');
    await expect(h.orchestrator.switchWorkspace('ws_2')).rejects.toThrow('Must be signed in');
    await expect(h.orchestrator.deleteWorkspace('ws_2')).rejects.toThrow('Must be authenticated');
    await expect(h.orchestrator.purgeDeletedWorkspaces()).rejects.toThrow('Must be authenticated');
  });

  it('lists NOTHING (rather than throwing) while signed out', async () => {
    const h = build();

    await expect(h.orchestrator.listWorkspaces()).resolves.toEqual([]);
  });

  it('lists through the backend once signed in', async () => {
    const h = build();
    await h.signIn();
    h.calls.length = 0;

    await expect(h.orchestrator.listWorkspaces()).resolves.toEqual([meta()]);
    expect(h.calls).toContain('listWorkspaces');
  });

  it('deletes and purges through the backend once signed in', async () => {
    const h = build();
    await h.signIn();
    h.calls.length = 0;

    await h.orchestrator.deleteWorkspace('ws_1');
    await expect(h.orchestrator.purgeDeletedWorkspaces()).resolves.toEqual({
      docsDeleted: 0,
      blobsDeleted: 0,
    });
  });
});

describe('SyncOrchestrator — backend caching', () => {
  const stub = (uid: string): SyncBackend =>
    ({
      uid,
      isWorkspaceAlive: async () => true,
      listWorkspaces: async () => [],
      probeHasData: async () => false,
      connect: () => idleConnection(),
    }) as unknown as SyncBackend;

  it('builds ONE backend per uid and reuses it across connects', async () => {
    const factory = vi.fn((uid: string) => stub(uid));
    const h = build({ deps: { backendSelection: { factory } } });

    await h.orchestrator.connect('uid-1');
    firebaseApp = { app: 2 }; // force a genuine re-attach
    await h.orchestrator.connect('uid-1');

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('builds a fresh backend when the uid changes', async () => {
    const factory = vi.fn((uid: string) => stub(uid));
    const h = build({ deps: { backendSelection: { factory } } });

    await h.orchestrator.connect('uid-1');
    await h.orchestrator.connect('uid-2');

    expect(factory).toHaveBeenNthCalledWith(1, 'uid-1');
    expect(factory).toHaveBeenNthCalledWith(2, 'uid-2');
  });

  it('a new selection DROPS the cached backend, so the next connect rebuilds', async () => {
    const first = vi.fn((uid: string) => stub(uid));
    const second = vi.fn((uid: string) => stub(uid));
    const h = build({ deps: { backendSelection: { factory: first } } });
    await h.orchestrator.connect('uid-1');

    h.orchestrator.setBackendSelection({ factory: second });
    firebaseApp = { app: 3 };
    await h.orchestrator.connect('uid-1');

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('a selection carrying a mock session is visible to the auth half', () => {
    const h = build();

    h.orchestrator.setBackendSelection({
      factory: (uid) => stub(uid),
      mockSession: { uid: 'mock', email: 'mock@x' },
    });

    expect(h.orchestrator.getCurrentUser()?.uid).toBe('mock');
  });
});

describe('SyncOrchestrator — status fan-out and getters', () => {
  it('fires a new status subscriber immediately with the current value', () => {
    const h = build();
    const seen: FirestoreSyncStatus[] = [];

    h.orchestrator.onStatusChange((s) => seen.push(s));

    expect(seen).toEqual(['disconnected']);
  });

  it('publishes each change to subscribers AND the bus', async () => {
    const h = build({ activeWorkspaceId: null });
    const seen: FirestoreSyncStatus[] = [];
    h.orchestrator.onStatusChange((s) => seen.push(s));
    seen.length = 0;
    h.events.length = 0;

    await h.orchestrator.connect('uid-1');

    expect(seen).toEqual(['disconnected']);
    expect(h.events).toContainEqual({ type: 'status', status: 'disconnected' });
  });

  it('the returned handle unsubscribes', async () => {
    const h = build({ activeWorkspaceId: null });
    const seen: FirestoreSyncStatus[] = [];
    const off = h.orchestrator.onStatusChange((s) => seen.push(s));
    seen.length = 0;

    off();
    await h.orchestrator.connect('uid-1');

    expect(seen).toEqual([]);
  });

  it('reports connection and sign-in state from the live values', async () => {
    const h = build();
    expect(h.orchestrator.isConnected()).toBe(false);
    expect(h.orchestrator.isSignedIn()).toBe(false);

    await h.signIn();

    expect(h.orchestrator.isSignedIn()).toBe(true);
    expect(h.orchestrator.isConnected()).toBe(true);
    expect(h.orchestrator.getStatus()).toBe('connected');
  });

  it('stop() detaches, clears subscribers and reports disconnected', async () => {
    const h = build();
    await h.signIn();
    const seen: FirestoreSyncStatus[] = [];
    h.orchestrator.onStatusChange((s) => seen.push(s));
    seen.length = 0;

    h.orchestrator.stop();

    expect(h.orchestrator.getStatus()).toBe('disconnected');
    // The callbacks were cleared as part of stop, AFTER the detach status.
    expect(seen).toEqual(['disconnected']);
  });
});

describe('SyncOrchestrator.severObsoleteConnection', () => {
  it('destroys a live connection and says why', async () => {
    const h = build();
    await h.orchestrator.connect('uid-1');
    h.logs.warn.length = 0;

    h.orchestrator.severObsoleteConnection();

    expect(h.logs.warn.some((l) => l.includes('Obsolete client: destroying provider'))).toBe(true);
    expect(h.orchestrator.getStatus()).toBe('disconnected');
  });

  it('is silent and idempotent when nothing is attached', () => {
    const h = build();

    h.orchestrator.severObsoleteConnection();
    h.orchestrator.severObsoleteConnection();

    expect(h.logs.warn.some((l) => l.includes('Obsolete client'))).toBe(false);
    expect(h.orchestrator.getStatus()).toBe('disconnected');
  });
});

describe('SyncOrchestrator.getConnectedArtifactBackend', () => {
  it('is null while disconnected', () => {
    expect(build().orchestrator.getConnectedArtifactBackend()).toBeNull();
  });

  it('is null when connected but signed out', async () => {
    const h = build();
    await h.orchestrator.connect('uid-1');

    expect(h.orchestrator.isConnected()).toBe(true);
    expect(h.orchestrator.getConnectedArtifactBackend()).toBeNull();
  });

  it('is null when signed in and connected but no workspace is selected', async () => {
    const h = build();
    await h.signIn();
    h.orchestrator.stop();

    expect(h.orchestrator.getConnectedArtifactBackend()).toBeNull();
  });

  it('reports the bound backend and workspace when fully live', async () => {
    const h = build();
    await h.signIn();

    expect(h.orchestrator.getConnectedArtifactBackend()).toEqual({
      backend: h.backend,
      workspaceId: 'ws_1',
    });
  });
});

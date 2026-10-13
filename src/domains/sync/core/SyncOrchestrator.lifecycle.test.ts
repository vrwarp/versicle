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
import { getRecentLogs } from '@lib/logger';
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
const signOutWithGoogle = vi.fn(async (_auth: unknown): Promise<void> => undefined);

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
  signOutWithGoogle: (auth: unknown) => signOutWithGoogle(auth),
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
  logs: {
    warn: string[];
    info: string[];
    /**
     * Debug lines since the harness was built, as `[ns] msg`. Debug is below
     * the console threshold, so it is read from the logger's diagnostics ring.
     */
    debug: () => string[];
    error: unknown[][];
  };
}

const DEFAULT_CONFIG = { maxWaitFirestoreTime: 2000, maxUpdatesThreshold: 50 };
/** The default tuning as the live/clean-sync connect options carry it. */
const DEFAULT_CONFIG_AS_CONNECT = { maxWaitTimeMs: 2000, maxUpdatesThreshold: 50 };
/** The temp-connection tuning of the diagnostics download/repair paths. */
const DIAGNOSTIC_CONNECT = { maxWaitTimeMs: 2000, maxUpdatesThreshold: 1_000_000_000 };

/** `ms` is a real elapsed duration, not a timestamp sum. */
const elapsedMs = (ms: unknown): void => {
  expect(ms).toBeGreaterThanOrEqual(0);
  expect(ms).toBeLessThan(10_000);
};

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
  const ringStart = getRecentLogs().length;
  const logs = {
    warn: [] as string[],
    info: [] as string[],
    debug: (): string[] =>
      getRecentLogs()
        .slice(ringStart)
        .filter((r) => r.level === 'debug')
        .map((r) => `[${r.ns}] ${r.msg}`),
    error: [] as unknown[][],
  };

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
      connectOptions.push({ ...(opts as unknown as Record<string, unknown>) });
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
  signOutWithGoogle.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SyncOrchestrator.start — the enablement gate', () => {
  it('refuses to start when sync is disabled, and reports signed-out', async () => {
    const h = build({ deps: { isEnabled: () => false } });

    await h.orchestrator.start();

    expect(onAuthStateChanged).not.toHaveBeenCalled();
    expect(h.orchestrator.getAuthStatus()).toBe('signed-out');
    expect(h.events).toEqual([{ type: 'auth', status: 'signed-out', email: null }]);
    expect(h.logs.info).toContain(
      '[SyncOrchestrator] Sync disabled (firebaseEnabled flag off or not configured). Not starting.'
    );
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
    expect(h.logs.info).toContain('[SyncOrchestrator] User signed in: uid-1@x');
  });

  it('auto-provisions "My Library" for a client with no workspace and none remote', async () => {
    const h = build({
      activeWorkspaceId: null,
      backend: { listWorkspaces: async () => [] },
    });

    await h.signIn();

    expect(h.calls).toContain('createWorkspace:My Library');
    expect(h.orchestrator.getActiveWorkspaceId()).toMatch(/^ws_/);
    expect(h.logs.info).toContain('[SyncOrchestrator] No active workspace assigned. Querying remote...');
    expect(h.logs.info).toContain(
      '[SyncOrchestrator] Zero remote workspaces found. Auto-provisioning "My Library"...'
    );
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
    expect(h.logs.info).toContain(
      '[SyncOrchestrator] 2 workspaces found. Halting connection until user selection.'
    );
  });

  it('a signed-out state detaches the provider and reports signed-out', async () => {
    const h = build();
    await h.signIn();

    await h.signIn(null);

    expect(h.orchestrator.getAuthStatus()).toBe('signed-out');
    expect(h.orchestrator.getStatus()).toBe('disconnected');
    expect(h.logs.info).toContain('[SyncOrchestrator] User signed out');
  });

  it('signOut goes through the auth helper', async () => {
    const h = build();
    await h.signIn();

    await h.orchestrator.signOut();

    expect(signOutWithGoogle).toHaveBeenCalledTimes(1);
  });
});

describe('SyncOrchestrator.connect — the pre-flight gates', () => {
  it('halts with no active workspace', async () => {
    const h = build({ activeWorkspaceId: null });

    await h.orchestrator.connect('uid-1');

    expect(h.orchestrator.getStatus()).toBe('disconnected');
    expect(h.calls.some((c) => c.startsWith('connect:'))).toBe(false);
    expect(h.logs.info).toContain('[SyncOrchestrator] Sync halted: No active workspace explicitly selected.');
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
    expect(h.logs.warn).toContain('[SyncOrchestrator] Sync aborted: Workspace ws_1 is tombstoned.');
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

  it('matches the metadata row by workspace id, not by position', async () => {
    const h = build({
      backend: {
        listWorkspaces: async () => [
          meta({ workspaceId: 'ws_other', schemaVersion: SCHEMA_VERSION + 1 }),
          meta({ workspaceId: 'ws_1', schemaVersion: SCHEMA_VERSION }),
        ],
      },
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
    expect(h.logs.debug()).toContain('[SyncOrchestrator] Already connected, skipping');
  });

  it('RE-attaches when the firebase app instance changed underneath, destroying the old connection first', async () => {
    let connects = 0;
    let destroyed = 0;
    const h = build({
      backend: {
        connect: () => {
          connects += 1;
          return {
            ...idleConnection(),
            destroy: () => {
              destroyed += 1;
            },
          };
        },
      },
    });
    await h.orchestrator.connect('uid-1');
    expect(destroyed).toBe(0);

    firebaseApp = { app: 2 };
    await h.orchestrator.connect('uid-1');

    expect(connects).toBe(2);
    expect(destroyed).toBe(1);
    expect(h.logs.debug()).toContain('[SyncOrchestrator] Firebase app changed, reconnecting...');
  });
});

describe('SyncOrchestrator.connect — checkpoint, tuning and the metadata stamp', () => {
  it('asks for a pre-sync checkpoint at most daily', async () => {
    const h = build();

    await h.orchestrator.connect('uid-1');

    expect(h.calls).toContain('createAutomaticCheckpoint:pre-sync:86400000');
    expect(h.logs.debug()).toContain('[SyncOrchestrator] Creating pre-sync checkpoint (if needed)...');
    expect(h.logs.info).toContain('[SyncOrchestrator] Created pre-sync checkpoint #5');
    expect(h.logs.debug()).not.toContain('[SyncOrchestrator] Skipped pre-sync checkpoint (recent one exists)');
  });

  it('notes a skipped checkpoint (a recent one exists) without claiming one', async () => {
    const h = build({
      deps: {
        checkpoints: { createCheckpoint: async () => 1, createAutomaticCheckpoint: async () => null },
      },
    });

    await h.orchestrator.connect('uid-1');

    expect(h.logs.debug()).toContain('[SyncOrchestrator] Skipped pre-sync checkpoint (recent one exists)');
    expect(h.logs.info.some((l) => l.includes('Created pre-sync checkpoint'))).toBe(false);
    expect(h.calls).toContain('connect:ws_1');
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
    expect(h.events).toContainEqual({ type: 'status', status: 'connecting' });
    expect(h.logs.info).toContain('[SyncOrchestrator] Clean client detected. Checking for cloud data...');
    expect(h.logs.info).toContain('[SyncOrchestrator] No cloud data found. Client is officially the first device.');
  });

  it('a clean client downloads, applies and then attaches', async () => {
    const remote = new Y.Doc();
    remote.getMap('library').set('probe', 'from-cloud');
    const update = Y.encodeStateAsUpdate(remote);
    const connects: Array<{ workspaceId: string; opts: Record<string, unknown> }> = [];
    const h = build({
      deps: cleanDeps,
      backend: {
        probeHasData: async () => true,
        connect: (doc, workspaceId, opts) => {
          connects.push({ workspaceId, opts: { ...opts } });
          // Only the FIRST connection (the temp doc) carries cloud data; the
          // live attach must not be what populates the live doc.
          if (connects.length === 1) Y.applyUpdate(doc, update);
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
    expect(connects).toEqual([
      { workspaceId: 'ws_1', opts: DEFAULT_CONFIG_AS_CONNECT },
      { workspaceId: 'ws_1', opts: DEFAULT_CONFIG_AS_CONNECT },
    ]);
    expect(h.orchestrator.getStatus()).toBe('connected');
    expect(h.logs.info).toContain('[SyncOrchestrator] Cloud data found. Initiating temporary Y.Doc sync...');
    expect(h.logs.info).toContain('[SyncOrchestrator] Applying downloaded cloud data to main Y.Doc...');
    expect(h.logs.info).toContain('[SyncOrchestrator] Clean sync complete. Connecting main provider...');
  });

  it('applies cloud data at EXACTLY the supported version', async () => {
    const remote = new Y.Doc();
    remote.getMap('meta').set('schemaVersion', SCHEMA_VERSION);
    remote.getMap('library').set('probe', 'same-version');
    const update = Y.encodeStateAsUpdate(remote);
    let n = 0;
    const h = build({
      deps: cleanDeps,
      backend: {
        probeHasData: async () => true,
        connect: (doc) => {
          if (n++ === 0) Y.applyUpdate(doc, update);
          return syncedConnection();
        },
      },
    });

    await h.orchestrator.connect('uid-1');
    await new Promise((r) => setTimeout(r, 20));

    expect(h.obsolete).toEqual([]);
    expect(h.doc.getMap('library').get('probe')).toBe('same-version');
  });

  it('a temp-connection attach failure reads as an EMPTY remote (legacy clean-sync semantics)', async () => {
    let n = 0;
    const h = build({
      deps: cleanDeps,
      backend: {
        probeHasData: async () => true,
        connect: () => {
          if (n++ === 0) throw new Error('temp attach refused');
          return idleConnection();
        },
      },
    });

    await h.orchestrator.connect('uid-1');
    await new Promise((r) => setTimeout(r, 20));

    expect(h.events.filter((e) => e.type === 'clean-sync').map((e) => (e as { phase: string }).phase)).toEqual(
      ['started', 'applied']
    );
    expect(h.orchestrator.getStatus()).toBe('connected');
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
    expect(h.logs.warn).toContain(
      '[SyncOrchestrator] Clean-sync quarantine: cloud data is schema v7 > supported v6. Nothing was applied.'
    );
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
    expect(h.logs.error).toContainEqual(['[SyncOrchestrator]', 'Failed clean sync:', expect.any(Error)]);
  });

  it('a clean sync that blows up OUTSIDE its own guard is still reported as an error', async () => {
    // A status subscriber that throws on `connecting` fails performCleanSync
    // before its try block — the detached promise's catch must still land.
    const h = build({ deps: cleanDeps });
    const boom = new Error('subscriber exploded');
    let armed = true;
    h.orchestrator.onStatusChange((status) => {
      if (status === 'connecting' && armed) {
        armed = false;
        throw boom;
      }
    });

    await h.orchestrator.connect('uid-1');
    await new Promise((r) => setTimeout(r, 5));

    expect(h.logs.error).toContainEqual(['[SyncOrchestrator]', 'Clean sync failed:', boom]);
    expect(h.orchestrator.getStatus()).toBe('error');
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
    const unsubscribeAuth = vi.fn();
    onAuthStateChanged.mockReturnValue(unsubscribeAuth);
    const h = build();
    await h.signIn();
    const seen: FirestoreSyncStatus[] = [];
    h.orchestrator.onStatusChange((s) => seen.push(s));
    seen.length = 0;

    h.orchestrator.stop();

    expect(h.orchestrator.getStatus()).toBe('disconnected');
    // The callbacks were cleared as part of stop, AFTER the detach status.
    expect(seen).toEqual(['disconnected']);
    expect(unsubscribeAuth).toHaveBeenCalledTimes(1);
    expect(h.logs.debug()).toContain('[SyncOrchestrator] Orchestrator stopped');

    // Cleared for real: a later status change reaches nobody.
    h.orchestrator.severObsoleteConnection();
    expect(h.orchestrator.getStatus()).toBe('disconnected');
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

  it('is null when connected and signed in but the active workspace was cleared', async () => {
    let active: string | null = 'ws_1';
    const h = build({
      deps: {
        syncState: {
          getActiveWorkspaceId: () => active,
          setActiveWorkspaceId: (id) => {
            active = id;
          },
          setFirebaseEnabled: () => undefined,
        },
      },
    });
    await h.signIn();
    expect(h.orchestrator.getConnectedArtifactBackend()).not.toBeNull();

    active = null;

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

describe('SyncOrchestrator diagnostics (read-only export surface)', () => {
  const detachedProvider = {
    attached: false,
    workspaceId: null,
    attachedAt: null,
    liveQuarantineObserver: false,
    transport: null,
  };

  it('is a complete, null-safe snapshot before anything started', () => {
    const h = build();

    expect(h.orchestrator.getDiagnostics()).toEqual({
      started: false,
      status: 'disconnected',
      authStatus: 'loading',
      uid: null,
      email: null,
      activeWorkspaceId: 'ws_1',
      backendUid: null,
      mockBackend: false,
      firebaseAppName: null,
      firebaseAppMatchesCurrent: null,
      config: DEFAULT_CONFIG,
      debounceOverrideMs: 0,
      currentSchemaVersion: SCHEMA_VERSION,
      provider: detachedProvider,
    });
  });

  it('reports the live connection, including the transport describe()', async () => {
    firebaseApp = { name: 'app-one' };
    const h = build({
      deps: { debounceOverrideMs: () => 7, config: { maxUpdatesThreshold: 9 } },
      backend: {
        connect: () => ({ ...idleConnection(), describe: () => ({ transport: 'scripted', pendingUpdates: 3 }) }),
      },
    });
    await h.signIn();

    const d = h.orchestrator.getDiagnostics();
    expect(d).toEqual({
      started: true,
      status: 'connected',
      authStatus: 'signed-in',
      uid: 'uid-1',
      email: 'uid-1@x',
      activeWorkspaceId: 'ws_1',
      backendUid: 'uid-1',
      mockBackend: false,
      firebaseAppName: 'app-one',
      firebaseAppMatchesCurrent: true,
      config: { maxWaitFirestoreTime: 2000, maxUpdatesThreshold: 9 },
      debounceOverrideMs: 7,
      currentSchemaVersion: SCHEMA_VERSION,
      provider: {
        attached: true,
        workspaceId: 'ws_1',
        attachedAt: expect.any(Number),
        liveQuarantineObserver: true,
        transport: { transport: 'scripted', pendingUpdates: 3 },
      },
    });
    // A copy of the config, never the live object.
    (d.config as Record<string, unknown>).maxUpdatesThreshold = -1;
    expect(h.orchestrator.getDiagnostics().config).toEqual({ maxWaitFirestoreTime: 2000, maxUpdatesThreshold: 9 });
  });

  it('flags a firebase app that was swapped underneath the live connection', async () => {
    firebaseApp = { name: 'app-one' };
    const h = build();
    await h.signIn();

    firebaseApp = { name: 'app-two' };

    expect(h.orchestrator.getDiagnostics()).toMatchObject({
      firebaseAppName: 'app-one',
      firebaseAppMatchesCurrent: false,
    });
  });

  it('records no firebase app when the attach failed', async () => {
    firebaseApp = { name: 'app-one' };
    const h = build({
      backend: {
        connect: () => {
          throw new Error('offline');
        },
      },
    });

    await h.orchestrator.connect('uid-1');

    expect(h.orchestrator.getDiagnostics()).toMatchObject({
      status: 'error',
      firebaseAppName: null,
      firebaseAppMatchesCurrent: null,
      provider: detachedProvider,
    });
  });

  it('reports a detached provider after stop()', async () => {
    const h = build();
    await h.signIn();
    h.orchestrator.stop();

    expect(h.orchestrator.getDiagnostics()).toMatchObject({
      started: false,
      status: 'disconnected',
      provider: detachedProvider,
    });
  });

  it('a throwing transport describe() is captured, not propagated', async () => {
    const h = build({
      backend: {
        connect: () => ({
          ...idleConnection(),
          describe: () => {
            throw new Error('boom');
          },
        }),
      },
    });
    await h.signIn();

    expect(h.orchestrator.getDiagnostics().provider).toMatchObject({
      attached: true,
      transport: { describeError: 'Error: boom' },
    });
  });

  it('probeRemoteDiagnostics skips when signed out', async () => {
    expect(await build().orchestrator.probeRemoteDiagnostics()).toEqual({ skipped: 'not signed in' });
  });

  it('probeRemoteDiagnostics lists every workspace (tombstoned included) and probes the active one', async () => {
    const listOpts: unknown[] = [];
    const h = build({
      backend: {
        listWorkspaces: async (opts) => {
          listOpts.push(opts);
          return [meta(), meta({ workspaceId: 'ws_dead', deletedAt: 5 })];
        },
        probeHasData: async () => true,
        probePendingWrites: async () => ({ state: 'stuck' as const, ms: 8000 }),
      },
    });
    await h.signIn();
    listOpts.length = 0;

    const remote = await h.orchestrator.probeRemoteDiagnostics();

    expect(listOpts).toEqual([{ includeDeleted: true }]);
    expect(remote).toEqual({
      uid: 'uid-1',
      activeWorkspaceId: 'ws_1',
      workspaces: {
        ok: true,
        value: [meta(), meta({ workspaceId: 'ws_dead', deletedAt: 5 })],
        ms: expect.any(Number),
      },
      alive: { ok: true, value: true, ms: expect.any(Number) },
      hasData: { ok: true, value: true, ms: expect.any(Number) },
      pendingWrites: { state: 'stuck', ms: 8000 },
    });
    for (const probe of [remote.workspaces, remote.alive, remote.hasData]) {
      elapsedMs((probe as { ms: number }).ms);
    }
  });

  it('probeRemoteDiagnostics skips the per-workspace probes without an active workspace', async () => {
    const h = build({ activeWorkspaceId: null });
    await h.signIn(); // one remote workspace → halts for selection, nothing active

    expect(await h.orchestrator.probeRemoteDiagnostics()).toEqual({
      uid: 'uid-1',
      activeWorkspaceId: null,
      workspaces: { ok: true, value: [meta()], ms: expect.any(Number) },
      alive: null,
      hasData: null,
      pendingWrites: null,
    });
  });

  it('probeRemoteDiagnostics records failures and timeouts per probe', async () => {
    const h = build();
    await h.signIn();
    h.backend.isWorkspaceAlive = async () => {
      throw Object.assign(new Error('denied'), { code: 'permission-denied' });
    };
    h.backend.probeHasData = () => new Promise<boolean>(() => undefined);

    const remote = await h.orchestrator.probeRemoteDiagnostics(20);

    expect(remote.alive).toEqual({
      ok: false,
      error: 'Error: denied (code=permission-denied)',
      ms: expect.any(Number),
    });
    expect(remote.hasData).toEqual({
      ok: false,
      error: 'Error: probeHasData timed out after 20ms',
      ms: expect.any(Number),
    });
    expect(remote.workspaces).toEqual({ ok: true, value: [meta()], ms: expect.any(Number) });
    elapsedMs((remote.alive as { ms: number }).ms);
    elapsedMs((remote.hasData as { ms: number }).ms);
  });

  it('probeRemoteDiagnostics labels each timed-out probe by name', async () => {
    const hang = () => new Promise<never>(() => undefined);
    const h = build();
    await h.signIn();
    h.backend.listWorkspaces = hang;
    h.backend.isWorkspaceAlive = hang;
    h.backend.probeHasData = hang;
    vi.useFakeTimers();

    const pending = h.orchestrator.probeRemoteDiagnostics(20);
    await vi.advanceTimersByTimeAsync(20);
    const remote = await pending;

    expect(remote).toEqual({
      uid: 'uid-1',
      activeWorkspaceId: 'ws_1',
      workspaces: { ok: false, error: 'Error: listWorkspaces timed out after 20ms', ms: expect.any(Number) },
      alive: { ok: false, error: 'Error: isWorkspaceAlive timed out after 20ms', ms: expect.any(Number) },
      hasData: { ok: false, error: 'Error: probeHasData timed out after 20ms', ms: expect.any(Number) },
      pendingWrites: null,
    });
  });

  it('probeRemoteDiagnostics clears every probe budget timer once the probes settle', async () => {
    const h = build();
    await h.signIn();
    vi.useFakeTimers();

    const remote = await h.orchestrator.probeRemoteDiagnostics(5000);

    expect(remote).toMatchObject({ workspaces: { ok: true }, alive: { ok: true }, hasData: { ok: true } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('probeRemoteDiagnostics tolerates a probe that rejects with no error object, or throws synchronously', async () => {
    const h = build();
    await h.signIn();
    h.backend.isWorkspaceAlive = () => Promise.reject(undefined);
    h.backend.probeHasData = () => {
      throw new Error('sync boom');
    };

    const remote = await h.orchestrator.probeRemoteDiagnostics(20);

    expect(remote.alive).toEqual({ ok: false, error: 'undefined', ms: expect.any(Number) });
    expect(remote.hasData).toEqual({ ok: false, error: 'Error: sync boom', ms: expect.any(Number) });
  });

  it('probeRemoteDiagnostics caps the pending-writes budget at 8s, below the caller budget', async () => {
    const budgets: number[] = [];
    const h = build({
      backend: {
        probePendingWrites: async (timeoutMs) => {
          budgets.push(timeoutMs);
          return { state: 'acknowledged' as const, ms: 1 };
        },
      },
    });
    await h.signIn();

    await h.orchestrator.probeRemoteDiagnostics(20000);
    await h.orchestrator.probeRemoteDiagnostics(20);

    expect(budgets).toEqual([8000, 20]);
  });

  it('downloadRemoteStateForDiagnostics returns the remote doc state via a temp connection', async () => {
    const connectArgs: Array<{ workspaceId: string; opts: Record<string, unknown> }> = [];
    const h = build();
    await h.signIn();
    h.backend.connect = (tempDoc, workspaceId, opts) => {
      connectArgs.push({ workspaceId, opts: { ...opts } });
      tempDoc.getMap('library').set('remote-book', 1);
      return syncedConnection();
    };

    const r = await h.orchestrator.downloadRemoteStateForDiagnostics(1000);

    expect(r).toEqual({ ok: true, workspaceId: 'ws_1', update: expect.any(Uint8Array), ms: expect.any(Number) });
    elapsedMs(r.ms);
    const probe = new Y.Doc();
    Y.applyUpdate(probe, (r as { update: Uint8Array }).update);
    expect(probe.getMap('library').get('remote-book')).toBe(1);
    // The live connection is untouched; the temp one never forces compaction.
    expect(connectArgs).toEqual([{ workspaceId: 'ws_1', opts: DIAGNOSTIC_CONNECT }]);
    expect(h.orchestrator.getDiagnostics()).toMatchObject({ status: 'connected' });
  });

  it('downloadRemoteStateForDiagnostics reports a timeout as an error, not an empty remote', async () => {
    const h = build();
    await h.signIn();
    h.backend.connect = () => idleConnection();

    const r = await h.orchestrator.downloadRemoteStateForDiagnostics(10);

    expect(r).toEqual({
      ok: false,
      error: 'Error: Workspace download timed out after 10ms (no initial sync)',
      ms: expect.any(Number),
    });
    elapsedMs(r.ms);
  });

  it('downloadRemoteStateForDiagnostics reports an attach failure as an error, not an empty remote', async () => {
    const h = build();
    await h.signIn();
    h.backend.connect = () => {
      throw new Error('attach refused');
    };

    const r = await h.orchestrator.downloadRemoteStateForDiagnostics(1000);

    expect(r).toEqual({ ok: false, error: 'Error: attach refused', ms: expect.any(Number) });
    elapsedMs(r.ms);
  });

  it('downloadRemoteStateForDiagnostics needs a signed-in user', async () => {
    expect(await build().orchestrator.downloadRemoteStateForDiagnostics()).toEqual({
      ok: false,
      error: 'not signed in',
      ms: 0,
    });
  });

  it('downloadRemoteStateForDiagnostics needs an active workspace', async () => {
    const h = build({ activeWorkspaceId: null });
    await h.signIn();

    expect(await h.orchestrator.downloadRemoteStateForDiagnostics()).toEqual({
      ok: false,
      error: 'no active workspace',
      ms: 0,
    });
  });

  it('repairUploadMissing needs a signed-in user', async () => {
    expect(await build().orchestrator.repairUploadMissing()).toEqual({ ok: false, error: 'not signed in', ms: 0 });
  });

  it('repairUploadMissing needs an active workspace', async () => {
    const h = build({ activeWorkspaceId: null });
    await h.signIn();

    expect(await h.orchestrator.repairUploadMissing()).toEqual({ ok: false, error: 'no active workspace', ms: 0 });
  });

  it('repairUploadMissing runs against the active workspace on the live doc', async () => {
    const connectArgs: Array<{ workspaceId: string; opts: Record<string, unknown> }> = [];
    const h = build();
    await h.signIn();
    h.backend.connect = (_doc, workspaceId, opts) => {
      connectArgs.push({ workspaceId, opts: { ...opts } });
      return syncedConnection();
    };

    // The scripted cloud is empty and the live doc holds one edit: the
    // repair finds the cloud behind and uploads it (the scripted
    // connection never acks, so the upload itself times out).
    h.doc.getMap('library').set('b1', 1);
    const r = await h.orchestrator.repairUploadMissing(50);

    expect(r).toEqual({ ok: false, error: 'Error: Repair upload timed out after 50ms', ms: expect.any(Number) });
    elapsedMs(r.ms);
    expect(connectArgs).toEqual([{ workspaceId: 'ws_1', opts: DIAGNOSTIC_CONNECT }]);
    expect(h.orchestrator.getDiagnostics()).toMatchObject({ status: 'connected' });
  });

  it('repairUploadMissing reports the uploaded repair when the temp connection acks it', async () => {
    const h = build();
    await h.signIn();
    h.doc.getMap('library').set('b1', 1);
    let savedCb: ((at: number) => void) | null = null;
    h.backend.connect = (tempDoc) => {
      tempDoc.on('update', (_u: Uint8Array, origin: unknown) => {
        if (origin !== 'cloud') setTimeout(() => savedCb?.(Date.now()), 0);
      });
      return {
        on: (event, cb) => {
          if (event === 'synced') setTimeout(() => (cb as () => void)(), 0);
          if (event === 'saved') savedCb = cb as (at: number) => void;
        },
        off: () => undefined,
        destroy: () => undefined,
      };
    };

    const r = await h.orchestrator.repairUploadMissing(1000);

    expect(r).toEqual({
      ok: true,
      uploaded: true,
      bytes: expect.any(Number),
      clientsBehind: [{ client: h.doc.clientID, cloud: 0, local: 1 }],
      cloudPendingBefore: null,
      cloudPendingAfter: null,
      ms: expect.any(Number),
    });
    expect((r as { bytes: number }).bytes).toBeGreaterThan(0);
  });
});

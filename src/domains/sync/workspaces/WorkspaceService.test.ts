/**
 * `WorkspaceService` unit suite — the create/delete/purge flows and the
 * switch path's option plumbing, commit ordering and abort cleanup.
 *
 * Complements stagedSwap.test.ts, which owns the crash/resume failure
 * table (§D4 rows 1-4) with real IndexedDB. This file pins the parts that
 * table does not reach: what the service actually TELLS the rest of the
 * system — the connect options it derives, the events it emits, the
 * operator-facing log lines that record a purge's counts and whether the
 * active tie was severed, and the exact call ordering of the honest delete
 * (P4-6: tombstone → purge → conditional sever).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { WorkspaceDeletedError } from '~types/errors';
import type { WorkspaceMetadata } from '~types/workspace';
import {
  readSnapshot,
  deleteYjsDatabase,
  YJS_STAGING_DB_NAME,
} from '@data/snapshot/YjsSnapshotService';
import type { SyncBackend, SyncConnection } from '../backend/SyncBackend';
import type { SyncEvent } from '../events';
import { WorkspaceService, type WorkspaceServiceDeps } from './WorkspaceService';

const SCHEMA_VERSION = 6;

/** A real update carrying `meta.schemaVersion` — what the §D4 verify reads. */
const buildUpdate = (schemaVersion: number, probe = 'payload'): Uint8Array => {
  const doc = new Y.Doc();
  doc.getMap('meta').set('schemaVersion', schemaVersion);
  doc.getMap('library').set('probe', probe);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
};

interface Harness {
  service: WorkspaceService;
  events: SyncEvent[];
  calls: string[];
  logs: string[];
  errorLogs: unknown[][];
  activeWorkspaceId: () => string | null;
  setActive: (id: string | null) => void;
  connectOptions: () => Array<Record<string, unknown>>;
}

const makeHarness = (overrides: Partial<WorkspaceServiceDeps> = {}): Harness => {
  const events: SyncEvent[] = [];
  const calls: string[] = [];
  const logs: string[] = [];
  const errorLogs: unknown[][] = [];
  let active: string | null = 'ws_before';

  vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errorLogs.push(args);
  });

  const service = new WorkspaceService({
    events: {
      emit: (e) => {
        events.push(e);
      },
      on: () => () => undefined,
    },
    syncState: {
      getActiveWorkspaceId: () => active,
      setActiveWorkspaceId: (id) => {
        calls.push(`setActiveWorkspaceId:${id}`);
        active = id;
      },
      setFirebaseEnabled: () => undefined,
    },
    checkpoints: {
      createCheckpoint: async (trigger, options) => {
        calls.push(`createCheckpoint:${trigger}:${options?.protected === true}`);
        return 7;
      },
      createAutomaticCheckpoint: async () => null,
    },
    migrationState: {
      setStaged: (...args) => {
        calls.push(`setStaged:${args.join(',')}`);
      },
      setAwaitingConfirmation: () => calls.push('setAwaitingConfirmation'),
      setRestoringBackup: () => calls.push('setRestoringBackup'),
      clear: () => calls.push('clear'),
    },
    currentSchemaVersion: SCHEMA_VERSION,
    onObsolete: (v) => calls.push(`onObsolete:${v}`),
    debounceOverrideMs: () => 0,
    maxUpdatesThreshold: () => 50,
    disconnect: () => calls.push('disconnect'),
    reconnect: async (uid) => {
      calls.push(`reconnect:${uid}`);
    },
    ...overrides,
  });

  return {
    service,
    events,
    calls,
    logs,
    errorLogs,
    activeWorkspaceId: () => active,
    setActive: (id) => {
      active = id;
    },
    connectOptions: () => connectOptionsSeen,
  };
};

let connectOptionsSeen: Array<Record<string, unknown>> = [];

/** A connection that reports `synced` on the next macrotask. */
const syncingConnection = (): SyncConnection => ({
  on: (event, cb) => {
    if (event === 'synced') setTimeout(() => (cb as () => void)(), 0);
  },
  off: () => undefined,
  destroy: () => undefined,
});

const makeBackend = (overrides: Partial<SyncBackend> = {}): SyncBackend => ({
  uid: 'unit-uid',
  createWorkspace: async () => undefined,
  listWorkspaces: async () => [],
  updateWorkspaceMetadata: async () => undefined,
  isWorkspaceAlive: async () => true,
  probeHasData: async () => false,
  tombstoneWorkspace: async () => undefined,
  purgeWorkspace: async () => ({ docsDeleted: 0, blobsDeleted: 0 }),
  headArtifact: async () => null,
  putArtifact: async () => undefined,
  getArtifact: async () => null,
  deleteArtifactHead: async () => undefined,
  sweepArtifacts: async () => ({ headsDeleted: 0, blobsDeleted: 0 }),
  connect: (doc, _workspaceId, options) => {
    connectOptionsSeen.push({ ...(options as unknown as Record<string, unknown>) });
    Y.applyUpdate(doc, buildUpdate(SCHEMA_VERSION));
    return syncingConnection();
  },
  ...overrides,
});

const reloadSpy = vi.fn();

beforeEach(async () => {
  connectOptionsSeen = [];
  reloadSpy.mockReset();
  vi.stubGlobal('location', { ...window.location, reload: reloadSpy });
  await deleteYjsDatabase({ dbName: YJS_STAGING_DB_NAME });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.__VERSICLE_SWAP_PAUSE__;
});

describe('WorkspaceService.create', () => {
  it('mints a `ws`-namespaced id, writes the metadata, flips the active id, then cycles the connection', async () => {
    const written: WorkspaceMetadata[] = [];
    const h = makeHarness();
    const backend = makeBackend({
      createWorkspace: async (meta) => {
        written.push(meta);
      },
    });

    const id = await h.service.create(backend, 'uid-42', 'My Library');

    expect(id).toMatch(/^ws_/);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      workspaceId: id,
      name: 'My Library',
      schemaVersion: SCHEMA_VERSION,
    });
    expect(written[0].createdAt).toBeGreaterThan(0);
    // The id flip precedes the connection cycle: reconnect must resolve the
    // NEW workspace path, not the one being left behind.
    expect(h.calls).toEqual([
      `setActiveWorkspaceId:${id}`,
      'disconnect',
      'reconnect:uid-42',
    ]);
    expect(h.activeWorkspaceId()).toBe(id);
  });

  it('logs the created workspace under the service namespace, by name and id', async () => {
    const h = makeHarness();

    const id = await h.service.create(makeBackend(), 'uid-42', 'Reading List');

    expect(h.logs.some((l) => l.includes('[WorkspaceService]'))).toBe(true);
    expect(h.logs.some((l) => l.includes('Created workspace: Reading List') && l.includes(id))).toBe(
      true
    );
  });

  it('propagates a backend write failure without touching the active id or the connection', async () => {
    const h = makeHarness();
    const backend = makeBackend({
      createWorkspace: async () => {
        throw new Error('quota exceeded');
      },
    });

    await expect(h.service.create(backend, 'uid-42', 'Doomed')).rejects.toThrow('quota exceeded');
    expect(h.calls).toEqual([]);
    expect(h.activeWorkspaceId()).toBe('ws_before');
  });
});

describe('WorkspaceService.switch — provider option plumbing', () => {
  it('falls back to a 2000ms provider debounce when no test override is armed', async () => {
    const h = makeHarness({ debounceOverrideMs: () => 0, maxUpdatesThreshold: () => 50 });

    await h.service.switch(makeBackend(), 'ws_target');

    expect(h.connectOptions()).toEqual([{ maxWaitTimeMs: 2000, maxUpdatesThreshold: 50 }]);
  });

  it('passes a non-zero debounce override straight through to the temp provider', async () => {
    const h = makeHarness({ debounceOverrideMs: () => 5, maxUpdatesThreshold: () => 3 });

    await h.service.switch(makeBackend(), 'ws_target');

    expect(h.connectOptions()).toEqual([{ maxWaitTimeMs: 5, maxUpdatesThreshold: 3 }]);
  });
});

describe('WorkspaceService.switch — pre-flight', () => {
  it('is a silent no-op when the target is already active: no backend read, no event', async () => {
    const h = makeHarness();
    const backend = makeBackend({
      isWorkspaceAlive: async () => {
        throw new Error('pre-flight must not run');
      },
    });

    await h.service.switch(backend, 'ws_before');

    expect(h.events).toEqual([]);
    expect(h.calls).toEqual([]);
    expect(h.logs.some((l) => l.includes('Already on the target workspace'))).toBe(true);
  });

  it('logs the transition with both the outgoing and incoming ids', async () => {
    const h = makeHarness();

    await h.service.switch(makeBackend(), 'ws_target');

    expect(
      h.logs.some((l) => l.includes('Switching workspace') && l.includes('ws_before') && l.includes('ws_target'))
    ).toBe(true);
  });

  it('rejects a tombstoned target with the `switch` context, before any checkpoint', async () => {
    const h = makeHarness();
    const backend = makeBackend({ isWorkspaceAlive: async () => false });

    await expect(h.service.switch(backend, 'ws_dead')).rejects.toBeInstanceOf(WorkspaceDeletedError);

    expect(h.events).toEqual([
      { type: 'workspace-tombstoned', workspaceId: 'ws_dead', context: 'switch' },
    ]);
    // Pre-flight precedes the try block, so the abort path never runs either.
    expect(h.calls).toEqual([]);
  });

  it('pins a PROTECTED pre-migration checkpoint and logs its id before downloading', async () => {
    const h = makeHarness();

    await h.service.switch(makeBackend(), 'ws_target');

    expect(h.calls[0]).toBe('createCheckpoint:pre-migration:true');
    expect(h.logs.some((l) => l.includes('Creating pre-migration checkpoint'))).toBe(true);
    expect(h.logs.some((l) => l.includes('Pre-migration checkpoint created: #7'))).toBe(true);
    expect(h.logs.some((l) => l.includes('Downloading remote workspace state'))).toBe(true);
  });
});

describe('WorkspaceService.switch — the schema gate (quarantine layer 1)', () => {
  it('admits a target at EXACTLY the supported version', async () => {
    const h = makeHarness();
    const backend = makeBackend({
      connect: (doc) => {
        Y.applyUpdate(doc, buildUpdate(SCHEMA_VERSION));
        return syncingConnection();
      },
    });

    await h.service.switch(backend, 'ws_target');

    expect(h.calls).toContain('setStaged:ws_target,7,ws_before');
    expect(h.calls).not.toContain(`onObsolete:${SCHEMA_VERSION}`);
  });

  it('aborts non-destructively on a version from the future, after notifying the app', async () => {
    const h = makeHarness();
    const backend = makeBackend({
      connect: (doc) => {
        Y.applyUpdate(doc, buildUpdate(SCHEMA_VERSION + 1));
        return syncingConnection();
      },
    });

    await expect(h.service.switch(backend, 'ws_target')).rejects.toThrow(/requires schema v7/);

    expect(h.calls).toContain('onObsolete:7');
    expect(h.calls).not.toContain('setStaged:ws_target,7,ws_before');
    expect(h.activeWorkspaceId()).toBe('ws_before');
    await expect(readSnapshot({ dbName: YJS_STAGING_DB_NAME })).resolves.toBeNull();
  });
});

describe('WorkspaceService.switch — commit and abort', () => {
  it('reloads the page once the staged commit lands', async () => {
    const h = makeHarness();

    await h.service.switch(makeBackend(), 'ws_target');

    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it("parks at the armed 'swap:staged' point instead of reloading (the kill-mid-switch harness)", async () => {
    window.__VERSICLE_SWAP_PAUSE__ = 'swap:staged';
    const h = makeHarness();

    const settled = await Promise.race([
      h.service.switch(makeBackend(), 'ws_target').then(() => 'resolved'),
      new Promise((r) => setTimeout(() => r('still-parked'), 30)),
    ]);

    expect(settled).toBe('still-parked');
    // The commit itself already happened — only the reload is withheld.
    expect(h.calls).toContain('setStaged:ws_target,7,ws_before');
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('a POST-commit failure rewinds the active id to where the user was', async () => {
    const h = makeHarness();
    reloadSpy.mockImplementation(() => {
      throw new Error('reload blocked');
    });

    await expect(h.service.switch(makeBackend(), 'ws_target')).rejects.toThrow('reload blocked');

    // The id was flipped forward at the commit, so the rewind is observable.
    expect(h.calls).toEqual([
      'createCheckpoint:pre-migration:true',
      'setStaged:ws_target,7,ws_before',
      'setActiveWorkspaceId:ws_target',
      'clear',
      'setActiveWorkspaceId:ws_before',
    ]);
    expect(h.activeWorkspaceId()).toBe('ws_before');
    expect(h.events.at(-1)).toEqual({ type: 'switch', phase: 'failed-aborted' });
  });

  it('logs the failure with the underlying error attached', async () => {
    const h = makeHarness();
    const boom = new Error('network down');
    const backend = makeBackend({
      connect: () => {
        throw boom;
      },
    });

    await expect(h.service.switch(backend, 'ws_target')).rejects.toThrow('network down');

    expect(
      h.errorLogs.some(
        (args) => args.some((a) => String(a).includes('Workspace switch failed')) && args.includes(boom)
      )
    ).toBe(true);
  });
});

describe('WorkspaceService.list', () => {
  it('delegates straight to the backend (tombstone filtering is the backend contract)', async () => {
    const h = makeHarness();
    const rows: WorkspaceMetadata[] = [
      { workspaceId: 'ws_a', name: 'A', createdAt: 1, schemaVersion: SCHEMA_VERSION },
    ];

    await expect(h.service.list(makeBackend({ listWorkspaces: async () => rows }))).resolves.toBe(
      rows
    );
  });
});

describe('WorkspaceService.delete — the honest delete (P4-6)', () => {
  const spyBackend = (order: string[]): SyncBackend =>
    makeBackend({
      tombstoneWorkspace: async (id) => {
        order.push(`tombstone:${id}`);
      },
      purgeWorkspace: async (id) => {
        order.push(`purge:${id}`);
        return { docsDeleted: 12, blobsDeleted: 4 };
      },
    });

  it('severs the live attachment FIRST when deleting the active workspace, then tombstones, purges and clears the tie', async () => {
    const order: string[] = [];
    const h = makeHarness();

    await h.service.delete(spyBackend(order), 'ws_before');

    expect(order).toEqual(['tombstone:ws_before', 'purge:ws_before']);
    expect(h.calls).toEqual(['disconnect', 'setActiveWorkspaceId:null']);
    expect(h.activeWorkspaceId()).toBeNull();
    expect(h.events).toEqual([
      { type: 'workspace-purged', report: { docsDeleted: 12, blobsDeleted: 4 } },
    ]);
  });

  it('leaves the live connection and the active id ALONE when deleting a non-active workspace', async () => {
    const order: string[] = [];
    const h = makeHarness();

    await h.service.delete(spyBackend(order), 'ws_other');

    expect(order).toEqual(['tombstone:ws_other', 'purge:ws_other']);
    expect(h.calls).toEqual([]);
    expect(h.activeWorkspaceId()).toBe('ws_before');
  });

  it('records the purge counts and a SEVERED tie in the operator log', async () => {
    const h = makeHarness();

    await h.service.delete(spyBackend([]), 'ws_before');

    const line = h.logs.find((l) => l.includes('Workspace deleted: ws_before'));
    expect(line).toBeDefined();
    expect(line).toContain('purged 12 docs');
    expect(line).toContain('4 blobs');
    expect(line).toContain('active tie severed');
  });

  it('records a KEPT tie when the deleted workspace was not the active one', async () => {
    const h = makeHarness();

    await h.service.delete(spyBackend([]), 'ws_other');

    const line = h.logs.find((l) => l.includes('Workspace deleted: ws_other'));
    expect(line).toContain('active tie kept');
    expect(line).not.toContain('severed');
  });

  it('does not sever the tie when the tombstone write fails', async () => {
    const h = makeHarness();
    const backend = makeBackend({
      tombstoneWorkspace: async () => {
        throw new Error('denied');
      },
    });

    await expect(h.service.delete(backend, 'ws_before')).rejects.toThrow('denied');
    // disconnect already ran (it precedes the tombstone), but the id survives
    // so a retry still knows which workspace was active.
    expect(h.calls).toEqual(['disconnect']);
    expect(h.activeWorkspaceId()).toBe('ws_before');
  });
});

describe('WorkspaceService.purgeDeleted — the maintenance sweep', () => {
  const directory: WorkspaceMetadata[] = [
    { workspaceId: 'ws_live', name: 'Live', createdAt: 1, schemaVersion: SCHEMA_VERSION },
    { workspaceId: 'ws_gone1', name: 'Gone 1', createdAt: 2, schemaVersion: SCHEMA_VERSION, deletedAt: 10 },
    { workspaceId: 'ws_gone2', name: 'Gone 2', createdAt: 3, schemaVersion: SCHEMA_VERSION, deletedAt: 20 },
  ];

  const sweepBackend = (order: string[]): SyncBackend =>
    makeBackend({
      listWorkspaces: async (opts) => {
        order.push(`list:${opts?.includeDeleted === true}`);
        return directory;
      },
      tombstoneWorkspace: async (id) => {
        order.push(`tombstone:${id}`);
      },
      purgeWorkspace: async (id) => {
        order.push(`purge:${id}`);
        return id === 'ws_gone1'
          ? { docsDeleted: 3, blobsDeleted: 5 }
          : { docsDeleted: 7, blobsDeleted: 11 };
      },
    });

  it('walks the FULL directory, re-asserts each tombstone, and purges only the deleted entries', async () => {
    const order: string[] = [];
    const h = makeHarness();

    await h.service.purgeDeleted(sweepBackend(order));

    expect(order).toEqual([
      'list:true',
      'tombstone:ws_gone1',
      'purge:ws_gone1',
      'tombstone:ws_gone2',
      'purge:ws_gone2',
    ]);
  });

  it('ACCUMULATES both counters across every purged workspace', async () => {
    const h = makeHarness();

    const total = await h.service.purgeDeleted(sweepBackend([]));

    expect(total).toEqual({ docsDeleted: 10, blobsDeleted: 16 });
  });

  it('emits exactly one workspace-purged event carrying the accumulated report', async () => {
    const h = makeHarness();

    const total = await h.service.purgeDeleted(sweepBackend([]));

    expect(h.events).toEqual([
      { type: 'workspace-purged', report: { docsDeleted: 10, blobsDeleted: 16 } },
    ]);
    expect((h.events[0] as { report: unknown }).report).toBe(total);
  });

  it('logs how many workspaces were swept and the totals', async () => {
    const h = makeHarness();

    await h.service.purgeDeleted(sweepBackend([]));

    const line = h.logs.find((l) => l.includes('deleted workspace(s)'));
    expect(line).toBeDefined();
    expect(line).toContain('Purged 2 deleted workspace(s)');
    expect(line).toContain('10 docs');
    expect(line).toContain('16 blobs');
  });

  it('is a zero-report no-op when nothing is tombstoned — but still announces itself', async () => {
    const h = makeHarness();
    const backend = makeBackend({
      listWorkspaces: async () => [directory[0]],
      purgeWorkspace: async () => {
        throw new Error('must not purge a live workspace');
      },
    });

    await expect(h.service.purgeDeleted(backend)).resolves.toEqual({
      docsDeleted: 0,
      blobsDeleted: 0,
    });
    expect(h.events).toEqual([
      { type: 'workspace-purged', report: { docsDeleted: 0, blobsDeleted: 0 } },
    ]);
    expect(h.logs.some((l) => l.includes('Purged 0 deleted workspace(s)'))).toBe(true);
  });
});

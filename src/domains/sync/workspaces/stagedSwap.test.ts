/**
 * Staged-swap crash-resume suite (phase4-sync-strangler.md §D4) — the
 * vitest half of the kill-mid-switch acceptance gate (the Playwright
 * journey is verification/test_journey_kill_mid_switch.spec.ts).
 *
 * Strategy: a crash leaves only (a) the localStorage state machine and
 * (b) the IndexedDB databases in some intermediate combination — so every
 * "kill between stage X and Y" is constructed literally as that storage
 * state against real fake-indexeddb + real localStorage, then the resume
 * path (`applyStagedSwap`, exactly what the boot interceptor's STAGED arm
 * runs) is executed and the failure-table row asserted. Idempotence is
 * proven by re-running the apply from every intermediate state.
 *
 * Failure table (§D4):
 *  row 1  crash during download/verify/stage → no state machine → old
 *         workspace boots untouched
 *  row 2  crash after STAGED, before/during apply → apply re-runs from
 *         staging; switch completes
 *  row 3  crash after apply, before confirm → AWAITING_CONFIRMATION (P0)
 *  row 4  rollback / apply throws → RESTORING_BACKUP (P0; pinned in
 *         CheckpointService.test.ts boot-path block)
 *
 * Also carries the assertions absorbed from the deleted
 * CheckpointService.applyRemoteState (test-absorption ledger, rule 8):
 * durable byte-identical write and validate-before-destroy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import {
  applySnapshot,
  readSnapshot,
  deleteYjsDatabase,
  YJS_DB_NAME,
  YJS_STAGING_DB_NAME,
} from '@data/snapshot/YjsSnapshotService';
import type { SyncMigrationState } from '~types/workspace';
import type { SyncBackend, SyncConnection } from '../backend/SyncBackend';
import type { SyncEvent } from '../events';
import { MigrationStateService } from './MigrationStateService';
import { WorkspaceService } from './WorkspaceService';
import {
  applyStagedSwap,
  stageWorkspaceState,
  clearStagedState,
  withSwapLock,
} from './stagedSwap';

let clientCounter = 0;

/** Build a deterministic doc update carrying a probe value. */
function buildUpdate(probe: string): Uint8Array {
  const doc = new Y.Doc();
  doc.clientID = 1000 + ++clientCounter;
  doc.getMap('library').set('probe', probe);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

async function readProbe(dbName: string): Promise<string | undefined> {
  const blob = await readSnapshot({ dbName });
  if (!blob) return undefined;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, blob);
  const probe = doc.getMap('library').get('probe') as string | undefined;
  doc.destroy();
  return probe;
}

const STAGED_STATE: SyncMigrationState = {
  status: 'STAGED',
  targetWorkspaceId: 'ws_target',
  backupCheckpointId: 7,
  previousWorkspaceId: 'ws_before',
};

describe('stagedSwap — crash-resume state table (§D4)', () => {
  let setActiveWorkspaceId: ReturnType<typeof vi.fn<(id: string) => void>>;
  const hooks = () => ({ setActiveWorkspaceId });

  beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setActiveWorkspaceId = vi.fn<(id: string) => void>();
    MigrationStateService.clear();
    await deleteYjsDatabase({ dbName: YJS_DB_NAME });
    await deleteYjsDatabase({ dbName: YJS_STAGING_DB_NAME });
  });

  afterEach(() => {
    MigrationStateService.clear();
    delete window.__VERSICLE_SWAP_PAUSE__;
    vi.restoreAllMocks();
  });

  describe('row 2 — STAGED survives every apply-side crash; re-apply completes', () => {
    /** The canonical post-commit crash state: STAGED + staged blob present. */
    const seedStagedCrash = async (mainProbe?: string) => {
      if (mainProbe) await applySnapshot(buildUpdate(mainProbe));
      await stageWorkspaceState(buildUpdate('target-data'));
      MigrationStateService.setState(STAGED_STATE);
    };

    const expectApplied = async () => {
      // Main IDB now holds the staged target state, durably.
      expect(await readProbe(YJS_DB_NAME)).toBe('target-data');
      // The id was reconciled (a kill between setStaged and the switch
      // path's own flip must not strand the previous id).
      expect(setActiveWorkspaceId).toHaveBeenCalledWith('ws_target');
      // Handover to the P0 state machine, previousWorkspaceId preserved
      // for a later rollback.
      expect(MigrationStateService.getState()).toEqual({
        status: 'AWAITING_CONFIRMATION',
        targetWorkspaceId: 'ws_target',
        backupCheckpointId: 7,
        previousWorkspaceId: 'ws_before',
      });
      // Staging stays intact until the user finalizes (re-runnability).
      expect(await readProbe(YJS_STAGING_DB_NAME)).toBe('target-data');
    };

    it('kill right after the STAGED commit (before any apply): apply completes the switch', async () => {
      await seedStagedCrash('old-data');
      await applyStagedSwap(MigrationStateService.getState()!, hooks());
      await expectApplied();
    });

    it('kill mid-apply AFTER the main wipe (main DB missing): re-apply completes', async () => {
      await seedStagedCrash('old-data');
      // Crash row: the apply wiped main and died before the rewrite.
      await deleteYjsDatabase({ dbName: YJS_DB_NAME });
      await applyStagedSwap(MigrationStateService.getState()!, hooks());
      await expectApplied();
    });

    it('kill AFTER the rewrite, before the state transition: re-apply is idempotent', async () => {
      await seedStagedCrash('old-data');
      // Crash row: main already holds the target state, still STAGED.
      await deleteYjsDatabase({ dbName: YJS_DB_NAME });
      await applySnapshot(buildUpdate('target-data'));
      await applyStagedSwap(MigrationStateService.getState()!, hooks());
      await expectApplied();
    });

    it('regression: the staged blob lands byte-identical in main (absorbed from applyRemoteState)', async () => {
      const blob = buildUpdate('byte-identical');
      await stageWorkspaceState(blob);
      MigrationStateService.setState(STAGED_STATE);

      await applyStagedSwap(MigrationStateService.getState()!, hooks());

      const written = await readSnapshot({ dbName: YJS_DB_NAME });
      expect(written).not.toBeNull();
      expect(Array.from(written!)).toEqual(Array.from(blob));
    });
  });

  describe('apply failure rows — nothing destroyed, state machine resolvable', () => {
    it('missing staging database: throws BEFORE the main wipe; STAGED state untouched', async () => {
      await applySnapshot(buildUpdate('old-data'));
      MigrationStateService.setState(STAGED_STATE);
      // No staging DB (e.g. a user cleared site data between commit and boot).

      await expect(
        applyStagedSwap(MigrationStateService.getState()!, hooks())
      ).rejects.toThrow(/Staged workspace state is missing/);

      // Validate-before-destroy: main IDB was never wiped.
      expect(await readProbe(YJS_DB_NAME)).toBe('old-data');
      // The caller (interceptor) decides the RESTORING_BACKUP routing — the
      // apply itself must not silently clear the state machine.
      expect(MigrationStateService.getState()?.status).toBe('STAGED');
      expect(setActiveWorkspaceId).not.toHaveBeenCalled();
    });

    it('regression: a corrupted staged blob rejects before anything destructive (absorbed from applyRemoteState)', async () => {
      await applySnapshot(buildUpdate('old-data'));
      // Plant garbage as the staging "snapshot" (bypass stageWorkspaceState,
      // which validates).
      await applySnapshot(buildUpdate('placeholder'), { dbName: YJS_STAGING_DB_NAME });
      const { writeSnapshot } = await import('y-idb');
      await writeSnapshot(
        YJS_STAGING_DB_NAME,
        new TextEncoder().encode('garbage, not a yjs update')
      );
      MigrationStateService.setState(STAGED_STATE);

      await expect(
        applyStagedSwap(MigrationStateService.getState()!, hooks())
      ).rejects.toMatchObject({ code: 'BACKUP_SNAPSHOT_INVALID' });

      expect(await readProbe(YJS_DB_NAME)).toBe('old-data');
      expect(MigrationStateService.getState()?.status).toBe('STAGED');
    });

    it('rejects a non-STAGED state and incomplete STAGED states', async () => {
      await expect(
        applyStagedSwap(
          { status: 'AWAITING_CONFIRMATION', targetWorkspaceId: 'x', backupCheckpointId: 1 },
          hooks()
        )
      ).rejects.toThrow(/expected STAGED/);
      await expect(
        applyStagedSwap({ status: 'STAGED', targetWorkspaceId: 'x' }, hooks())
      ).rejects.toThrow(/missing targetWorkspaceId\/backupCheckpointId/);
    });
  });

  describe('staging hygiene', () => {
    it('stageWorkspaceState clears junk left by an abandoned earlier switch', async () => {
      await stageWorkspaceState(buildUpdate('abandoned-junk'));
      await stageWorkspaceState(buildUpdate('fresh-stage'));
      expect(await readProbe(YJS_STAGING_DB_NAME)).toBe('fresh-stage');
      const blob = await readSnapshot({ dbName: YJS_STAGING_DB_NAME });
      // Exactly one snapshot row's worth of state — not a merge with junk.
      const doc = new Y.Doc();
      Y.applyUpdate(doc, blob!);
      expect(doc.getMap('library').size).toBe(1);
      doc.destroy();
    });

    it('clearStagedState drops the staging database (finalize path)', async () => {
      await stageWorkspaceState(buildUpdate('to-be-cleared'));
      await clearStagedState();
      await expect(readSnapshot({ dbName: YJS_STAGING_DB_NAME })).resolves.toBeNull();
    });
  });

});

describe('stagedSwap — withSwapLock serialization (fallback chain)', () => {
  it('serializes two applies issued concurrently (no interleaving)', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const first = withSwapLock(async () => {
      order.push('first:start');
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push('first:end');
    });
    const second = withSwapLock(async () => {
      order.push('second:start');
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(['first:start']);
    releaseFirst();
    await first;
    await second;
    expect(order).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('a rejected holder does not wedge the queue', async () => {
    const failing = withSwapLock(async () => {
      throw new Error('boom');
    });
    await expect(failing).rejects.toThrow('boom');
    await expect(withSwapLock(async () => 'after')).resolves.toBe('after');
  });
});

describe('WorkspaceService.switch — pre-commit crash/abort rows (row 1)', () => {
  const UID_BACKEND = 'unit-backend';

  let events: SyncEvent[];
  let activeWorkspaceId: string | null;
  let migrationCalls: string[];

  const makeService = () => {
    events = [];
    activeWorkspaceId = 'ws_before';
    migrationCalls = [];
    return new WorkspaceService({
      events: {
        emit: (e) => {
          events.push(e);
        },
        on: () => () => undefined,
      },
      syncState: {
        getActiveWorkspaceId: () => activeWorkspaceId,
        setActiveWorkspaceId: (id) => {
          activeWorkspaceId = id;
        },
        setFirebaseEnabled: () => undefined,
      },
      checkpoints: {
        createCheckpoint: async () => 7,
        createAutomaticCheckpoint: async () => null,
      },
      migrationState: {
        setStaged: (...args) => {
          migrationCalls.push(`setStaged:${args.join(',')}`);
        },
        setAwaitingConfirmation: () => {
          migrationCalls.push('setAwaitingConfirmation');
        },
        setRestoringBackup: () => {
          migrationCalls.push('setRestoringBackup');
        },
        clear: () => {
          migrationCalls.push('clear');
        },
      },
      currentSchemaVersion: 6,
      onObsolete: () => undefined,
      debounceOverrideMs: () => 5,
      maxUpdatesThreshold: () => 50,
      disconnect: () => undefined,
      reconnect: async () => undefined,
      stopAll: () => undefined,
    });
  };

  const baseBackend = (overrides: Partial<SyncBackend>): SyncBackend => ({
    uid: UID_BACKEND,
    legacyDeleteBehavior: {
      destroyConnectionFirst: false,
      severActiveUnconditionally: false,
    },
    createWorkspace: async () => undefined,
    listWorkspaces: async () => [],
    updateWorkspaceMetadata: async () => undefined,
    isWorkspaceAlive: async () => true,
    probeHasData: async () => false,
    deleteWorkspace: async () => undefined,
    connect: () => {
      throw new Error('connect not stubbed');
    },
    ...overrides,
  });

  beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await deleteYjsDatabase({ dbName: YJS_STAGING_DB_NAME });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a download crash (connect throws) aborts with ZERO residue: no state machine, no id flip, nothing staged', async () => {
    const backend = baseBackend({
      connect: () => {
        throw new Error('network down');
      },
    });
    const service = makeService();

    await expect(service.switch(backend, 'ws_target')).rejects.toThrow('network down');

    expect(activeWorkspaceId).toBe('ws_before');
    expect(migrationCalls).toEqual(['clear']); // pure cleanup, never engaged
    expect(events.some((e) => e.type === 'switch' && e.phase === 'failed-aborted')).toBe(true);
    await expect(readSnapshot({ dbName: YJS_STAGING_DB_NAME })).resolves.toBeNull();
  });

  it('the happy path stages durably and commits in §D4 order: verify → stage → setStaged → id flip', async () => {
    const targetUpdate = buildUpdate('switch-target');
    const connection: SyncConnection = {
      on: (event, cb) => {
        if (event === 'synced') setTimeout(() => (cb as () => void)(), 1);
      },
      off: () => undefined,
      destroy: () => undefined,
    };
    const backend = baseBackend({
      connect: (doc) => {
        Y.applyUpdate(doc, targetUpdate);
        return connection;
      },
    });
    const service = makeService();

    await service.switch(backend, 'ws_target');

    // Commit recorded with the §D4 payload (target, backup, previous).
    expect(migrationCalls).toEqual(['setStaged:ws_target,7,ws_before']);
    expect(activeWorkspaceId).toBe('ws_target');
    expect(await readProbe(YJS_STAGING_DB_NAME)).toBe('switch-target');
    const phases = events.filter((e) => e.type === 'switch').map((e) => (e as { phase: string }).phase);
    expect(phases).toEqual(['downloading', 'verifying', 'staged']);
  });
});

/**
 * LAST in the file on purpose: a parked apply holds the (fallback) swap
 * lock for the rest of the worker — page death is the only exit in
 * production, so every other lock user in this file must already have run.
 */
describe('stagedSwap — kill-point determinism (the §D8 pause hooks)', () => {
  beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    MigrationStateService.clear();
    await deleteYjsDatabase({ dbName: YJS_DB_NAME });
    await deleteYjsDatabase({ dbName: YJS_STAGING_DB_NAME });
  });

  afterEach(() => {
    MigrationStateService.clear();
    delete window.__VERSICLE_SWAP_PAUSE__;
    vi.restoreAllMocks();
  });

  it("an armed 'swap:before-apply' parks the apply: state stays STAGED, main untouched", async () => {
    await applySnapshot(buildUpdate('old-data'));
    await stageWorkspaceState(buildUpdate('target-data'));
    MigrationStateService.setState(STAGED_STATE);
    window.__VERSICLE_SWAP_PAUSE__ = 'swap:before-apply';

    const outcome = await Promise.race([
      applyStagedSwap(MigrationStateService.getState()!, {
        setActiveWorkspaceId: () => undefined,
      }).then(() => 'completed'),
      new Promise<'parked'>((resolve) => setTimeout(() => resolve('parked'), 100)),
    ]);

    expect(outcome).toBe('parked');
    expect(MigrationStateService.getState()?.status).toBe('STAGED');
    expect(await readProbe(YJS_DB_NAME)).toBe('old-data');
  });
});

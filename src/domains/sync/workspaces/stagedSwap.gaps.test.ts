/**
 * `stagedSwap` — the cross-tab lock, the pause hooks and the apply's
 * preconditions.
 *
 * stagedSwap.test.ts pins the §D4 crash/resume failure table against real
 * storage. This covers the surrounding machinery: the Web Locks path (jsdom
 * has no `navigator.locks`, so the suite supplies one — the fallback chain
 * is what runs there, and only one of the two is ever exercised in a given
 * environment), the argument validation that routes a malformed STAGED
 * state to backup restore rather than into the destructive window, and the
 * belt-and-braces pauseSync hook.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SyncMigrationState } from '~types/workspace';
import { applyStagedSwap, pauseIfArmed, withSwapLock } from './stagedSwap';

let warnLogs: string[];

beforeEach(() => {
  warnLogs = [];
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
    warnLogs.push(a.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.__VERSICLE_SWAP_PAUSE__;
});

describe('withSwapLock — the Web Locks path', () => {
  /** jsdom has no LockManager; supply one so the primary path is reachable. */
  const stubLocks = () => {
    const requests: Array<{ name: string; options: unknown }> = [];
    vi.stubGlobal('navigator', {
      ...navigator,
      locks: {
        request: async (name: string, options: unknown, work: () => Promise<unknown>) => {
          requests.push({ name, options });
          return work();
        },
      },
    });
    return requests;
  };

  it('takes an EXCLUSIVE named lock and returns the work result', async () => {
    const requests = stubLocks();

    await expect(withSwapLock(async () => 'done')).resolves.toBe('done');

    expect(requests).toEqual([
      { name: 'versicle-yjs-swap', options: { mode: 'exclusive' } },
    ]);
  });

  it('propagates the work failure through the lock', async () => {
    stubLocks();

    await expect(
      withSwapLock(async () => {
        throw new Error('apply failed');
      })
    ).rejects.toThrow('apply failed');
  });

  it('uses the SAME lock name every time, so two tabs actually contend', async () => {
    const requests = stubLocks();

    await withSwapLock(async () => 1);
    await withSwapLock(async () => 2);

    expect(new Set(requests.map((r) => r.name)).size).toBe(1);
  });

  it('falls back to an in-process chain when the environment has no lock manager', async () => {
    vi.stubGlobal('navigator', { userAgent: 'test' });
    const order: string[] = [];

    const first = withSwapLock(async () => {
      order.push('first:start');
      await new Promise((r) => setTimeout(r, 5));
      order.push('first:end');
    });
    const second = withSwapLock(async () => {
      order.push('second');
    });
    await Promise.all([first, second]);

    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('the fallback chain survives a rejecting predecessor', async () => {
    vi.stubGlobal('navigator', { userAgent: 'test' });

    const failing = withSwapLock(async () => {
      throw new Error('boom');
    });
    await expect(failing).rejects.toThrow('boom');
    await expect(withSwapLock(async () => 'after')).resolves.toBe('after');
  });
});

describe('pauseIfArmed', () => {
  it('is inert when nothing is armed', async () => {
    await expect(pauseIfArmed('swap:staged')).resolves.toBeUndefined();
  });

  it('is inert for a DIFFERENT armed point', async () => {
    window.__VERSICLE_SWAP_PAUSE__ = 'swap:mid-apply';

    await expect(pauseIfArmed('swap:staged')).resolves.toBeUndefined();
  });

  it('parks forever at the armed point, naming it in the log', async () => {
    window.__VERSICLE_SWAP_PAUSE__ = 'swap:before-apply';

    const settled = await Promise.race([
      pauseIfArmed('swap:before-apply').then(() => 'resolved'),
      new Promise((r) => setTimeout(() => r('parked'), 20)),
    ]);

    expect(settled).toBe('parked');
    expect(warnLogs.some((l) => l.includes("Swap pause armed at 'swap:before-apply'"))).toBe(true);
    expect(warnLogs.some((l) => l.includes('kill-mid-switch harness'))).toBe(true);
  });
});

describe('applyStagedSwap — preconditions', () => {
  const hooks = { setActiveWorkspaceId: vi.fn() };

  it('refuses a state that is not STAGED, naming the status it got', async () => {
    await expect(
      applyStagedSwap({ status: 'AWAITING_CONFIRMATION' } as SyncMigrationState, hooks)
    ).rejects.toThrow("applyStagedSwap called with status 'AWAITING_CONFIRMATION' (expected STAGED)");
  });

  it('refuses a STAGED state with no target workspace', async () => {
    await expect(
      applyStagedSwap(
        { status: 'STAGED', backupCheckpointId: 3 } as SyncMigrationState,
        hooks
      )
    ).rejects.toThrow('STAGED state is missing targetWorkspaceId/backupCheckpointId');
  });

  it('refuses a STAGED state with no backup checkpoint', async () => {
    await expect(
      applyStagedSwap(
        { status: 'STAGED', targetWorkspaceId: 'ws_1' } as SyncMigrationState,
        hooks
      )
    ).rejects.toThrow('STAGED state is missing targetWorkspaceId/backupCheckpointId');
  });

  it('ACCEPTS checkpoint id zero — a falsy id is still an id', async () => {
    // It gets past validation and fails later, on the absent staging DB.
    await expect(
      applyStagedSwap(
        { status: 'STAGED', targetWorkspaceId: 'ws_1', backupCheckpointId: 0 } as SyncMigrationState,
        hooks
      )
    ).rejects.toThrow(/Staged workspace state is missing/);
  });

  it('rejects — before anything destructive — when staging is empty', async () => {
    const setActiveWorkspaceId = vi.fn();

    await expect(
      applyStagedSwap(
        { status: 'STAGED', targetWorkspaceId: 'ws_1', backupCheckpointId: 3 } as SyncMigrationState,
        { setActiveWorkspaceId }
      )
    ).rejects.toThrow('Routing to backup restore');

    expect(setActiveWorkspaceId).not.toHaveBeenCalled();
  });

  it('runs the pauseSync hook, and continues when it REJECTS', async () => {
    const pauseSync = vi.fn(async () => {
      throw new Error('orchestrator gone');
    });

    await expect(
      applyStagedSwap(
        { status: 'STAGED', targetWorkspaceId: 'ws_1', backupCheckpointId: 3 } as SyncMigrationState,
        { setActiveWorkspaceId: vi.fn(), pauseSync }
      )
      // It continues past the hook and fails on the absent staging DB.
    ).rejects.toThrow(/Staged workspace state is missing/);

    expect(pauseSync).toHaveBeenCalledTimes(1);
    expect(warnLogs.some((l) => l.includes('pauseSync failed during staged apply'))).toBe(true);
  });

  it('works with no pauseSync hook at all', async () => {
    await expect(
      applyStagedSwap(
        { status: 'STAGED', targetWorkspaceId: 'ws_1', backupCheckpointId: 3 } as SyncMigrationState,
        { setActiveWorkspaceId: vi.fn() }
      )
    ).rejects.toThrow(/Staged workspace state is missing/);

    expect(warnLogs.some((l) => l.includes('pauseSync failed'))).toBe(false);
  });
});

/**
 * `downloadWorkspaceState` unit suite — THE temp-doc hydration utility
 * (§D2). Its three resolution arms each carry semantics the callers depend
 * on, so each is pinned here directly rather than through the clean-sync /
 * switch flows that consume it:
 *
 *  - handshake lands  → resolve with the temp doc's full state
 *  - budget expires   → resolve with WHATEVER synced (an unreachable remote
 *                       reads as "empty", not as an error) unless
 *                       `onTimeout: 'reject'`
 *  - connect throws   → `onAttachError` decides: reject (switch) or resolve
 *                       with the current state (clean sync)
 *
 * and in every arm the temp provider and temp doc are destroyed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import type { ConnectOptions, SyncBackend, SyncConnection } from '../backend/SyncBackend';
import { downloadWorkspaceState } from './downloadWorkspaceState';

const seed = (doc: Y.Doc, value: string): void => {
  doc.getMap('library').set('probe', value);
};

const readProbe = (update: Uint8Array): unknown => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  const probe = doc.getMap('library').get('probe');
  doc.destroy();
  return probe;
};

interface Recorder {
  destroys: number;
  connectCalls: Array<{ workspaceId: string; options: ConnectOptions }>;
  /** The throwaway doc handed to the backend — must be destroyed on every arm. */
  tempDocs: Y.Doc[];
}

const makeBackend = (
  rec: Recorder,
  behavior: (doc: Y.Doc, emitSynced: () => void) => void,
  onDestroy?: () => void
): SyncBackend =>
  ({
    uid: 'unit',
    connect: (doc: Y.Doc, workspaceId: string, options: ConnectOptions): SyncConnection => {
      rec.connectCalls.push({ workspaceId, options });
      rec.tempDocs.push(doc);
      let syncedCb: (() => void) | null = null;
      behavior(doc, () => syncedCb?.());
      return {
        on: (event, cb) => {
          if (event === 'synced') syncedCb = cb as () => void;
        },
        off: () => undefined,
        destroy: () => {
          rec.destroys += 1;
          onDestroy?.();
        },
      };
    },
  }) as unknown as SyncBackend;

let rec: Recorder;
let warnLogs: string[];
let infoLogs: string[];
let errorLogs: unknown[][];

const SYNCED_LINE =
  '[downloadWorkspaceState] Received sync complete event from temp workspace provider.';

beforeEach(() => {
  rec = { destroys: 0, connectCalls: [], tempDocs: [] };
  warnLogs = [];
  infoLogs = [];
  errorLogs = [];
  vi.spyOn(console, 'info').mockImplementation((...a: unknown[]) => {
    infoLogs.push(a.map(String).join(' '));
  });
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
    warnLogs.push(a.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    errorLogs.push(a);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('downloadWorkspaceState — the handshake arm', () => {
  it('resolves with everything the temp doc holds when `synced` lands', async () => {
    const backend = makeBackend(rec, (doc, emitSynced) => {
      seed(doc, 'remote-state');
      setTimeout(emitSynced, 0);
    });

    const blob = await downloadWorkspaceState(backend, 'ws_1', {
      maxWaitTimeMs: 10,
      maxUpdatesThreshold: 5,
    });

    expect(readProbe(blob)).toBe('remote-state');
    expect(rec.destroys).toBe(1);
    expect(infoLogs).toEqual([SYNCED_LINE]);
    expect(rec.tempDocs).toHaveLength(1);
    expect(rec.tempDocs[0].isDestroyed).toBe(true);
  });

  it('forwards the workspace id and BOTH provider tuning knobs to the backend', async () => {
    const backend = makeBackend(rec, (_doc, emitSynced) => setTimeout(emitSynced, 0));

    await downloadWorkspaceState(backend, 'ws_tuned', {
      maxWaitTimeMs: 33,
      maxUpdatesThreshold: 7,
    });

    expect(rec.connectCalls).toEqual([
      { workspaceId: 'ws_tuned', options: { maxWaitTimeMs: 33, maxUpdatesThreshold: 7 } },
    ]);
  });

  it('ignores a duplicate `synced` — the first resolution wins', async () => {
    let fireAgain: () => void = () => undefined;
    const backend = makeBackend(rec, (doc, emitSynced) => {
      seed(doc, 'first');
      fireAgain = emitSynced;
      setTimeout(emitSynced, 0);
    });

    const blob = await downloadWorkspaceState(backend, 'ws_1', {
      maxWaitTimeMs: 10,
      maxUpdatesThreshold: 5,
    });

    expect(() => fireAgain()).not.toThrow();
    expect(readProbe(blob)).toBe('first');
    expect(rec.destroys).toBe(1);
    // The duplicate is ignored outright — it is not even logged again.
    expect(infoLogs).toEqual([SYNCED_LINE]);
  });

  it('clears the budget timer the moment the handshake lands', async () => {
    vi.useFakeTimers();
    const backend = makeBackend(rec, (doc, emitSynced) => {
      seed(doc, 'remote-state');
      queueMicrotask(emitSynced);
    });

    const blob = await downloadWorkspaceState(backend, 'ws_1', {
      maxWaitTimeMs: 1,
      maxUpdatesThreshold: 1,
      timeoutMs: 5000,
    });

    expect(readProbe(blob)).toBe('remote-state');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('downloadWorkspaceState — the timeout arm', () => {
  it('resolves with whatever synced so far rather than rejecting', async () => {
    const backend = makeBackend(rec, (doc) => {
      seed(doc, 'partial'); // synced never fires
    });

    const blob = await downloadWorkspaceState(backend, 'ws_slow', {
      maxWaitTimeMs: 1,
      maxUpdatesThreshold: 1,
      timeoutMs: 5,
    });

    expect(readProbe(blob)).toBe('partial');
    expect(rec.destroys).toBe(1);
    expect(warnLogs).toEqual([
      '[downloadWorkspaceState] Workspace download timeout reached for ws_slow. ' +
        'Assuming empty or unreachable remote.',
    ]);
    expect(infoLogs).toEqual([]);
    expect(rec.tempDocs[0].isDestroyed).toBe(true);
  });

  it('an unreachable remote reads as an EMPTY update, not an error', async () => {
    const backend = makeBackend(rec, () => undefined);

    const blob = await downloadWorkspaceState(backend, 'ws_dead', {
      maxWaitTimeMs: 1,
      maxUpdatesThreshold: 1,
      timeoutMs: 5,
    });

    expect(readProbe(blob)).toBeUndefined();
  });

  it("onTimeout: 'reject' fails loudly instead of reading an unreachable remote as empty", async () => {
    let fireLate: () => void = () => undefined;
    const backend = makeBackend(rec, (doc, emitSynced) => {
      seed(doc, 'partial'); // synced never fires in time
      fireLate = emitSynced;
    });

    await expect(
      downloadWorkspaceState(backend, 'ws_slow', {
        maxWaitTimeMs: 1,
        maxUpdatesThreshold: 1,
        timeoutMs: 5,
        onTimeout: 'reject',
      })
    ).rejects.toThrow('Workspace download timed out after 5ms (no initial sync)');
    expect(rec.destroys).toBe(1);
    expect(warnLogs).toEqual([]);

    // A handshake that lands AFTER the rejection is dead: not logged, not acted on.
    fireLate();
    expect(infoLogs).toEqual([]);
  });

  it('clears the budget timer once the handshake lands (no late warning)', async () => {
    const backend = makeBackend(rec, (_doc, emitSynced) => setTimeout(emitSynced, 0));

    await downloadWorkspaceState(backend, 'ws_1', {
      maxWaitTimeMs: 1,
      maxUpdatesThreshold: 1,
      timeoutMs: 5,
    });
    await new Promise((r) => setTimeout(r, 20));

    expect(warnLogs.some((l) => l.includes('timeout'))).toBe(false);
  });
});

describe('downloadWorkspaceState — the connect-failure arm', () => {
  const throwingBackend = (onDestroy?: () => void): SyncBackend =>
    ({
      uid: 'unit',
      connect: (doc: Y.Doc) => {
        rec.tempDocs.push(doc);
        onDestroy?.();
        throw new Error('attach refused');
      },
    }) as unknown as SyncBackend;

  it("rejects by default — the switch path's semantics", async () => {
    await expect(
      downloadWorkspaceState(throwingBackend(), 'ws_1', {
        maxWaitTimeMs: 1,
        maxUpdatesThreshold: 1,
        timeoutMs: 50,
      })
    ).rejects.toThrow('attach refused');

    expect(errorLogs.some((a) => a.some((x) => String(x).includes('Failed to connect temp provider')))).toBe(
      true
    );
  });

  it("rejects when 'reject' is explicit", async () => {
    await expect(
      downloadWorkspaceState(throwingBackend(), 'ws_1', {
        maxWaitTimeMs: 1,
        maxUpdatesThreshold: 1,
        timeoutMs: 50,
        onAttachError: 'reject',
      })
    ).rejects.toThrow('attach refused');
  });

  it("resolves with the (empty) current state under 'resolve' — the clean-sync semantics", async () => {
    const blob = await downloadWorkspaceState(throwingBackend(), 'ws_1', {
      maxWaitTimeMs: 1,
      maxUpdatesThreshold: 1,
      timeoutMs: 50,
      onAttachError: 'resolve',
    });

    expect(readProbe(blob)).toBeUndefined();
  });

  it('a rejection resolves promptly instead of waiting out the budget', async () => {
    const started = performance.now();

    await expect(
      downloadWorkspaceState(throwingBackend(), 'ws_1', {
        maxWaitTimeMs: 1,
        maxUpdatesThreshold: 1,
        timeoutMs: 5000,
      })
    ).rejects.toThrow('attach refused');

    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('a rejection clears the budget timer and destroys the temp doc', async () => {
    vi.useFakeTimers();

    await expect(
      downloadWorkspaceState(throwingBackend(), 'ws_1', {
        maxWaitTimeMs: 1,
        maxUpdatesThreshold: 1,
        timeoutMs: 5000,
      })
    ).rejects.toThrow('attach refused');

    expect(vi.getTimerCount()).toBe(0);
    expect(rec.tempDocs[0].isDestroyed).toBe(true);
    expect(errorLogs).toEqual([
      ['[downloadWorkspaceState]', 'Failed to connect temp provider:', expect.any(Error)],
    ]);
  });

  it("'resolve' settles promptly too — it does not wait out the budget", async () => {
    // Fake timers: the budget can only expire if the test advances the
    // clock, which it never does — so the arm must resolve on its own.
    vi.useFakeTimers();

    const blob = await downloadWorkspaceState(throwingBackend(), 'ws_1', {
      maxWaitTimeMs: 1,
      maxUpdatesThreshold: 1,
      timeoutMs: 5000,
      onAttachError: 'resolve',
    });

    expect(readProbe(blob)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    expect(warnLogs).toEqual([]);
  });
});

describe('downloadWorkspaceState — teardown', () => {
  it('destroys the temp provider even when its destroy throws, and swallows the throw', async () => {
    const backend = makeBackend(
      rec,
      (_doc, emitSynced) => setTimeout(emitSynced, 0),
      () => {
        throw new Error('destroy exploded');
      }
    );

    await expect(
      downloadWorkspaceState(backend, 'ws_1', { maxWaitTimeMs: 1, maxUpdatesThreshold: 1 })
    ).resolves.toBeInstanceOf(Uint8Array);

    expect(errorLogs.some((a) => a.some((x) => String(x).includes('Error destroying temp provider')))).toBe(
      true
    );
  });

  it('has nothing to destroy when connect never returned a connection', async () => {
    const backend = {
      uid: 'unit',
      connect: () => {
        throw new Error('nope');
      },
    } as unknown as SyncBackend;

    await downloadWorkspaceState(backend, 'ws_1', {
      maxWaitTimeMs: 1,
      maxUpdatesThreshold: 1,
      onAttachError: 'resolve',
    });

    expect(errorLogs.some((a) => a.some((x) => String(x).includes('Error destroying')))).toBe(false);
  });
});

describe('regression: async destroy rejection on teardown', () => {
  it('logs a rejected (async) destroy instead of leaking an unhandled rejection', async () => {
    const backend = {
      uid: 'unit',
      connect: (doc: Y.Doc): SyncConnection => {
        rec.tempDocs.push(doc);
        let syncedCb: (() => void) | null = null;
        setTimeout(() => syncedCb?.(), 0);
        return {
          on: (event, cb) => {
            if (event === 'synced') syncedCb = cb as () => void;
          },
          off: () => undefined,
          destroy: () => Promise.reject(new Error('final commit failed')),
        };
      },
    } as unknown as SyncBackend;

    await expect(
      downloadWorkspaceState(backend, 'ws_1', { maxWaitTimeMs: 1, maxUpdatesThreshold: 1 })
    ).resolves.toBeInstanceOf(Uint8Array);

    await vi.waitFor(() =>
      expect(
        errorLogs.some((a) => a.some((x) => String(x).includes('Error destroying temp provider')))
      ).toBe(true)
    );
  });
});

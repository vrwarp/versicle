/**
 * Write-gate contract suite — G.1–G.6
 * (plan/overhaul/prep/phase3-storage-gateway.md §Test plan "G").
 *
 * G.1–G.3 were written FIRST (P3-1), against the then-current
 * promise-chain serializer in src/lib/idb-write-lock.ts, pinning the exact
 * semantics the navigator.locks gate (src/data/write-gate.ts, P3-3) had to
 * be a drop-in for. P3-3 re-pointed the suite at the gate and runs the
 * SAME contract body against both of its implementations:
 *
 *   G.1  FIFO ordering + mutual exclusion (at most one work in flight)
 *   G.2  rejection isolation — a rejecting work rejects its own caller but
 *        never wedges the queue (pins the old idb-write-lock.ts:32–38)
 *   G.3  idbWriteLockIdle() resolves once the backlog (including
 *        rejections) drains
 *   G.4  write() rejects a thenable-returning populate and aborts the txn
 *   G.5  fallback selection: with navigator.locks undefined (native jsdom)
 *        the promise chain serves the identical contract
 *   G.6  the same suite under an in-process navigator.locks stub
 *        (request/queue semantics) — both implementations pass identically
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { getConnection as getDB } from './connection';
import type { StaticBookManifest } from '~types/db';

interface WriteGateModule {
  runExclusiveIdbWrite<T>(work: () => Promise<T>): Promise<T>;
  idbWriteLockIdle(): Promise<void>;
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flushTasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * The shared contract body. `load` returns the gate implementation under
 * test; module-level state (the chain tail / lock queue) is shared across
 * tests on purpose — the production gate is a process-wide singleton and the
 * contract must hold on a long-lived instance, not only on a fresh one.
 */
export function describeWriteGateContract(
  label: string,
  load: () => Promise<WriteGateModule>,
): void {
  describe(`write-gate contract: ${label}`, () => {
    beforeEach(() => {
      // The P3-3 gate logs a DEV re-entrancy tripwire when a request is
      // issued while the gate is held — G.1 does exactly that on purpose.
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('G.1 runs works strictly one at a time, in FIFO enqueue order', async () => {
      const gate = await load();
      const events: string[] = [];
      let active = 0;
      let maxActive = 0;

      const dA = deferred();
      const dB = deferred();
      const dC = deferred();
      const work = (name: string, release: Promise<void>) => async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        events.push(`${name}:start`);
        await release;
        events.push(`${name}:end`);
        active -= 1;
        return name;
      };

      const pA = gate.runExclusiveIdbWrite(work('A', dA.promise));
      const pB = gate.runExclusiveIdbWrite(work('B', dB.promise));
      const pC = gate.runExclusiveIdbWrite(work('C', dC.promise));

      // A acquires the gate; B and C must not start while A holds it.
      await vi.waitFor(() => expect(events).toContain('A:start'));
      await flushTasks();
      expect(events).toEqual(['A:start']);

      // Releasing later works first must not reorder the queue.
      dB.resolve();
      dC.resolve();
      await flushTasks();
      expect(events).toEqual(['A:start']);

      dA.resolve();
      // Each caller resolves with its own work's result (pass-through).
      await expect(pA).resolves.toBe('A');
      await expect(pB).resolves.toBe('B');
      await expect(pC).resolves.toBe('C');

      expect(events).toEqual(['A:start', 'A:end', 'B:start', 'B:end', 'C:start', 'C:end']);
      expect(maxActive).toBe(1);
    });

    it('G.2 a rejected work rejects its own caller but never wedges the queue', async () => {
      const gate = await load();
      const boom = new Error('boom');

      // Enqueue the follower BEFORE the rejection settles, so this pins that
      // an already-queued work still runs behind a rejecting predecessor.
      const p1 = gate.runExclusiveIdbWrite(async () => {
        throw boom;
      });
      const p2 = gate.runExclusiveIdbWrite(async () => 'after-rejection');

      await expect(p1).rejects.toBe(boom);
      await expect(p2).resolves.toBe('after-rejection');

      // The gate stays usable for later callers too.
      await expect(gate.runExclusiveIdbWrite(async () => 'later')).resolves.toBe('later');
    });

    it('G.3 idbWriteLockIdle resolves once the backlog (incl. rejections) drains', async () => {
      const gate = await load();

      // Empty queue: resolves without hanging.
      await gate.idbWriteLockIdle();

      const release = deferred();
      const pending = gate.runExclusiveIdbWrite(async () => {
        await release.promise;
        return 'done';
      });
      const rejecting = gate.runExclusiveIdbWrite(async () => {
        throw new Error('late boom');
      });
      // Attach the rejection handler NOW so an early settle can't trip
      // unhandled-rejection reporting while we assert on idle() below.
      const rejectingSettled = expect(rejecting).rejects.toThrow('late boom');

      let drained = false;
      const idle = gate.idbWriteLockIdle().then(() => {
        drained = true;
      });

      await flushTasks();
      expect(drained).toBe(false); // backlog not drained while a work holds the gate

      release.resolve();
      await idle; // resolves even though the backlog ends in a rejection
      expect(drained).toBe(true);

      await expect(pending).resolves.toBe('done');
      await rejectingSettled;
    });
  });
}

// ── G.5: native jsdom has no navigator.locks → the gate selects the
// promise-chain fallback. This invocation is byte-for-byte the P3-1 suite
// that pinned src/lib/idb-write-lock.ts, now served by the gate's fallback.
describe('G.5 fallback selection (navigator.locks undefined under jsdom)', () => {
  it('jsdom really has no navigator.locks (the fallback path is what runs below)', () => {
    expect((navigator as { locks?: unknown }).locks).toBeUndefined();
  });
});

describeWriteGateContract('promise-chain fallback (no navigator.locks)', () =>
  import('./write-gate'),
);

// ── G.6: the same contract under a Web Locks stub with the spec's
// per-name FIFO grant + release-on-settle semantics. ───────────────────────
function createNavigatorLocksStub() {
  const tails = new Map<string, Promise<unknown>>();
  let requests = 0;
  const swallow = () => undefined;
  const request = (
    name: string,
    optionsOrCallback: LockOptions | ((lock: Lock | null) => unknown),
    maybeCallback?: (lock: Lock | null) => unknown,
  ): Promise<unknown> => {
    requests += 1;
    const callback =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback!;
    const mode =
      typeof optionsOrCallback === 'function'
        ? 'exclusive'
        : (optionsOrCallback.mode ?? 'exclusive');
    const previous = tails.get(name) ?? Promise.resolve();
    // Granted when every earlier request for this name settles (FIFO,
    // exclusive); released when the callback's promise settles.
    const run = previous.then(() => callback({ name, mode } as Lock));
    tails.set(name, run.then(swallow, swallow));
    return run;
  };
  return { locks: { request } as unknown as LockManager, requestCount: () => requests };
}

describe('G.6 Web Locks path (navigator.locks stub installed)', () => {
  const stub = createNavigatorLocksStub();

  beforeAll(() => {
    Object.defineProperty(navigator, 'locks', { value: stub.locks, configurable: true });
  });
  afterAll(() => {
    delete (navigator as { locks?: unknown }).locks;
  });

  describeWriteGateContract('navigator.locks (in-process stub)', () =>
    import('./write-gate'),
  );

  it('actually routes through navigator.locks.request when available', async () => {
    const before = stub.requestCount();
    const gate = await import('./write-gate');
    await gate.runExclusiveIdbWrite(async () => 'via-locks');
    expect(stub.requestCount()).toBeGreaterThan(before);
  });
});

// ── write() — the structural repo API. ─────────────────────────────────────
describe('write(stores, populate)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('commits synchronous puts issued inside the gate', async () => {
    const { write } = await import('./write-gate');
    const row = {
      bookId: 'write-gate-ok',
      title: 'Write Gate',
      author: 'G',
      schemaVersion: 1,
      fileHash: 'wg',
      fileSize: 1,
      totalChars: 1,
    } as StaticBookManifest;

    await write(['static_manifests'] as const, (tx) => {
      tx.objectStore('static_manifests').put(row);
    });

    const db = await getDB();
    expect((await db.get('static_manifests', 'write-gate-ok'))?.title).toBe('Write Gate');
    await db.delete('static_manifests', 'write-gate-ok');
  });

  it('G.4 rejects a thenable-returning populate and aborts the transaction', async () => {
    const { write } = await import('./write-gate');
    const row = {
      bookId: 'write-gate-g4',
      title: 'Must Not Commit',
      author: 'G',
      schemaVersion: 1,
      fileHash: 'wg4',
      fileSize: 1,
      totalChars: 1,
    } as StaticBookManifest;

    // Cast past the compile-time `void` return: this pins the RUNTIME guard.
    const asyncPopulate = (async (tx: { objectStore(name: string): { put(v: unknown): Promise<unknown> } }) => {
      // Pre-handle the request promise: the abort below rejects it (idb
      // wraps every request), and this test is about write()'s rejection.
      tx.objectStore('static_manifests').put(row).catch(() => undefined);
    }) as unknown as Parameters<typeof write>[1];

    await expect(write(['static_manifests'] as const, asyncPopulate)).rejects.toThrow(
      /populate must be synchronous/,
    );

    // The put issued before the abort must NOT have committed.
    const db = await getDB();
    expect(await db.get('static_manifests', 'write-gate-g4')).toBeUndefined();
  });

  it('a populate that throws synchronously aborts the transaction and rejects', async () => {
    const { write } = await import('./write-gate');
    await expect(
      write(['static_manifests'] as const, () => {
        throw new Error('populate exploded');
      }),
    ).rejects.toThrow('populate exploded');
  });
});

// ── DEV re-entrancy tripwire (D1). ──────────────────────────────────────────
describe('DEV re-entrancy tripwire', () => {
  it('logs when a request is issued while this context holds the gate', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const gate = await import('./write-gate');

    const release = deferred();
    const holder = gate.runExclusiveIdbWrite(async () => {
      await release.promise;
    }, 'tripwire-holder');
    await flushTasks(); // holder's callback is now executing (gate held)

    const follower = gate.runExclusiveIdbWrite(async () => 'follower', 'tripwire-follower');
    expect(spy).toHaveBeenCalledWith(
      '[WriteGate]',
      expect.stringContaining('re-entrant runExclusiveIdbWrite (tripwire-follower)'),
    );

    release.resolve();
    await expect(holder).resolves.toBeUndefined();
    await expect(follower).resolves.toBe('follower');
  });
});

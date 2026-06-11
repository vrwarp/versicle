/**
 * Write-gate contract suite — G.1–G.3 of the P3-1 entry gate
 * (plan/overhaul/prep/phase3-storage-gateway.md §Test plan "G").
 *
 * Written FIRST, against the EXISTING promise-chain serializer
 * (src/lib/idb-write-lock.ts), to pin the exact semantics that the
 * navigator.locks gate (src/data/write-gate.ts, P3-3) must be a drop-in
 * for:
 *
 *   G.1  FIFO ordering + mutual exclusion (at most one work in flight)
 *   G.2  rejection isolation — a rejecting work rejects its own caller but
 *        never wedges the queue (pins idb-write-lock.ts:32–38)
 *   G.3  idbWriteLockIdle() resolves once the backlog (including
 *        rejections) drains
 *
 * P3-3 extends this file with G.4–G.6: the same contract is then executed
 * against BOTH implementations (the promise-chain fallback natively under
 * jsdom, and the Web Locks path via an in-process navigator.locks stub).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// P3-1 entry gate: pin the CURRENT implementation. P3-3 re-points this at
// src/data/write-gate.ts (both lock paths) without changing the contract body.
describeWriteGateContract('promise chain (src/lib/idb-write-lock.ts)', () =>
  import('@lib/idb-write-lock'),
);

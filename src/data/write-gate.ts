/**
 * The cross-context exclusive write gate for IndexedDB (Phase 3, D1 in
 * plan/overhaul/prep/phase3-storage-gateway.md).
 *
 * Why this exists
 * ---------------
 * WebKit's IndexedDB intermittently deadlocks when two readwrite
 * transactions are in flight at the same time, even on *different* object
 * stores. We proved this with verification/_idb_probe.js: during the flaky
 * "tts chapter navigation during playback" test the probe captured two
 * outstanding readwrite transactions — one on Yjs's `updates` store (y-idb)
 * and one on `cache_session_state` (DBService) — that both started within
 * 1ms of each other and then hung for ~42 seconds, wedging the TTS task
 * sequencer.
 *
 * The predecessor (src/lib/idb-write-lock.ts) serialized writers through a
 * module-level promise chain — which is per-JS-context state. Since the
 * worker TTS engine became the only production path, the worker's DBService
 * singleton runs its own chain: a worker `cache_session_state` write could
 * overlap a main-thread Yjs `updates` flush, reintroducing exactly the
 * proven hang pair across contexts. This gate closes that hole with the
 * Web Locks API (`navigator.locks`): one named exclusive lock, FIFO-fair,
 * shared by every agent of the origin — main thread, the TTS worker, and
 * other tabs.
 *
 * Fallback: where `navigator.locks` is unavailable (jsdom — the entire
 * vitest suite, Safari < 15.4) the verbatim promise-chain implementation is
 * used; it preserves the old per-context guarantee. Both implementations
 * are pinned by the same contract suite (write-gate.test.ts, G.1–G.6).
 *
 * Rules for callers:
 * - `work` must open its transaction AND await its completion (the gate is
 *   held for the full lifetime of the transaction, not just its setup).
 * - NEVER await `runExclusiveIdbWrite` from inside a held callback: the
 *   inner request waits for the outer's slot — a deadlock, and under
 *   navigator.locks it now stalls every context. A DEV tripwire logs when a
 *   request is issued while this context holds the gate. New code should
 *   use {@link write}, whose synchronous callback makes the hazard (and
 *   WebKit hang trigger #2 — intra-transaction awaits) unrepresentable.
 */
import type { IDBPTransaction, StoreNames } from 'idb';
import { createLogger } from '@lib/logger';
import { getConnection } from './connection';
import type { EpubLibraryDB } from './schema';

const logger = createLogger('WriteGate');

/** Origin-scoped Web Locks name; one exclusive holder across all contexts. */
const LOCK_NAME = 'versicle-idb-write';

/**
 * Diagnostics only: a hung WebKit transaction inside the gate now blocks all
 * writers in all contexts — intended serialization, but it must be visible.
 * The watchdog never force-releases.
 */
const WATCHDOG_MS = 10_000;

/** True while this context is executing a gated callback (DEV tripwire). */
let held = false;

/**
 * Fallback chain tail (used when navigator.locks is unavailable) and, on the
 * locks path, the settle-tracking tail for {@link idbWriteLockIdle}. Works
 * for both because grants are FIFO: the most recently issued request settles
 * last among the requests issued so far in this context.
 */
let tail: Promise<unknown> = Promise.resolve();

const swallow = () => undefined;

type LocksApi = Pick<LockManager, 'request'>;

function locksApi(): LocksApi | undefined {
  // `navigator` exists in window AND worker contexts; jsdom has a navigator
  // without `locks`. Resolved per call so tests can install/remove a stub.
  const nav = (globalThis as { navigator?: { locks?: LocksApi } }).navigator;
  return nav?.locks;
}

function instrument<T>(work: () => Promise<T>, label: string): () => Promise<T> {
  return async () => {
    held = true;
    const watchdog = setTimeout(() => {
      logger.error(`IDB write gate held > ${WATCHDOG_MS}ms by ${label} — a wedged ` +
        'transaction inside the gate stalls every writer in every context.');
    }, WATCHDOG_MS);
    try {
      return await work();
    } finally {
      clearTimeout(watchdog);
      held = false;
    }
  };
}

/**
 * Runs `work` after every previously-enqueued exclusive write has settled,
 * ensuring no two run concurrently — across the main thread, the TTS worker,
 * and other tabs when the Web Locks API is available; within this context on
 * the fallback chain. Resolves/rejects with `work`'s result; a rejection
 * never wedges the queue (under locks the lock releases when the callback's
 * promise settles; the chain swallows the result when advancing the tail).
 *
 * Drop-in for src/lib/idb-write-lock.ts `runExclusiveIdbWrite` — same name,
 * same signature, same rejection-isolation semantics. `label` is additive
 * and used only by the watchdog/tripwire diagnostics.
 */
export function runExclusiveIdbWrite<T>(work: () => Promise<T>, label?: string): Promise<T> {
  const name = label ?? (work.name || 'anonymous work');
  if (import.meta.env.DEV && held) {
    // Re-entrancy tripwire (D1): issuing a request while this context holds
    // the gate is fine ONLY if the holder does not await it before
    // releasing. If it does, that is a deadlock — cross-context under
    // navigator.locks. Flight-recorder breadcrumb lands when the recorder
    // core moves to the kernel (P5); the loud DEV log is the signal here.
    logger.error(
      `Possible re-entrant runExclusiveIdbWrite (${name}) issued while the write gate ` +
        'is held in this context. If the holder awaits this request, it deadlocks.',
    );
  }

  const guarded = instrument(work, name);
  const locks = locksApi();
  const run = locks
    ? (locks.request(LOCK_NAME, { mode: 'exclusive' }, guarded) as Promise<T>)
    : (tail.then(guarded, guarded) as Promise<T>);

  // Advance the tail, swallowing the result so one failure can't wedge the
  // queue (chain path) or break idle tracking (locks path).
  tail = run.then(swallow, swallow);
  return run;
}

/**
 * Test helper, preserved from idb-write-lock.ts: resolves once the backlog
 * of exclusive writes issued from THIS context has drained.
 */
export function idbWriteLockIdle(): Promise<void> {
  return tail.then(swallow, swallow);
}

/**
 * The structural write API for the Phase 3 repos: opens one readwrite
 * transaction over `stores` inside the gate, hands it to `populate`, then
 * awaits `tx.done` — all while holding the lock.
 *
 * `populate` MUST be synchronous (returns void, not a Promise): issue your
 * puts/deletes and return. Intra-transaction awaits — WebKit hang trigger #2
 * (see the carved-verbatim WebKit notes in src/data/repos/playbackCache.ts) —
 * are unrepresentable, and so
 * is re-entrant gate acquisition. A thenable-returning callback aborts the
 * transaction and rejects (G.4): an async populate would race transaction
 * auto-commit and corrupt silently if allowed through.
 *
 * Read-modify-write recipe: read in a plain readonly transaction OUTSIDE the
 * gate, compute, then `write()` with a synchronous put. Last-write-wins
 * between read and write — identical to (narrower than) the races the old
 * intra-transaction-await sites already had, and the gate's serialization
 * means no app writer can interleave.
 */
export function write<Names extends readonly StoreNames<EpubLibraryDB>[]>(
  stores: Names,
  populate: (tx: IDBPTransaction<EpubLibraryDB, Names, 'readwrite'>) => void,
): Promise<void> {
  return runExclusiveIdbWrite(async () => {
    const db = await getConnection();
    const tx = db.transaction(stores, 'readwrite') as IDBPTransaction<
      EpubLibraryDB,
      Names,
      'readwrite'
    >;
    // Deliberate aborts: pre-handle tx.done's AbortError rejection (nothing
    // else observes it — the caller's error is the real signal).
    const abortQuietly = () => {
      tx.done.catch(() => undefined);
      tx.abort();
    };
    let result: unknown;
    try {
      result = populate(tx) as unknown;
    } catch (error) {
      abortQuietly();
      throw error;
    }
    if (typeof (result as PromiseLike<unknown> | null | undefined)?.then === 'function') {
      abortQuietly();
      throw new TypeError(
        'write(): populate must be synchronous — it returned a thenable. ' +
          'Intra-transaction awaits are the WebKit hang trigger this API exists to ban.',
      );
    }
    await tx.done;
  }, `write(${stores.join(', ')})`);
}

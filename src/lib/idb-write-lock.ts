/**
 * Process-wide serializer for IndexedDB *readwrite* transactions that originate from
 * different subsystems and would otherwise overlap.
 *
 * Why this exists
 * ---------------
 * WebKit's IndexedDB intermittently deadlocks when two readwrite transactions are in
 * flight at the same time, even on *different* object stores. We proved this with
 * verification/_idb_probe.js: during the flaky "tts chapter navigation during playback"
 * test the probe captured two outstanding readwrite transactions — one on Yjs's `updates`
 * store (y-indexeddb) and one on `cache_session_state` (DBService) — that both started
 * within 1ms of each other and then hung for ~42 seconds, wedging the TTS task sequencer.
 *
 * Each subsystem already serialises its *own* writes (the Yjs throttle keeps one `updates`
 * batch in flight; DBService chains its session writes), but the two chains are independent
 * and can still collide with each other. Routing both through this single shared chain
 * guarantees at most one app-issued readwrite transaction is ever in flight, which removes
 * the concurrent-readwrite condition that triggers the WebKit hang.
 *
 * The work function should open its transaction AND await its completion (so the lock is
 * held for the full lifetime of the transaction, not just its synchronous setup).
 */

let tail: Promise<unknown> = Promise.resolve();

/**
 * Runs `work` after every previously-enqueued exclusive write has settled, ensuring no two
 * run concurrently. Resolves/rejects with `work`'s result; a rejection does not break the
 * chain for subsequent callers.
 */
export function runExclusiveIdbWrite<T>(work: () => Promise<T>): Promise<T> {
  // Chain onto the tail regardless of whether the previous work resolved or rejected.
  const run = tail.then(work, work);
  // Advance the tail, swallowing the result so one failure can't wedge the queue.
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Test helper: resolves once the current backlog of exclusive writes has drained.
 */
export function idbWriteLockIdle(): Promise<void> {
  return tail.then(
    () => undefined,
    () => undefined,
  );
}

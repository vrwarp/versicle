/**
 * Per-key async mutex (Phase 7 §C). ONE instance is shared by the
 * ImportOrchestrator and the LibraryService: every mutation of book X —
 * import, register, delete, offload, restore, reprocess, hydrate-write —
 * runs inside `mutex.run(X, fn)`, which makes the historical
 * delete-vs-restore / reprocess-overlap races (the five race files, D6)
 * structurally impossible instead of guarded by copy-pasted zombie checks.
 */
export class KeyedMutex {
  private tails = new Map<string, Promise<unknown>>();

  /**
   * Run `fn` exclusively for `key`. Tasks for the same key execute in FIFO
   * order; a predecessor's failure does not block successors. Failures
   * propagate to the caller of THEIR task only.
   */
  async run<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const task = prev.then(fn, fn);

    // The stored tail must never be a rejected promise (unhandled-rejection
    // hygiene) — successors only need ORDERING, not the result.
    const tail = task.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      // Garbage-collect the chain once the latest task settles.
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });

    return task;
  }

  /** True while any task holds or awaits the key (test/diagnostic probe). */
  isHeld(key: string): boolean {
    return this.tails.has(key);
  }
}

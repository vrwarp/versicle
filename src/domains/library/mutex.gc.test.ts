/**
 * KeyedMutex — the chain garbage collection.
 *
 * mutex.test.ts pins ordering and failure isolation. This file pins the
 * bookkeeping underneath: the tail entry is dropped once the LATEST task
 * settles, and only then — a mutex that forgot the identity check would
 * release the key while a successor was still queued, which is exactly the
 * serialization the library workflows depend on.
 */
import { describe, it, expect } from 'vitest';
import { KeyedMutex } from './mutex';

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('KeyedMutex — key lifetime', () => {
  it('is not held before anything runs', () => {
    expect(new KeyedMutex().isHeld('a')).toBe(false);
  });

  it('holds the key while a task is in flight and releases it after', async () => {
    const mutex = new KeyedMutex();
    const gate = deferred<string>();

    const run = mutex.run('a', () => gate.promise);
    expect(mutex.isHeld('a')).toBe(true);

    gate.resolve('done');
    await run;
    await Promise.resolve();

    expect(mutex.isHeld('a')).toBe(false);
  });

  it('stays held while a SUCCESSOR is still queued behind the finished task', async () => {
    const mutex = new KeyedMutex();
    const first = deferred<string>();
    const second = deferred<string>();

    const runFirst = mutex.run('a', () => first.promise);
    const runSecond = mutex.run('a', () => second.promise);

    first.resolve('one');
    await runFirst;
    await Promise.resolve();
    // The first task's tail is no longer the LATEST, so its settle must not
    // release the key out from under the queued second task.
    expect(mutex.isHeld('a')).toBe(true);

    second.resolve('two');
    await runSecond;
    await Promise.resolve();
    expect(mutex.isHeld('a')).toBe(false);
  });

  it('releases the key even when the task rejects', async () => {
    const mutex = new KeyedMutex();

    await expect(
      mutex.run('a', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    await Promise.resolve();

    expect(mutex.isHeld('a')).toBe(false);
  });

  it('tracks keys independently', async () => {
    const mutex = new KeyedMutex();
    const gate = deferred<string>();

    const run = mutex.run('a', () => gate.promise);

    expect(mutex.isHeld('a')).toBe(true);
    expect(mutex.isHeld('b')).toBe(false);

    gate.resolve('x');
    await run;
  });

  it('re-acquires cleanly after a full release', async () => {
    const mutex = new KeyedMutex();

    await mutex.run('a', async () => 1);
    await Promise.resolve();
    expect(mutex.isHeld('a')).toBe(false);

    const second = mutex.run('a', async () => 2);
    expect(mutex.isHeld('a')).toBe(true);
    await expect(second).resolves.toBe(2);
  });
});

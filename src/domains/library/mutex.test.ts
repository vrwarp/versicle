import { describe, it, expect } from 'vitest';
import { KeyedMutex } from './mutex';

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe('KeyedMutex', () => {
  it('serializes tasks on the same key in FIFO order', async () => {
    const mutex = new KeyedMutex();
    const order: string[] = [];

    const a = mutex.run('k', async () => {
      order.push('a-start');
      await tick(20);
      order.push('a-end');
    });
    const b = mutex.run('k', async () => {
      order.push('b-start');
      await tick(0);
      order.push('b-end');
    });

    await Promise.all([a, b]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('runs different keys concurrently', async () => {
    const mutex = new KeyedMutex();
    const order: string[] = [];

    await Promise.all([
      mutex.run('x', async () => {
        order.push('x-start');
        await tick(20);
        order.push('x-end');
      }),
      mutex.run('y', async () => {
        order.push('y-start');
        await tick(0);
        order.push('y-end');
      }),
    ]);

    expect(order).toEqual(['x-start', 'y-start', 'y-end', 'x-end']);
  });

  it("a predecessor's failure neither blocks successors nor leaks to them", async () => {
    const mutex = new KeyedMutex();

    const failing = mutex.run('k', async () => {
      throw new Error('boom');
    });
    const next = mutex.run('k', async () => 'ok');

    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });

  it('returns the task result and cleans up its tail', async () => {
    const mutex = new KeyedMutex();
    await expect(mutex.run('k', () => 42)).resolves.toBe(42);
    // Allow the cleanup microtask to run.
    await tick(0);
    expect(mutex.isHeld('k')).toBe(false);
  });
});

/**
 * The typed `SyncEvent` bus (§D3). One rule carries the whole design: a
 * presentation bug must never take down the transport — so a throwing
 * subscriber is logged and the fan-out continues.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getSyncEventBus } from './events';
import type { SyncEvent } from './events';

let errorLogs: unknown[][];
const teardown: Array<() => void> = [];

beforeEach(() => {
  errorLogs = [];
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => errorLogs.push(a));
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  while (teardown.length) teardown.pop()?.();
  vi.restoreAllMocks();
});

const subscribe = (listener: (e: SyncEvent) => void): void => {
  teardown.push(getSyncEventBus().on(listener));
};

describe('the SyncEvent bus', () => {
  it('is a process-wide singleton', () => {
    expect(getSyncEventBus()).toBe(getSyncEventBus());
  });

  it('delivers each event to every subscriber', () => {
    const a: SyncEvent[] = [];
    const b: SyncEvent[] = [];
    subscribe((e) => a.push(e));
    subscribe((e) => b.push(e));

    getSyncEventBus().emit({ type: 'flushed', at: 7 });

    expect(a).toEqual([{ type: 'flushed', at: 7 }]);
    expect(b).toEqual([{ type: 'flushed', at: 7 }]);
  });

  it('the returned handle unsubscribes', () => {
    const seen: SyncEvent[] = [];
    const off = getSyncEventBus().on((e) => seen.push(e));

    off();
    getSyncEventBus().emit({ type: 'flushed', at: 1 });

    expect(seen).toEqual([]);
  });

  it('registers a callback once — a duplicate subscribe does not double-deliver', () => {
    const listener = vi.fn();
    teardown.push(getSyncEventBus().on(listener));
    teardown.push(getSyncEventBus().on(listener));

    getSyncEventBus().emit({ type: 'flushed', at: 1 });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('a THROWING subscriber is logged and never starves its peers', () => {
    const seen: SyncEvent[] = [];
    const boom = new Error('presentation bug');
    subscribe(() => {
      throw boom;
    });
    subscribe((e) => seen.push(e));

    expect(() => getSyncEventBus().emit({ type: 'flushed', at: 3 })).not.toThrow();

    expect(seen).toEqual([{ type: 'flushed', at: 3 }]);
    expect(
      errorLogs.some(
        (args) =>
          args.some((x) => String(x).includes('Sync event listener threw')) && args.includes(boom)
      )
    ).toBe(true);
  });

  it('logs under the SyncEvents namespace', () => {
    subscribe(() => {
      throw new Error('x');
    });

    getSyncEventBus().emit({ type: 'flushed', at: 1 });

    expect(errorLogs.some((args) => args.some((x) => String(x).includes('[SyncEvents]')))).toBe(
      true
    );
  });

  it('a subscriber unsubscribing itself mid-dispatch does not skip its peers', () => {
    const seen: string[] = [];
    const first = (): void => {
      seen.push('first');
      off();
    };
    const off = getSyncEventBus().on(first);
    subscribe(() => seen.push('second'));

    getSyncEventBus().emit({ type: 'flushed', at: 1 });

    expect(seen).toEqual(['first', 'second']);
  });

  it('an emit with no subscribers is inert', () => {
    expect(() => getSyncEventBus().emit({ type: 'flushed', at: 1 })).not.toThrow();
  });
});

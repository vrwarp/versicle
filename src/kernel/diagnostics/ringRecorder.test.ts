/**
 * RingRecorder unit suite: ring overwrite ordering, payload truncation,
 * stats, clear, and capacity validation.
 */
import { describe, expect, it } from 'vitest';
import { RingRecorder } from './ringRecorder';

describe('RingRecorder', () => {
  it('exports events in chronological order before the ring fills', () => {
    const r = new RingRecorder({ capacity: 3 });
    r.record('a', 'one');
    r.record('a', 'two');
    expect(r.export().map((e) => e.ev)).toEqual(['one', 'two']);
  });

  it('overwrites the oldest events and still exports chronologically', () => {
    const r = new RingRecorder({ capacity: 3 });
    for (const ev of ['e1', 'e2', 'e3', 'e4', 'e5']) r.record('a', ev);
    const out = r.export();
    expect(out.map((e) => e.ev)).toEqual(['e3', 'e4', 'e5']);
    expect(out.map((e) => e.seq)).toEqual([2, 3, 4]);
  });

  it('truncates long string payload values only', () => {
    const r = new RingRecorder({ maxStringLength: 4 });
    const event = r.record('a', 'ev', { s: 'abcdefgh', n: 123456, b: true, z: null });
    expect(event.d).toEqual({ s: 'abcd', n: 123456, b: true, z: null });
  });

  it('reports stats and resets on clear()', () => {
    const r = new RingRecorder({ capacity: 2 });
    expect(r.getStats()).toEqual({ eventCount: 0, capacity: 2, oldestWall: null });
    r.record('a', 'x');
    expect(r.getStats().eventCount).toBe(1);
    expect(r.getStats().oldestWall).not.toBeNull();
    r.clear();
    expect(r.export()).toEqual([]);
    expect(r.record('a', 'y').seq).toBe(0);
  });

  describe('regression: non-positive capacity', () => {
    it('clamps to a capacity of 1 instead of growing unbounded', () => {
      const r = new RingRecorder({ capacity: 0 });
      for (let i = 0; i < 5; i++) r.record('a', `e${i}`);
      expect(r.getStats().capacity).toBe(1);
      expect(r.export().map((e) => e.ev)).toEqual(['e4']);
    });
  });
});

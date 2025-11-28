
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncEngine, AlignmentData } from './SyncEngine';

describe('SyncEngine', () => {
  let engine: SyncEngine;
  const alignment: AlignmentData[] = [
    { time: 0, type: 'sentence', value: 'First sentence', textOffset: 0 },
    { time: 2.5, type: 'sentence', value: 'Second sentence', textOffset: 15 },
    { time: 5.0, type: 'sentence', value: 'Third sentence', textOffset: 30 }
  ];

  beforeEach(() => {
    engine = new SyncEngine();
    engine.loadAlignment(alignment);
  });

  it('should emit highlight for initial time', () => {
    const callback = vi.fn();
    engine.setOnHighlight(callback);

    engine.updateTime(0);
    expect(callback).toHaveBeenCalledWith(0);
  });

  it('should emit highlight when time crosses boundary', () => {
    const callback = vi.fn();
    engine.setOnHighlight(callback);

    engine.updateTime(1.0); // Still first
    expect(callback).toHaveBeenCalledWith(0);

    // Clear previous calls
    callback.mockClear();

    engine.updateTime(2.6); // Into second
    expect(callback).toHaveBeenCalledWith(15);
  });

  it('should not emit if index has not changed', () => {
    const callback = vi.fn();
    engine.setOnHighlight(callback);

    engine.updateTime(2.6); // Second sentence
    expect(callback).toHaveBeenCalledTimes(1);

    callback.mockClear();

    engine.updateTime(3.0); // Still second sentence
    expect(callback).not.toHaveBeenCalled();
  });

  it('should handle seeking backwards', () => {
    const callback = vi.fn();
    engine.setOnHighlight(callback);

    engine.updateTime(5.5); // Third
    expect(callback).toHaveBeenLastCalledWith(30);

    engine.updateTime(1.0); // Jump back to first
    expect(callback).toHaveBeenLastCalledWith(0);
  });
});

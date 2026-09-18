/**
 * useQuotaMeters suite: the 1 s live-meter poll over the store-injected
 * `getQuotaSnapshot` (the governor mirror). Runs the REAL hook against the REAL
 * GenAI/device stores with a seeded snapshot — no module mocks.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGenAIStore, DEFAULT_QUOTA_LIMITS } from '@store/useGenAIStore';
import { useDeviceStore } from '@store/useDeviceStore';
import type { LaneUsage } from '@kernel/quota';
import { useQuotaMeters } from './useQuotaMeters';

const LIMITS = { rpm: 100, tpm: 30_000, rpd: 1000 };

/** The hook sums the snapshot across EVERY known rate pool. */
const POOLS = Object.keys(DEFAULT_QUOTA_LIMITS).length;

const snapshot = (): Record<'fg' | 'fgd' | 'bg', LaneUsage> => ({
  fg: { rpm: 40, tpm: 12_000, rpd: 300, limits: LIMITS },
  fgd: { rpm: 2, tpm: 500, rpd: 300, limits: LIMITS },
  bg: { rpm: 5, tpm: 2_000, rpd: 120, limits: LIMITS },
});

describe('useQuotaMeters', () => {
  beforeEach(() => {
    act(() => {
      useDeviceStore.setState({ devices: {} });
      // A NEW snapshot object per call — the governor mirror behaves this way,
      // and it is why identity comparison alone could never settle.
      useGenAIStore.setState({ getQuotaSnapshot: () => snapshot() });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => {
      useGenAIStore.setState({ getQuotaSnapshot: undefined });
    });
  });

  it('derives the meters from the injected snapshot', () => {
    const { result } = renderHook(() => useQuotaMeters());

    // fg meter covers BOTH foreground lanes (fg + fgd); rpd is not summed
    // across lanes, but every figure IS summed across pools.
    expect(result.current.fg).toMatchObject({
      rpm: 42 * POOLS,
      tpm: 12_500 * POOLS,
      rpd: 300 * POOLS,
    });
    expect(result.current.bg).toMatchObject({ rpm: 5 * POOLS, tpm: 2_000 * POOLS, rpd: 120 * POOLS });
    expect(result.current.activePools.length).toBeGreaterThan(0);
  });

  /**
   * The poll built a fresh meters object every second whether or not a single
   * number had moved, so GenAIPanel re-rendered — and with it the ~900-line
   * GenAISettingsTab (every meter bar in it), which is an unmemoized child.
   * That is the render the bail-out removes. The tab keeps its OWN 1 s
   * `setTick` interval and still commits once a second, so what this buys is
   * one tab render a second instead of two, not an idle tab.
   */
  describe('regression: an unchanged meter does not re-render the panel', () => {
    it('keeps the same meters object across ticks while the snapshot is unchanged', () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useQuotaMeters());

      const first = result.current;
      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(result.current).toBe(first);
    });

    it('still updates when a number actually moves', () => {
      vi.useFakeTimers();
      let rpm = 40;
      act(() => {
        useGenAIStore.setState({
          getQuotaSnapshot: () => ({ ...snapshot(), fg: { rpm, tpm: 12_000, rpd: 300, limits: LIMITS } }),
        });
      });
      const { result } = renderHook(() => useQuotaMeters());
      const before = result.current;

      rpm = 55;
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(result.current).not.toBe(before);
      expect(result.current.fg.rpm).toBe(57 * POOLS); // (55 fg + 2 fgd) per pool
    });
  });
});

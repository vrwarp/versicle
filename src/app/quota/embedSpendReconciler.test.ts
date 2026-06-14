import { describe, it, expect } from 'vitest';
import type { DeviceInfo } from '~types/device';
import type { QuotaLimits } from '@kernel/quota';
import {
  ACTIVE_DEVICE_WINDOW_MS,
  makeBackgroundQuotaLimits,
  sumActiveDeviceSpend,
} from './embedSpendReconciler';

// Mid-day PT epoch (well clear of the midnight boundary either way) — the same
// convention the kernel quota suite uses, so the PT day-key compare aligns.
const NOON_PT_2026_06_13 = Date.UTC(2026, 5, 13, 19, 0, 0); // 12:00 PDT (UTC-7)
const TODAY_PT = '2026-06-13';
const YESTERDAY_PT = '2026-06-12';

function device(overrides: Partial<DeviceInfo> & Pick<DeviceInfo, 'id'>): DeviceInfo {
  return {
    name: overrides.id,
    platform: 'Test',
    browser: 'Test',
    model: null,
    userAgent: 'test',
    appVersion: '0.0.0',
    created: 0,
    lastActive: NOON_PT_2026_06_13,
    profile: {} as DeviceInfo['profile'],
    ...overrides,
  };
}

function asMap(...devices: DeviceInfo[]): Record<string, DeviceInfo> {
  return Object.fromEntries(devices.map((d) => [d.id, d]));
}

const SELF = 'device-self';

describe('sumActiveDeviceSpend', () => {
  it('EXCLUDES self (own spend is already in the governor counter)', () => {
    const devices = asMap(
      device({
        id: SELF,
        lastActive: NOON_PT_2026_06_13,
        embedSpend: { day: TODAY_PT, rpd: 100 },
      }),
    );
    expect(sumActiveDeviceSpend(devices, SELF, NOON_PT_2026_06_13)).toBe(0);
  });

  it('EXCLUDES a device idle > 10min', () => {
    const devices = asMap(
      device({
        id: 'device-idle',
        lastActive: NOON_PT_2026_06_13 - ACTIVE_DEVICE_WINDOW_MS, // exactly at the window edge → excluded
        embedSpend: { day: TODAY_PT, rpd: 7 },
      }),
    );
    expect(sumActiveDeviceSpend(devices, SELF, NOON_PT_2026_06_13)).toBe(0);
  });

  it('EXCLUDES a device whose embedSpend.day is a prior PT day', () => {
    const devices = asMap(
      device({
        id: 'device-stale',
        lastActive: NOON_PT_2026_06_13,
        embedSpend: { day: YESTERDAY_PT, rpd: 7 },
      }),
    );
    expect(sumActiveDeviceSpend(devices, SELF, NOON_PT_2026_06_13)).toBe(0);
  });

  it('EXCLUDES a device with no embedSpend', () => {
    const devices = asMap(device({ id: 'device-empty', lastActive: NOON_PT_2026_06_13 }));
    expect(sumActiveDeviceSpend(devices, SELF, NOON_PT_2026_06_13)).toBe(0);
  });

  it('SUMS multiple active + today siblings', () => {
    const devices = asMap(
      device({
        id: 'device-x',
        lastActive: NOON_PT_2026_06_13 - 60_000, // 1 min ago → active
        embedSpend: { day: TODAY_PT, rpd: 3 },
      }),
      device({
        id: 'device-y',
        lastActive: NOON_PT_2026_06_13 - 5 * 60_000, // 5 min ago → active
        embedSpend: { day: TODAY_PT, rpd: 4 },
      }),
      // self + an idle + a stale sibling are all dropped
      device({ id: SELF, embedSpend: { day: TODAY_PT, rpd: 999 } }),
      device({
        id: 'device-idle',
        lastActive: NOON_PT_2026_06_13 - ACTIVE_DEVICE_WINDOW_MS - 1,
        embedSpend: { day: TODAY_PT, rpd: 50 },
      }),
      device({
        id: 'device-stale',
        lastActive: NOON_PT_2026_06_13,
        embedSpend: { day: YESTERDAY_PT, rpd: 50 },
      }),
    );
    expect(sumActiveDeviceSpend(devices, SELF, NOON_PT_2026_06_13)).toBe(7);
  });

  it('returns 0 when no device qualifies', () => {
    expect(sumActiveDeviceSpend({}, SELF, NOON_PT_2026_06_13)).toBe(0);
  });
});

describe('makeBackgroundQuotaLimits', () => {
  const base: QuotaLimits = { rpm: 100, tpm: 30_000, rpd: 1000 };

  it('reduces base rpd by the sibling sum (and leaves rpm/tpm untouched)', () => {
    const devices = asMap(
      device({
        id: 'device-x',
        lastActive: NOON_PT_2026_06_13,
        embedSpend: { day: TODAY_PT, rpd: 200 },
      }),
    );
    const provider = makeBackgroundQuotaLimits(
      () => base,
      () => devices,
      SELF,
      () => NOON_PT_2026_06_13,
    );
    expect(provider()).toEqual({ rpm: 100, tpm: 30_000, rpd: 800 });
  });

  it('clamps rpd at >= 0 (over-spend siblings cannot push it negative)', () => {
    const devices = asMap(
      device({
        id: 'device-x',
        lastActive: NOON_PT_2026_06_13,
        embedSpend: { day: TODAY_PT, rpd: 5000 },
      }),
    );
    const provider = makeBackgroundQuotaLimits(
      () => base,
      () => devices,
      SELF,
      () => NOON_PT_2026_06_13,
    );
    expect(provider().rpd).toBe(0);
  });

  it('reads base limits FRESH per call (GG-8)', () => {
    let current: QuotaLimits = { rpm: 100, tpm: 30_000, rpd: 1000 };
    const provider = makeBackgroundQuotaLimits(
      () => current,
      () => ({}),
      SELF,
      () => NOON_PT_2026_06_13,
    );
    expect(provider().rpd).toBe(1000);
    // Mutate the base provider between calls — the change must be honored.
    current = { rpm: 50, tpm: 10_000, rpd: 400 };
    expect(provider()).toEqual({ rpm: 50, tpm: 10_000, rpd: 400 });
  });
});

/**
 * Multi-device embedSpend reconciler (A6, design §3.4). Pure app-layer math
 * that turns the synced {@link DeviceInfo} mesh into a BG-lane-only effective
 * RPD ceiling, so the free-tier per-project RPD is correct across the device
 * mesh WITHOUT a kernel change.
 *
 * Lives under `app/` because `app/` is the composition root: it may read the
 * store edge (wireGoogle supplies the device getter). The two exported
 * functions are pure (devices/limits passed in or read via injected getters),
 * which keeps them unit-testable with no store/IDB.
 *
 * Kernel seam: the governor reads its limits FRESH per acquire (GG-8), so the
 * reduced BG ceiling takes effect on the very next bg acquire with ZERO kernel
 * edit — {@link makeBackgroundQuotaLimits} returns exactly the
 * {@link QuotaLimitsProvider} closure the governor already calls.
 */
import type { DeviceInfo } from '~types/device';
import type { QuotaLimits, QuotaLimitsProvider } from '@kernel/quota';

/**
 * The §3.4 heartbeat-active recency window: a sibling device counts toward the
 * cross-device sum only when it touched its record within this window. A
 * net-new constant — the device UI does not literally expose one.
 */
export const ACTIVE_DEVICE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

/** Pad an integer to two digits for the day string. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * The midnight-PT day key (`YYYY-MM-DD` in America/Los_Angeles) for an epoch.
 * MUST match the kernel's day key (QuotaGovernor.ts:142-156) so cross-device
 * stamps align — a mismatched key would silently drop sibling spend. Uses
 * `Intl` so DST is handled by the runtime rather than a hand-rolled offset.
 */
function ptDayString(epochMs: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epochMs));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  // en-CA already yields YYYY-MM-DD, but assemble defensively so locale data
  // changes cannot reorder the key.
  return `${year}-${pad2(Number(month))}-${pad2(Number(day))}`;
}

/**
 * Sum `embedSpend.rpd` over OTHER devices that are heartbeat-active
 * (`nowMs - lastActive < ACTIVE_DEVICE_WINDOW_MS`) AND stamped with today's PT
 * date. Pure. Returns 0 when no device qualifies.
 *
 * EXCLUDES `selfId`: this device's own spend already sits in the governor's own
 * RPD counter (persisted via quotaCounter), so including it would double-count.
 */
export function sumActiveDeviceSpend(
  devices: Record<string, DeviceInfo>,
  selfId: string,
  nowMs: number,
): number {
  const today = ptDayString(nowMs);
  let sum = 0;
  for (const [id, device] of Object.entries(devices)) {
    if (id === selfId) continue; // own spend is already in the governor counter
    const spend = device.embedSpend;
    if (!spend) continue;
    if (nowMs - device.lastActive >= ACTIVE_DEVICE_WINDOW_MS) continue; // idle
    if (spend.day !== today) continue; // stale PT day
    sum += spend.rpd;
  }
  return sum;
}

/**
 * Build the BG-lane limits provider: the base {@link QuotaLimits} with `rpd`
 * reduced by the cross-device sibling sum (clamped `>= 0`, so over-spend
 * siblings cannot push the ceiling negative). The base provider is read FRESH
 * on every call (GG-8 contract) so per-lane settings changes are honored.
 *
 * Only the BG lane is routed through this (wireGoogle) — foreground + query
 * embeds use the unmodified base provider and are NEVER rate-divided
 * (guardrail #4).
 */
export function makeBackgroundQuotaLimits(
  getBaseLimits: () => QuotaLimits,
  getDevices: () => Record<string, DeviceInfo>,
  selfId: string,
  now: () => number = Date.now,
): QuotaLimitsProvider {
  return () => {
    const base = getBaseLimits();
    const siblingSum = sumActiveDeviceSpend(getDevices(), selfId, now());
    return { ...base, rpd: Math.max(0, base.rpd - siblingSum) };
  };
}

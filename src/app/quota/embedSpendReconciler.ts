/**
 * Multi-device embed-spend reconciler. Gemini's free tier caps requests-per-day
 * (RPD) PER PROJECT, but every device sharing one API key spends against that
 * single project budget. Each device publishes its own daily embed spend onto
 * its synced record, and this pure app-layer math sums what the OTHER devices
 * have already spent today and subtracts it from the background lane's RPD
 * ceiling — so background embedding across the whole device mesh stays under the
 * shared per-project cap without any change to the rate-limit governor itself.
 *
 * Lives under `app/` because that is the composition root: it may read the
 * store edge (the wiring layer supplies the device getter). The two exported
 * functions are pure (devices/limits passed in or read via injected getters),
 * which keeps them unit-testable with no store/IDB.
 *
 * The governor re-reads its limits provider on every quota acquire, so the
 * reduced background ceiling takes effect on the very next background acquire
 * with no governor edit — {@link makeBackgroundQuotaLimits} returns exactly the
 * {@link QuotaLimitsProvider} closure the governor already calls.
 *
 * (design: plan/shared-ai-cache-design.md)
 */
import type { DeviceInfo } from '~types/device';
import { ptDayString, type QuotaLimits, type QuotaLimitsProvider } from '@kernel/quota';

/**
 * Recency window for counting a sibling device's spend: a device counts toward
 * the cross-device sum only if it touched its synced record within this window.
 * Bounds the subtraction to devices that are plausibly still spending right now,
 * so a long-idle device cannot keep shrinking this device's ceiling.
 */
export const ACTIVE_DEVICE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

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
 * Build the background-lane limits provider: the base {@link QuotaLimits} with
 * `rpd` reduced by the spend of other active devices (clamped `>= 0`, so devices
 * that have already overspent the shared budget cannot push the ceiling
 * negative). The base provider is read FRESH on every call, so live settings
 * changes are honored.
 *
 * Only the background lane is routed through this. Foreground and search-query
 * embeds use the unmodified base provider and are never rate-divided, so
 * interactive requests never get starved by background work on other devices.
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

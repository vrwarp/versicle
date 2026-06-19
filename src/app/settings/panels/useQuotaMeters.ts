/**
 * useQuotaMeters (A7): live quota meters for the GenAI settings panel.
 *
 * Polls the store-injected `getQuotaSnapshot` (the `governor.snapshot()` mirror
 * wired in src/app/google/wireGoogle.ts) on an interval — the DiagnosticsTab
 * `exportDiagnostics` polling pattern. The project-wide RPD adds the A6
 * cross-device sibling sum to THIS device's own bg.rpd; the reconciler already
 * EXCLUDES this device (its spend lives in the governor counter), so there is no
 * double-count. Every figure derives from the snapshot — nothing fabricated.
 *
 * Co-located (not inlined in GenAIPanel.tsx) so the panel exports only its
 * component (react-refresh/fast-refresh stays clean in the error-level
 * app/settings dir).
 */
import { useState, useEffect } from 'react';
import { useGenAIStore, DEFAULT_QUOTA_LIMITS } from '@store/useGenAIStore';
import { useDeviceStore } from '@store/useDeviceStore';
import { getDeviceId } from '@lib/device-id';
import { sumActiveDeviceSpend } from '@app/quota/embedSpendReconciler';
import type { QuotaMeters } from '@components/settings';

/** How often the live meters re-poll the injected snapshot. */
const METER_POLL_MS = 1000;
/** A rolling minute, for the RPM/TPM fill-rate ETA. */
const WINDOW_MS = 60_000;


/**
 * ms until a metric exhausts at the current fill rate: remaining headroom
 * divided by the per-ms fill (`used / WINDOW_MS`). Returns null when idle (no
 * fill) or already at the limit — the tab renders that as a dash. Pure: derived
 * from the snapshot alone, so the ETA is reproducible from the meters.
 */
function fillEta(used: number, limit: number): number | null {
  if (used <= 0 || used >= limit) return null;
  const ratePerMs = used / WINDOW_MS;
  if (ratePerMs <= 0) return null;
  return (limit - used) / ratePerMs;
}

const EMPTY_METERS: QuotaMeters = {
  fg: { rpm: 0, tpm: 0, rpd: 0, limits: { rpd: 0 } },
  bg: { rpm: 0, tpm: 0, rpd: 0 },
  projectRpd: 0,
  activePools: [],
  etas: {
    rpmMs: null,
    rpmPool: null,
    tpmMs: null,
    tpmPool: null,
    rpdMs: null,
    rpdPool: null,
  },
};

export function useQuotaMeters(): QuotaMeters {
  const getQuotaSnapshot = useGenAIStore((s) => s.getQuotaSnapshot);
  const [meters, setMeters] = useState<QuotaMeters>(EMPTY_METERS);

  useEffect(() => {
    const tick = () => {
      if (!getQuotaSnapshot) {
        return;
      }

      const keys = Array.from(new Set([
        ...Object.keys(DEFAULT_QUOTA_LIMITS),
        ...Object.keys(useGenAIStore.getState().quotaLimitsMap || {})
      ]));

      let totalFgRpm = 0;
      let totalFgTpm = 0;
      let totalFgRpd = 0;
      let totalFgRpdLimit = 0;

      let totalBgRpm = 0;
      let totalBgTpm = 0;
      let totalBgRpd = 0;

      let totalProjectRpd = 0;
      const activePools: string[] = [];

      let minRpmMs: number | null = null;
      let minRpmPool: string | null = null;
      let minTpmMs: number | null = null;
      let minTpmPool: string | null = null;
      let minRpdMs: number | null = null;
      let minRpdPool: string | null = null;

      const activeDevices = useDeviceStore.getState().devices;
      const deviceId = getDeviceId();
      const nowMs = Date.now();

      for (const poolKey of keys) {
        const snapshot = getQuotaSnapshot(poolKey);
        if (!snapshot) continue;

        const { fg, bg } = snapshot;

        totalFgRpm += fg.rpm;
        totalFgTpm += fg.tpm;
        totalFgRpd += fg.rpd;
        totalFgRpdLimit += fg.limits.rpd;

        totalBgRpm += bg.rpm;
        totalBgTpm += bg.tpm;
        totalBgRpd += bg.rpd;

        // Sum this device's own background RPD spend
        totalProjectRpd += bg.rpd;

        if (fg.rpm > 0 || bg.rpm > 0 || fg.rpd > 0 || bg.rpd > 0) {
          activePools.push(poolKey);
        }

        const rpmEta = fillEta(fg.rpm, fg.limits.rpm);
        if (rpmEta !== null) {
          if (minRpmMs === null || rpmEta < minRpmMs) {
            minRpmMs = rpmEta;
            minRpmPool = poolKey;
          }
        }

        const tpmEta = fillEta(fg.tpm, fg.limits.tpm);
        if (tpmEta !== null) {
          if (minTpmMs === null || tpmEta < minTpmMs) {
            minTpmMs = tpmEta;
            minTpmPool = poolKey;
          }
        }

        const poolProjectRpd = bg.rpd + sumActiveDeviceSpend(activeDevices, deviceId, nowMs);
        const rpdEta = fillEta(poolProjectRpd, fg.limits.rpd);
        if (rpdEta !== null) {
          if (minRpdMs === null || rpdEta < minRpdMs) {
            minRpdMs = rpdEta;
            minRpdPool = poolKey;
          }
        }
      }

      // Add the other active devices' spend EXACTLY once
      totalProjectRpd += sumActiveDeviceSpend(activeDevices, deviceId, nowMs);

      setMeters({
        fg: { rpm: totalFgRpm, tpm: totalFgTpm, rpd: totalFgRpd, limits: { rpd: totalFgRpdLimit } },
        bg: { rpm: totalBgRpm, tpm: totalBgTpm, rpd: totalBgRpd },
        projectRpd: totalProjectRpd,
        activePools,
        etas: {
          rpmMs: minRpmMs,
          rpmPool: minRpmPool,
          tpmMs: minTpmMs,
          tpmPool: minTpmPool,
          rpdMs: minRpdMs,
          rpdPool: minRpdPool,
        },
      });
    };

    tick();
    const interval = setInterval(tick, METER_POLL_MS);
    return () => clearInterval(interval);
  }, [getQuotaSnapshot]);

  return meters;
}

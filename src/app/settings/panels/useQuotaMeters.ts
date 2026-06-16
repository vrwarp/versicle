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
import { useGenAIStore } from '@store/useGenAIStore';
import { useDeviceStore } from '@store/useDeviceStore';
import { getDeviceId } from '@lib/device-id';
import { sumActiveDeviceSpend } from '@app/quota/embedSpendReconciler';
import type { QuotaMeters } from '@components/settings';
import type { LaneUsage } from '@kernel/quota';

/** How often the live meters re-poll the injected snapshot. */
const METER_POLL_MS = 1000;
/** A rolling minute, for the RPM/TPM fill-rate ETA. */
const WINDOW_MS = 60_000;

/** Zero usage rendered until wireGoogle installs the snapshot provider. */
const EMPTY_LANE: LaneUsage = {
  rpm: 0,
  tpm: 0,
  rpd: 0,
  limits: { rpm: 0, tpm: 0, rpd: 0 },
};

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

export function useQuotaMeters(): QuotaMeters {
  const getQuotaSnapshot = useGenAIStore((s) => s.getQuotaSnapshot);
  const [meters, setMeters] = useState<QuotaMeters>(() => ({
    fg: EMPTY_LANE,
    bg: EMPTY_LANE,
    projectRpd: 0,
    etas: { rpmMs: null, tpmMs: null, rpdMs: null },
  }));

  useEffect(() => {
    const tick = () => {
      const snapshot = getQuotaSnapshot?.();
      if (!snapshot) {
        return;
      }
      const { fg, bg } = snapshot;
      const projectRpd =
        bg.rpd + sumActiveDeviceSpend(useDeviceStore.getState().devices, getDeviceId(), Date.now());
      setMeters({
        fg,
        bg,
        projectRpd,
        etas: {
          rpmMs: fillEta(fg.rpm, fg.limits.rpm),
          tpmMs: fillEta(fg.tpm, fg.limits.tpm),
          rpdMs: fillEta(projectRpd, fg.limits.rpd),
        },
      });
    };
    tick();
    const interval = setInterval(tick, METER_POLL_MS);
    return () => clearInterval(interval);
  }, [getQuotaSnapshot]);

  return meters;
}

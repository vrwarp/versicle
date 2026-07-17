/**
 * The service-worker boot gate (Phase 8 §G: made HONESTLY soft).
 *
 * The app briefly holds the boot screen for the SW controller because
 * cover images are served through the SW fetch handler — and then proceeds
 * REGARDLESS. That was always the behavior (`waitForServiceWorkerController`
 * resolves on both the 3 s `ready` timeout and controller-poll exhaustion;
 * it never rejects), but the previous code pretended otherwise: an
 * unreachable `swError` state fed a dead "Critical Error" screen in
 * App.tsx. Both are DELETED. Degradation is surfaced instead: when the
 * wait ends without a controller, a one-shot keyed toast tells the user
 * covers/offline assets may not load (production builds only — the
 * E2E/dev lanes run with service workers deliberately blocked).
 *
 * Runs in PARALLEL with the boot sequence — it gates rendering, not the
 * data phases. Pinned by App_SW_Wait.test.tsx.
 */
import { useEffect, useState } from 'react';
import { waitForServiceWorkerController } from '@lib/serviceWorkerUtils';
import { measureSince } from '@lib/perf';
import { useToastStore } from '@store/useToastStore';
import { createLogger } from '@lib/logger';

const logger = createLogger('Boot');

/** Injectable env slice (prod path is untestable otherwise). */
export interface SwGateEnv {
  dev: boolean;
  e2e: boolean;
}

const buildEnv = (): SwGateEnv => ({
  dev: import.meta.env.DEV,
  e2e: import.meta.env.VITE_E2E === 'true',
});

let degradedNotified = false;

/** Test-only: re-arm the one-shot degraded notice between cases. */
export function resetServiceWorkerDegradedNoticeForTests(): void {
  degradedNotified = false;
}

/**
 * One-shot degraded-mode signal: fires a keyed toast when the SW wait
 * ended without a controller (covers will 404 this session). Silent in
 * DEV/E2E builds — those lanes block service workers by design
 * (Playwright `serviceWorkers: 'block'`), and the toast would pollute
 * every journey.
 */
export function notifyServiceWorkerDegradedOnce(
  nav: Pick<Navigator, 'serviceWorker'> = navigator,
  env: SwGateEnv = buildEnv(),
): void {
  if (degradedNotified) return;
  if (nav.serviceWorker?.controller) return;
  degradedNotified = true;
  logger.warn('No service worker controller after boot wait — covers/offline assets degraded.');
  if (env.dev || env.e2e) return;
  useToastStore.getState().showToast('app.swDegraded', 'info', 8000);
}

export function useServiceWorkerGate(): { swInitialized: boolean } {
  const [swInitialized, setSwInitialized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const initSW = async () => {
      const gateStart = performance.now();
      // Never rejects: resolves on controller, `ready` timeout (3 s), or
      // poll exhaustion — the gate is soft by construction.
      await waitForServiceWorkerController();
      measureSince('app:sw-gate', gateStart);
      if (cancelled) return;
      notifyServiceWorkerDegradedOnce();
      setSwInitialized(true);
    };
    void initSW();
    return () => {
      cancelled = true;
    };
  }, []);

  return { swInitialized };
}

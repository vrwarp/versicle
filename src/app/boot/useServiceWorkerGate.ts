/**
 * The service-worker boot gate — soft by construction.
 *
 * The app briefly holds the boot screen for the SW controller because
 * cover images are served through the SW fetch handler — and then proceeds
 * REGARDLESS. `waitForServiceWorkerController` never rejects: it resolves on
 * the controller, the 3 s `ready` timeout, a reported registration failure,
 * or controller-poll exhaustion. Degradation is surfaced instead of blocking:
 * when the wait ends without a controller, a one-shot keyed toast tells the
 * user covers/offline assets may not load (production builds only — the
 * E2E/dev lanes stay silent).
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
 * DEV/E2E builds, where the toast would pollute every journey.
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
      // Never rejects: resolves on controller, `ready` timeout (3 s),
      // registration failure, or poll exhaustion — the gate is soft by
      // construction.
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

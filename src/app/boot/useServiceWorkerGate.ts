/**
 * The service-worker boot gate (moved verbatim from App.tsx): the app waits
 * for the SW controller (covers are served through the SW), surfaces a
 * dedicated critical-error screen if the wait fails, and proceeds either way.
 * Runs in PARALLEL with the boot sequence, exactly as before — it gates
 * rendering, not the data phases. Pinned by App_SW_Wait.test.tsx.
 */
import { useEffect, useState } from 'react';
import { waitForServiceWorkerController } from '@lib/serviceWorkerUtils';
import { createLogger } from '@lib/logger';

const logger = createLogger('Boot');

export function useServiceWorkerGate(): { swInitialized: boolean; swError: string | null } {
  const [swInitialized, setSwInitialized] = useState(false);
  const [swError, setSwError] = useState<string | null>(null);

  useEffect(() => {
    const initSW = async () => {
      try {
        await waitForServiceWorkerController();
      } catch (e) {
        logger.error('Service Worker wait failed:', e);
        setSwError("Service Worker failed to take control. This application requires a Service Worker for image loading. Please reload the page.");
      }
      setSwInitialized(true);
    };
    initSW();
  }, []);

  return { swInitialized, swError };
}

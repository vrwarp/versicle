import { useEffect, type FC } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useToastStore } from '@store/useToastStore';
import { createLogger } from '@lib/logger';

const logger = createLogger('SWUpdatePrompt');

/**
 * The prompt-style service-worker update flow (Phase 8 §G, prep risk #1 —
 * THE riskiest transition of the phase: every later fix ships through this
 * channel).
 *
 * `registerType: 'prompt'` (vite.config.ts) makes a freshly-installed SW
 * WAIT instead of skipWaiting-ing over the running one mid-session. This
 * component owns the user-facing half:
 *
 *  - `useRegisterSW` registers the SW (registration was implicit under
 *    autoUpdate; the virtual module is the documented seam) and flips
 *    `needRefresh` when a new build sits in `waiting`;
 *  - we surface ONE persistent keyed toast ("A new version … — Reload");
 *  - the Reload action calls `updateServiceWorker()`, which posts
 *    SKIP_WAITING to the waiting worker (handled in src/sw.ts) and reloads
 *    the page once it takes control.
 *
 * Mounted in App.tsx ABOVE the router gate, beside ToastHost: even a
 * boot-blocked client can accept the update — the recovery path for a bad
 * deploy is exactly this prompt (prep risk #1 mitigation).
 *
 * Handoff compat: clients still running the fielded autoUpdate SW update
 * onto the first prompt-build silently (the OLD worker skipWaiting-s
 * itself); from then on, updates prompt.
 */
export const SWUpdatePrompt: FC = () => {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error: unknown) {
      // Registration failure degrades to a no-SW session; the boot gate's
      // degraded notice (useServiceWorkerGate) owns the user-facing signal.
      logger.warn('Service worker registration failed:', error);
    },
  });

  useEffect(() => {
    if (!needRefresh) return;
    // Persistent (duration ∞) keyed toast; dedupe-by-message in the queue
    // store makes repeated flips idempotent.
    useToastStore.getState().showToast('app.updateReady', 'info', Infinity, {
      label: 'common.reload',
      onAction: () => {
        void updateServiceWorker(true);
      },
    });
  }, [needRefresh, updateServiceWorker]);

  return null;
};

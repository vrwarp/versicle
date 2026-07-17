import { useEffect, type FC } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useToastStore } from '@store/useToastStore';
import { createLogger } from '@lib/logger';
import { signalServiceWorkerRegistrationFailed } from '@lib/serviceWorkerUtils';

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
 * **Capacitor path**: inside the Capacitor WebView (`https://localhost`),
 * `cap sync` replaces files on disk but the old SW precache serves stale
 * assets. The SW detects Capacitor and calls `skipWaiting()` unconditionally
 * (see src/sw.ts). Since the SW skips waiting immediately, workbox-window's
 * prompt flow never fires `needRefresh` (the `waiting` event is suppressed
 * when the SW activates within 200ms). Instead, we listen for
 * `controllerchange` directly and reload — giving the user the fresh build.
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
      // Release the boot gate NOW: `serviceWorker.ready` never settles after
      // a failed registration, so without this the gate always burns its
      // full 3s timeout (a 3s blank screen on every boot for affected users).
      logger.warn('Service worker registration failed:', error);
      signalServiceWorkerRegistrationFailed();
    },
  });

  // ── Capacitor auto-reload ──────────────────────────────────────────────
  // On Capacitor the SW calls skipWaiting() unconditionally, so the prompt
  // flow is bypassed. Instead, detect the new controller and reload once.
  useEffect(() => {
    if (location.hostname !== 'localhost') return;       // web — use prompt
    if (!('serviceWorker' in navigator)) return;

    // Only reload when a DIFFERENT controller replaces the current one
    // (i.e. an update, not the first install where controller was null).
    const hadController = !!navigator.serviceWorker.controller;
    const onControllerChange = () => {
      if (hadController) {
        logger.info('Capacitor: new service worker took control — reloading.');
        window.location.reload();
      }
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  // ── Web prompt flow ────────────────────────────────────────────────────
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


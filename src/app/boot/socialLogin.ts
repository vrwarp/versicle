/**
 * Social-login (native Google sign-in) initialization — moved out of
 * main.tsx module scope (it ran `SocialLogin.initialize()` plus a store
 * subscription at import time; layering-deps.md LD-6).
 *
 * Initialization is fire-and-forget exactly as before: sign-in is
 * user-triggered, so boot never blocks on the plugin, and a failure only
 * logs (the user sees the error at the sign-in surface, not a dead app).
 */
import type { BootTask } from '../bootstrap';
import { SocialLogin } from '@capgo/capacitor-social-login';
import { useGoogleServicesStore } from '@store/useGoogleServicesStore';
import { createLogger } from '@lib/logger';

const logger = createLogger('Boot');

const initializeSocialLogin = async () => {
  const { googleClientId, googleIosClientId } = useGoogleServicesStore.getState();

  await SocialLogin.initialize({
    google: {
      webClientId: googleClientId || import.meta.env.VITE_GOOGLE_CLIENT_ID,
      iOSClientId: googleIosClientId || import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID,
      mode: 'online',
    },
  });
};

let subscribed = false;

export const socialLoginTask: BootTask = {
  name: 'google/social-login',
  run: (ctx) => {
    initializeSocialLogin().catch(err => logger.warn('SocialLogin init failed:', err));

    // Re-initialize whenever the user changes the configured client IDs.
    // The subscription is app-lifetime and registered once per page load.
    if (!subscribed) {
      subscribed = true;
      const unsubscribe = useGoogleServicesStore.subscribe((state, prevState) => {
        if (
          state.googleClientId !== prevState.googleClientId ||
          state.googleIosClientId !== prevState.googleIosClientId
        ) {
          initializeSocialLogin().catch(err => logger.warn('SocialLogin re-init failed:', err));
        }
      });
      ctx.addCleanup(() => {
        subscribed = false;
        unsubscribe();
      });
    }
  },
};

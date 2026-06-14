/**
 * Vitest stand-in for `virtual:pwa-register/react` (Phase 8 §G).
 *
 * The real module is a vite-plugin-pwa VIRTUAL module — it only exists
 * inside a Vite build with the plugin active, so vitest cannot resolve it.
 * vitest.config.ts aliases the specifier here. The stub mirrors the
 * upstream API shape (vite-plugin-pwa/react.d.ts) with inert state;
 * SWUpdatePrompt.test.tsx vi.mock()s this module to drive `needRefresh`.
 */
import { useState, type Dispatch, type SetStateAction } from 'react';

export interface RegisterSWOptions {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegisteredSW?: (swScriptUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
  onRegisterError?: (error: unknown) => void;
}

export function useRegisterSW(options?: RegisterSWOptions): {
  needRefresh: [boolean, Dispatch<SetStateAction<boolean>>];
  offlineReady: [boolean, Dispatch<SetStateAction<boolean>>];
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
} {
  void options; // inert stub — accepted for signature parity, never read
  const needRefresh = useState(false);
  const offlineReady = useState(false);
  return { needRefresh, offlineReady, updateServiceWorker: async () => {} };
}

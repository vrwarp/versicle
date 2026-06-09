import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

import { SocialLogin } from '@capgo/capacitor-social-login';

import { useGoogleServicesStore } from './store/useGoogleServicesStore';
import { useTTSStore } from './store/useTTSStore';
import { useAnnotationStore } from './store/useAnnotationStore';
import { useReaderUIStore } from './store/useReaderUIStore';

declare global {
  interface Window {
    useTTSStore: typeof useTTSStore;
    useAnnotationStore: typeof useAnnotationStore;
    useGoogleServicesStore: typeof useGoogleServicesStore;
    useReaderUIStore: typeof useReaderUIStore;
    /** Verification hook: boots the TTS engine in a real Web Worker and round-trips through it. */
    __ttsWorkerSmokeTest?: () => Promise<{ ok: boolean; queueLength: number; status: string | null }>;
  }
}

// Expose stores to window for verification tests
if (typeof window !== 'undefined') {
  window.useTTSStore = useTTSStore;
  window.useAnnotationStore = useAnnotationStore;
  window.useGoogleServicesStore = useGoogleServicesStore;
  window.useReaderUIStore = useReaderUIStore;

  // Verification-only: prove the engine genuinely runs in a Web Worker. Boots the worker
  // (which loads the whole engine module graph off-main-thread — exercising worker
  // import-safety), drives a queue/play round-trip, and reports what crossed the boundary.
  // Lazy import keeps the worker out of the main bundle until invoked.
  window.__ttsWorkerSmokeTest = async () => {
    const { createWorkerEngineClient } = await import('./lib/tts/engine/createWorkerEngineClient');
    const client = await createWorkerEngineClient();
    let lastStatus: string | null = null;
    try {
      const unsub = await client.subscribe((status) => { lastStatus = status; });
      await client.engine.setQueue(
        [{ text: 'Worker smoke test sentence.', cfi: 'epubcfi(/6/2!/4/2)', sourceIndices: [0] }],
        0,
      );
      const queue = await client.engine.getQueue();
      unsub();
      return {
        ok: queue.length === 1 && queue[0].text.includes('smoke test'),
        queueLength: queue.length,
        status: lastStatus,
      };
    } finally {
      client.dispose();
    }
  };
}

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

initializeSocialLogin().catch(console.error);

useGoogleServicesStore.subscribe((state, prevState) => {
  if (state.googleClientId !== prevState.googleClientId || state.googleIosClientId !== prevState.googleIosClientId) {
    initializeSocialLogin().catch(console.error);
  }
});

/**
 * Application entry point.
 * Mounts the React app to the DOM.
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

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
    /** Verification hook: boots the TTS engine in a real Web Worker and drives a play cycle. */
    __ttsWorkerSmokeTest?: () => Promise<{
      ok: boolean;
      queueLength: number;
      status: string | null;
      statuses: string[];
      maxIndex: number;
      error?: string;
    }>;
    /** Verification hook: exercises the app-facing engine (always worker-backed). */
    __ttsWorkerHandleTest?: () => Promise<{ engineName: string; voicesIsArray: boolean; ready: boolean }>;
  }
}

// Typed E2E test API (window.__versicleTest): flushPersistence/resetApp.
// DEV + E2E builds only (Dockerfile.verification sets VITE_E2E=true); the
// gate keeps the module out of the production execution path.
if (import.meta.env.DEV || import.meta.env.VITE_E2E === 'true') {
  void import('./lib/test-api')
    .then(({ installTestApi }) => installTestApi())
    .catch((error) => console.error('Failed to install test API:', error));
}

// Expose stores to window for verification tests
if (typeof window !== 'undefined') {
  window.useTTSStore = useTTSStore;
  window.useAnnotationStore = useAnnotationStore;
  window.useGoogleServicesStore = useGoogleServicesStore;
  window.useReaderUIStore = useReaderUIStore;

  // Verification-only: prove the engine genuinely runs in a Web Worker AND that a full play
  // cycle crosses the boundary: command in (play), backend command out (synthesis), provider
  // events in (start/end — injected manually so headless browsers are deterministic), status
  // broadcasts + queue advance out. Boots the worker, which loads the whole engine module
  // graph off-main-thread (exercising worker import-safety).
  // Lazy import keeps the worker out of the main bundle until invoked.
  window.__ttsWorkerSmokeTest = async () => {
    const { createWorkerEngineClient } = await import('./lib/tts/engine/createWorkerEngineClient');
    const client = await createWorkerEngineClient();
    const events: Array<{ status: string; index: number }> = [];
    let lastStatus: string | null = null;
    const waitFor = async (predicate: () => boolean, label: string) => {
      const deadline = Date.now() + 10000;
      while (!predicate()) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${label} (saw: ${JSON.stringify(events)})`);
        await new Promise((r) => setTimeout(r, 50));
      }
    };
    try {
      const unsub = await client.subscribe((status, _cfi, currentIndex) => {
        lastStatus = status;
        events.push({ status, index: currentIndex });
      });
      await client.engine.setQueue(
        [
          { text: 'Worker smoke test sentence one.', cfi: 'epubcfi(/6/2!/4/2)', sourceIndices: [0] },
          { text: 'Worker smoke test sentence two.', cfi: 'epubcfi(/6/2!/4/4)', sourceIndices: [1] },
        ],
        0,
      );
      const queue = await client.engine.getQueue();

      // Drive a full play cycle. Provider start/end events are injected via the same
      // dispatch path the real main-thread backend uses.
      await client.engine.play();
      await client.engine.dispatchBackendEvent({ type: 'start' });
      await waitFor(() => events.some((e) => e.status === 'playing'), "status 'playing'");
      await client.engine.dispatchBackendEvent({ type: 'end' });
      await waitFor(() => events.some((e) => e.index === 1), 'advance to index 1');
      await client.engine.dispatchBackendEvent({ type: 'start' });
      await client.engine.dispatchBackendEvent({ type: 'end' });
      await waitFor(() => events.some((e) => e.status === 'completed'), "status 'completed'");

      unsub();
      return {
        ok: queue.length === 2 && queue[0].text.includes('smoke test'),
        queueLength: queue.length,
        status: lastStatus,
        statuses: [...new Set(events.map((e) => e.status))],
        maxIndex: Math.max(...events.map((e) => e.index)),
      };
    } catch (e) {
      return { ok: false, queueLength: -1, status: lastStatus, statuses: [...new Set(events.map((ev) => ev.status))], maxIndex: -1, error: String(e) };
    } finally {
      client.dispose();
    }
  };

  // Verification-only: prove the app-facing engine (getAudioPlayer) is the worker-backed handle
  // and that a store-facing call (getVoices) routes through the worker to the main-thread
  // backend and back.
  window.__ttsWorkerHandleTest = async () => {
    const { getAudioPlayer } = await import('./lib/tts/engine/mainThreadAudioPlayer');
    const engine = getAudioPlayer();
    await engine.whenReady();
    const voices = await engine.getVoices();
    return {
      engineName: engine.engineName,
      voicesIsArray: Array.isArray(voices),
      ready: true,
    };
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

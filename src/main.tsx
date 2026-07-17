import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

import { measureSince } from '@lib/perf';
import { useGoogleServicesStore } from './store/useGoogleServicesStore';
import { useTTSSettingsStore } from './store/useTTSSettingsStore';
import { useTTSPlaybackStore } from './store/useTTSPlaybackStore';
import { useAnnotationStore } from './store/useAnnotationStore';
import { useReaderUIStore } from './store/useReaderUIStore';

// The legacy `window.useTTSStore` shim (playback reads + play/pause for the
// verification specs) met its named P9 deadline: the specs read
// `useTTSPlaybackStore` directly and drive commands through the typed
// `window.__versicleTest.tts` surface (src/test-api.ts).

declare global {
  interface Window {
    useTTSSettingsStore: typeof useTTSSettingsStore;
    useTTSPlaybackStore: typeof useTTSPlaybackStore;
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
  void import('./test-api')
    .then(({ installTestApi }) => installTestApi())
    .catch((error) => console.error('Failed to install test API:', error));
}

// Expose stores to window for verification tests
if (typeof window !== 'undefined') {
  window.useTTSSettingsStore = useTTSSettingsStore;
  window.useTTSPlaybackStore = useTTSPlaybackStore;
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
    const { createWorkerEngineClient } = await import('./app/tts/createWorkerEngineClient');
    const client = await createWorkerEngineClient();
    const events: Array<{ status: string; index: number }> = [];
    let lastStatus: string | null = null;
    const waitFor = async (predicate: () => boolean, label: string) => {
      // 30s: WebKit's worker/Comlink round-trip is markedly slower than Chromium,
      // so the play-cycle snapshot events take longer to cross the boundary.
      const deadline = Date.now() + 30000;
      while (!predicate()) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${label} (saw: ${JSON.stringify(events)})`);
        await new Promise((r) => setTimeout(r, 50));
      }
    };
    try {
      const unsub = await client.subscribe((snap) => {
        lastStatus = snap.status;
        events.push({ status: snap.status, index: snap.index });
      });
      await client.engine.setQueue(
        [
          { text: 'Worker smoke test sentence one.', cfi: 'epubcfi(/6/2!/4/2)', sourceIndices: [0] },
          { text: 'Worker smoke test sentence two.', cfi: 'epubcfi(/6/2!/4/4)', sourceIndices: [1] },
        ],
        0,
      );
      // Poll getQueue: setQueue's command ack can resolve before the worker has
      // applied the queue to the state getQueue reads (the round-trip is slower on
      // WebKit), so a single read right after setQueue can race to 0.
      let queue = await client.engine.getQueue();
      for (let i = 0; i < 40 && queue.length !== 2; i++) {
        await new Promise((r) => setTimeout(r, 50));
        queue = await client.engine.getQueue();
      }

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
    const { getAudioPlayer } = await import('./app/tts/mainThreadAudioPlayer');
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

// SocialLogin initialization (and its re-init store subscription) used to run
// here at module scope; it is now the `google/social-login` boot task
// (src/app/boot/socialLogin.ts) sequenced by src/app/bootstrap.ts.

// Boot milestone: everything above (the entire static import graph of the
// entry chunk) has now fetched, parsed and evaluated. Duration is measured
// from the navigation timeOrigin, so this entry ≈ network + parse + eval of
// the entry bundle.
measureSince('app:entry-eval', 0);

/**
 * Application entry point.
 * Mounts the React app to the DOM.
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

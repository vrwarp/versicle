/**
 * Main-thread composition root for the TTS engine.
 *
 * This is the ONE place that wires the production engine to its main-thread-only
 * dependencies: the Zustand-backed {@link createZustandEngineContext} (which pulls in
 * `localStorage`-backed store persistence) and {@link TTSProviderManager} (which pulls in
 * `@capacitor/core`). Keeping these imports here — rather than as defaults inside
 * `AudioPlayerService.ts` — is what makes the engine module itself worker-importable: a
 * Worker constructs the engine via `createWithContext` with its own context + backend and
 * never loads this file.
 *
 * `getAudioPlayer()` returns the engine the app talks to. By default that's the in-process
 * {@link AudioPlayerService}; when worker mode is enabled (see {@link isWorkerEngineEnabled})
 * it's a {@link WorkerEngineHandle} that runs the engine off the main thread. Both satisfy the
 * {@link TtsEngine} interface, so call sites don't change.
 */
import { AudioPlayerService, type TtsEngine } from '../AudioPlayerService';
import { createZustandEngineContext } from './createZustandEngineContext';
import { TTSProviderManager } from '../TTSProviderManager';
import { PlatformIntegration } from '../PlatformIntegration';
import { WorkerEngineHandle } from './WorkerEngineHandle';

let instance: TtsEngine | null = null;

/**
 * Whether to run the TTS engine in a Web Worker. Off by default; opt in at runtime by setting
 * `localStorage['tts:worker'] = '1'` (or the `VITE_TTS_WORKER=true` build env). Read once, the
 * first time the engine is built.
 */
export function isWorkerEngineEnabled(): boolean {
    try {
        if (typeof localStorage !== 'undefined' && localStorage.getItem('tts:worker') === '1') return true;
    } catch {
        // localStorage may be unavailable (SSR / sandboxed) — fall through.
    }
    return import.meta.env?.VITE_TTS_WORKER === 'true';
}

/**
 * The single production TTS engine, lazily built. In-process by default; worker-backed when
 * {@link isWorkerEngineEnabled} is true. There is one audio-output device, so one instance is
 * correct.
 */
export function getAudioPlayer(): TtsEngine {
    if (!instance) {
        instance = isWorkerEngineEnabled()
            ? new WorkerEngineHandle()
            : AudioPlayerService.createWithContext(
                createZustandEngineContext(),
                (events) => new TTSProviderManager(events),
                (events) => new PlatformIntegration(events),
            );
    }
    return instance;
}

/** Test-only: drop the cached instance so the next {@link getAudioPlayer} rebuilds it. */
export function resetAudioPlayerForTests(): void {
    instance = null;
}

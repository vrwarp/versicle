/**
 * Main-thread composition root for the TTS engine.
 *
 * Production runs the engine in a Web Worker: {@link getAudioPlayer} returns a
 * {@link WorkerEngineHandle} that drives a worker-resident {@link AudioPlayerService} (see
 * createWorkerEngineClient / tts.worker.ts). The handle satisfies the {@link TtsEngine}
 * interface, so `useTTSStore` / `useTTS` / `ReaderView` call sites are unchanged.
 *
 * The in-process builder ({@link getInProcessAudioPlayer}) exists for unit-testing the engine
 * class directly (a real Worker can't run under jsdom). It is the ONE place that pulls the
 * main-thread-only deps (`createZustandEngineContext`, `TTSProviderManager`,
 * `PlatformIntegration`) — keeping them out of `AudioPlayerService.ts` is what makes the engine
 * module worker-importable.
 */
import { AudioPlayerService, type TtsEngine } from '../../lib/tts/AudioPlayerService';
import { createZustandEngineContext } from './createZustandEngineContext';
import { TTSProviderManager } from '../../lib/tts/TTSProviderManager';
import { PlatformIntegration } from '../../lib/tts/PlatformIntegration';
import { WorkerEngineHandle } from '../../lib/tts/engine/WorkerEngineHandle';

let instance: TtsEngine | null = null;

/**
 * The single production TTS engine: a {@link WorkerEngineHandle} that runs the engine in a Web
 * Worker. This is the ONLY production path — there is no runtime engine-selection branch. The
 * handle itself degrades to a no-op where `Worker` is unavailable (jsdom/SSR), so this stays a
 * single code path everywhere. There is one audio-output device, so one instance is correct.
 */
export function getAudioPlayer(): TtsEngine {
    if (!instance) {
        instance = new WorkerEngineHandle();
    }
    return instance!;
}

let inProcessInstance: AudioPlayerService | null = null;

/**
 * Build (and cache) an in-process `AudioPlayerService` wired to the live stores + real backend.
 * For unit tests that exercise the engine class directly, where a Web Worker isn't available.
 */
export function getInProcessAudioPlayer(): AudioPlayerService {
    if (!inProcessInstance) {
        inProcessInstance = AudioPlayerService.createWithContext(
            createZustandEngineContext(),
            (events) => new TTSProviderManager(events),
            (events) => new PlatformIntegration(events),
        );
    }
    return inProcessInstance;
}

/** Test-only: drop the cached in-process instance so the next build is fresh. */
export function resetInProcessAudioPlayerForTests(): void {
    inProcessInstance = null;
}

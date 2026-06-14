/**
 * Main-thread composition root for the TTS engine.
 *
 * Production runs the engine in a Web Worker: {@link getAudioPlayer} returns a
 * {@link WorkerEngineHandle} that drives a worker-resident {@link PlaybackController} (see
 * createWorkerEngineClient / tts.worker.ts). The handle satisfies the {@link TtsEngine}
 * interface, so TtsController/useAudioCommands call sites are unchanged.
 *
 * (The in-process builder that lived here for unit tests died in the P9 knip
 * sweep: engine suites construct PlaybackController through the
 * FakeEngineContext / parityHostDb ports directly.)
 */
import type { TtsEngine } from '@lib/tts/engine/TtsEngine';
import { WorkerEngineHandle } from './WorkerEngineHandle';

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


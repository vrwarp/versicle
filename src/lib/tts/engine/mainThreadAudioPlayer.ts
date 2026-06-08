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
 * Production code uses `getAudioPlayer()` instead of the old `AudioPlayerService.getInstance()`.
 */
import { AudioPlayerService } from '../AudioPlayerService';
import { createZustandEngineContext } from './createZustandEngineContext';
import { TTSProviderManager } from '../TTSProviderManager';

let instance: AudioPlayerService | null = null;

/**
 * The single production AudioPlayerService, lazily built and wired to the live Zustand
 * stores + Capacitor. There is one audio-output device, so one instance is correct.
 */
export function getAudioPlayer(): AudioPlayerService {
    if (!instance) {
        instance = AudioPlayerService.createWithContext(
            createZustandEngineContext(),
            (events) => new TTSProviderManager(events),
        );
    }
    return instance;
}

/** Test-only: drop the cached instance so the next {@link getAudioPlayer} rebuilds it. */
export function resetAudioPlayerForTests(): void {
    instance = null;
}

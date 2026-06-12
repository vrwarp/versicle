/**
 * PlaybackBackend — the audio synthesis + playback boundary.
 *
 * `PlaybackController` (the orchestration "brain") talks to the audio/provider layer ONLY
 * through this interface. Everything behind it is main-thread-bound: native speech engines
 * (`speechSynthesis`, Capacitor TTS) and cloud-provider playback through the {@link AudioSink}
 * (`HTMLAudioElement`). None of that can run in a Web Worker.
 *
 * This is exactly the seam a worker topology needs: the orchestration runs in the worker
 * with a *proxy* backend whose calls are forwarded (via Comlink/postMessage) to a real
 * `TTSProviderManager` living on the main thread, which posts playback events back. Because
 * `PlaybackController` depends on this interface — not the concrete `TTSProviderManager` —
 * the orchestration code does not change when it moves across the boundary.
 *
 * The production implementation is {@link TTSProviderManager}. Tests use `FakePlaybackBackend`.
 */
import type { ITTSProvider, TTSVoice } from '../providers/types';
// Type-only import — erased at runtime, so this does NOT pull TTSProviderManager (and its
// Capacitor dependency) into a worker bundle.
import type { TTSProviderEvents } from '../TTSProviderManager';

export type { TTSProviderEvents };

/**
 * The command surface `PlaybackController` invokes on the audio backend. A worker proxy and
 * the in-process `TTSProviderManager` both satisfy it.
 */
export interface PlaybackBackend {
    init(): Promise<void>;
    play(text: string, options: { voiceId: string; speed: number }): Promise<void>;
    preload(text: string, options: { voiceId: string; speed: number }): void;
    pause(): void;
    stop(): void;
    getVoices(): Promise<TTSVoice[]>;
    /**
     * Swap the active provider by id. The id is plain data, so the call behaves identically
     * in-process and across the worker boundary; the main-thread implementation constructs
     * the live provider from the registry descriptor with an injected ProviderBuildContext.
     */
    setProviderById(providerId: string): void;
    /**
     * Optional in-process-only seam: install a live provider instance directly. Used by
     * backend-level tests to inject fakes; a worker proxy cannot (and does not) implement it.
     */
    setProvider?(provider: ITTSProvider): void;
    setLocale(locale: string): void;
    playEarcon(type: 'bookmark_captured' | 'bookmark_failed'): void;
    downloadVoice(voiceId: string): Promise<void>;
    deleteVoice(voiceId: string): Promise<void>;
    isVoiceDownloaded(voiceId: string): Promise<boolean>;
}

/**
 * Builds a {@link PlaybackBackend} bound to the given event callbacks. The engine constructs
 * its event handlers, then asks the factory to produce a backend wired to them. The main
 * thread supplies `(events) => new TTSProviderManager(events)`; a worker host supplies a
 * factory that returns a message-channel proxy.
 */
export type PlaybackBackendFactory = (events: TTSProviderEvents) => PlaybackBackend;

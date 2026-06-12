import { ProviderPlaybackError, isPlaybackInterruption } from './providers/types';
import type { ITTSProvider, TTSVoice, Unsubscribe } from './providers/types';
import { WebSpeechProvider } from './providers/WebSpeechProvider';
import { CapacitorTTSProvider } from './providers/CapacitorTTSProvider';
import { asLocaleAware, asVoiceDownloadable, resolveDescriptor } from './providers/registry';
import type { ProviderBuildContext } from './providers/registry';
import { Capacitor } from '@capacitor/core';
import type { PlaybackBackend } from './engine/PlaybackBackend';
import type { AudioSink } from './engine/AudioSink';
import { AudioElementPlayer } from './AudioElementPlayer';

/**
 * Supplies the construction inputs (API key, language) for a provider id. The
 * composition roots inject a store-backed source
 * (`@app/tts/providerBuildContext`); lib/tts itself never reads a store — the
 * 5a-PR3 ctx-passing flip that deleted `providerFactory.ts` and its
 * lib→store edge.
 */
export type ProviderBuildContextSource = (providerId: string) => Omit<ProviderBuildContext, 'sink'>;

/**
 * Interface defining the events emitted by the TTSProviderManager.
 */
export interface TTSProviderEvents {
    /** Triggered when playback starts. */
    onStart: () => void;
    /** Triggered when playback completes successfully. */
    onEnd: () => void;
    /**
     * Triggered when an error occurs DURING playback (after play() resolved).
     * Failures to start playback reject from {@link TTSProviderManager.play}
     * instead (single failure path, 5a-PR2) — they never arrive here.
     * @param error The error object or message.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (error: any) => void;
    /**
     * Triggered periodically during playback with the current timestamp.
     * @param currentTime The current playback position in seconds.
     */
    onTimeUpdate: (currentTime: number) => void;
    /**
     * Triggered during voice download progress.
     * @param voiceId The ID of the voice being downloaded.
     * @param percent The progress percentage (0-100).
     * @param status A status message.
     */
    onDownloadProgress: (voiceId: string, percent: number, status: string) => void;
}

/**
 * Manages the lifecycle and selection of Text-to-Speech providers: a dumb holder
 * (Phase 5a-PR2). On swap it detaches its listener from and disposes the outgoing
 * provider, and injects ONE shared {@link AudioSink} into providers that play
 * synthesized audio. It normalizes provider events (interruption filtering) and
 * rethrows play failures as typed {@link ProviderPlaybackError}s — it performs NO
 * self-swap and emits NO synthetic `{type:'fallback'}` events. The fallback POLICY
 * lives in the engine (`PlaybackController.recoverWithLocalProvider`), which calls
 * back through {@link setProviderById} — the S2 double-fire is structurally dead.
 */
export class TTSProviderManager implements PlaybackBackend {
    private provider: ITTSProvider;
    private events: TTSProviderEvents;
    /** Detach handle for the listener registered on the CURRENT provider. */
    private detachProviderListener: Unsubscribe | null = null;
    /** The one shared audio-output device, injected into every cloud/wasm provider. */
    private sharedSink: AudioSink | null;
    /** Injected build-context source (store-backed in production; inert default in tests). */
    private readonly getBuildContext: ProviderBuildContextSource;

    /**
     * Creates a new TTSProviderManager.
     * Automatically selects the appropriate provider based on the platform.
     *
     * @param {TTSProviderEvents} events Callback handlers for provider events.
     * @param sink Optional shared sink (tests inject a FakeAudioSink); created
     *   lazily as an {@link AudioElementPlayer} on first cloud/wasm build otherwise.
     * @param getBuildContext Per-provider construction inputs (API key, language).
     *   Production injects the store-backed source from the composition root;
     *   the default supplies no key and 'en' (device providers need neither).
     */
    constructor(events: TTSProviderEvents, sink?: AudioSink, getBuildContext?: ProviderBuildContextSource) {
        this.events = events;
        this.sharedSink = sink ?? null;
        this.getBuildContext = getBuildContext ?? (() => ({ language: 'en' }));
        if (Capacitor.isNativePlatform()) {
            this.provider = new CapacitorTTSProvider();
        } else {
            this.provider = new WebSpeechProvider();
        }
        this.setupProviderListeners();
    }

    /** The lazily-created shared sink (one HTMLAudioElement for every provider swap). */
    private getSharedSink(): AudioSink {
        if (!this.sharedSink) {
            this.sharedSink = new AudioElementPlayer();
        }
        return this.sharedSink;
    }

    private setupProviderListeners() {
        this.detachProviderListener = this.provider.on((event) => {
            if (event.type === 'start') {
                this.events.onStart();
            } else if (event.type === 'end') {
                this.events.onEnd();
            } else if (event.type === 'error') {
                // Event normalization: deliberate interruptions (cancel/stop) are not
                // errors. Everything else forwards verbatim — recovery policy is the
                // engine's call, not the backend's.
                if (isPlaybackInterruption(event.error)) return;

                console.error("TTS Provider Error", event.error);
                this.events.onError(event.error);
            } else if (event.type === 'timeupdate') {
                this.events.onTimeUpdate(event.currentTime);
            } else if (event.type === 'download-progress') {
                this.events.onDownloadProgress(event.voiceId, event.percent, event.status);
            }
        });
    }

    /**
     * Initializes the underlying TTS provider.
     */
    async init() {
        await this.provider.init();
    }

    /**
     * Starts playback of the given text. Resolves when audible playback starts.
     *
     * Single failure path (5a-PR2): a failure to start REJECTS exactly once —
     * interruptions rethrow raw (never fallback-worthy); real failures rethrow as
     * {@link ProviderPlaybackError} with the failing provider's id. No self-swap,
     * no `{type:'fallback'}` event: the engine decides whether to recover.
     *
     * @param {string} text The text to speak.
     * @param {object} options Playback options.
     * @param {string} options.voiceId The ID of the voice to use.
     * @param {number} options.speed The playback speed factor.
     */
    async play(text: string, options: { voiceId: string, speed: number }) {
        try {
            return await this.provider.play(text, options);
        } catch (e) {
            if (isPlaybackInterruption(e)) {
                throw e;
            }
            console.error("TTS Provider Play Error", e);
            throw new ProviderPlaybackError(this.provider.id, e);
        }
    }

    /**
     * Pauses the current playback.
     */
    pause() {
        this.provider.pause();
    }

    /**
     * Stops the current playback.
     */
    stop() {
        this.provider.stop();
    }

    /**
     * Retrieves the list of available voices.
     * @returns {Promise<TTSVoice[]>} A promise resolving to an array of voices.
     */
    async getVoices(): Promise<TTSVoice[]> {
        return this.provider.getVoices();
    }

    /**
     * Preloads audio for the given text to reduce latency.
     *
     * @param {string} text The text to preload.
     * @param {object} options Playback options.
     */
    preload(text: string, options: { voiceId: string, speed: number }) {
        this.provider.preload(text, options);
    }

    /**
     * Swaps the active provider by id: descriptor-driven construction with an
     * explicitly passed {@link ProviderBuildContext} (injected source + the
     * manager's shared sink) — no store reach-in anywhere on this path.
     */
    setProviderById(providerId: string) {
         const descriptor = resolveDescriptor(providerId);
         this.setProvider(descriptor.build({
             ...this.getBuildContext(providerId),
             sink: this.getSharedSink(),
         }));
    }

    /**
     * Explicitly sets the provider instance (in-process/test seam).
     *
     * Swap hygiene (5a-PR2): the outgoing provider's listener is detached and the
     * provider disposed BEFORE the incoming one wires up — a stale provider can
     * neither emit into the engine nor hold engine resources (S12 leak).
     *
     * @param {ITTSProvider} provider The new provider to use.
     */
    setProvider(provider: ITTSProvider) {
         this.detachProviderListener?.();
         this.detachProviderListener = null;
         this.provider.stop();
         this.provider.dispose();
         this.provider = provider;
         this.setupProviderListeners();
    }

    /**
     * Gets the ID of the current provider.
     */
    get providerId() {
        return this.provider.id;
    }

    /**
     * Plays an earcon and ducks the underlying TTS audio if supported.
     */
    playEarcon(type: 'bookmark_captured' | 'bookmark_failed'): void {
        if (typeof this.provider.playEarcon === 'function') {
            this.provider.playEarcon(type);
        }
    }

    /**
     * Voice download routing, driven by the registry's capability descriptor
     * ({@link asVoiceDownloadable}) instead of `id === 'piper' … as any` probing.
     * Non-capable providers are a silent no-op (their voices aren't artifacts).
     */
    async downloadVoice(voiceId: string): Promise<void> {
        const downloadable = asVoiceDownloadable(this.provider);
        if (downloadable) {
            await downloadable.downloadVoice(voiceId);
        }
    }

    async deleteVoice(voiceId: string): Promise<void> {
        const downloadable = asVoiceDownloadable(this.provider);
        if (downloadable) {
            await downloadable.deleteVoice(voiceId);
        }
    }

    /**
     * Whether the voice's artifact is present locally. `false` for providers without
     * downloadable voices — the pre-registry `true` was a UI lie ("downloaded" for
     * voices that aren't artifacts at all); the settings UI gates the download panel
     * on the descriptor capability, never on this answer.
     */
    async isVoiceDownloaded(voiceId: string): Promise<boolean> {
        const downloadable = asVoiceDownloadable(this.provider);
        if (downloadable) {
            return await downloadable.isVoiceDownloaded(voiceId);
        }
        return false;
    }

    /**
     * Sets the locale for the current provider (locale-aware providers only —
     * descriptor-driven guard).
     */
    setLocale(locale: string) {
        asLocaleAware(this.provider)?.setLocale(locale);
    }
}

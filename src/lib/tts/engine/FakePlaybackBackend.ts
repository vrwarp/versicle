/**
 * FakePlaybackBackend — a deterministic in-memory {@link PlaybackBackend} for unit tests.
 *
 * Records the commands the `PlaybackController` issues and captures the event callbacks so a
 * test can drive the playback lifecycle (`fireStart` / `fireEnd` / `fireError` / …) without
 * any real provider, `speechSynthesis`, `HTMLAudioElement`, or network access.
 *
 * Use the static {@link FakePlaybackBackend.factory} as the `PlaybackBackendFactory` passed
 * to `PlaybackController.createWithContext`.
 */
import type { ITTSProvider, TTSVoice } from '../providers/types';
import type { PlaybackBackend, PlaybackBackendFactory, TTSProviderEvents } from './PlaybackBackend';

export class FakePlaybackBackend implements PlaybackBackend {
    readonly events: TTSProviderEvents;

    // --- Recorded commands ---
    readonly played: Array<{ text: string; voiceId: string; speed: number }> = [];
    readonly preloaded: Array<{ text: string; voiceId: string; speed: number }> = [];
    readonly earcons: Array<'bookmark_captured' | 'bookmark_failed'> = [];
    initCount = 0;
    pauseCount = 0;
    stopCount = 0;
    locale: string | null = null;
    voices: TTSVoice[] = [];
    downloadedVoices = new Set<string>();
    /** Provider ids requested via the uniform by-id API. */
    readonly providerIds: string[] = [];
    /** The provider the backend currently routes to ('local' initially, like the manager). */
    currentProviderId = 'local';
    private failNext: { message: string } | null = null;

    /** A PlaybackBackendFactory that produces a shared instance, captured here for assertions. */
    static factory(): { factory: PlaybackBackendFactory; get(): FakePlaybackBackend | null } {
        let created: FakePlaybackBackend | null = null;
        return {
            factory: (events) => (created = new FakePlaybackBackend(events)),
            get: () => created,
        };
    }

    constructor(events: TTSProviderEvents) {
        this.events = events;
    }

    async init(): Promise<void> {
        this.initCount++;
    }
    /**
     * Arm the backend so the next play() on a non-'local' provider REJECTS once with a
     * `ProviderPlaybackError`-named error — TTSProviderManager's post-5a-PR2 single
     * failure path (no self-swap, no synthetic `{type:'fallback'}` event; the engine
     * owns recovery and swaps via setProviderById). The error is built by name, not
     * class, exactly as it survives the worker boundary (Comlink keeps only
     * message/name/stack).
     */
    failNextPlay(error: { message: string }): void {
        this.failNext = error;
    }

    async play(text: string, options: { voiceId: string; speed: number }): Promise<void> {
        this.played.push({ text, ...options });
        const failure = this.failNext;
        if (failure && this.currentProviderId !== 'local') {
            this.failNext = null;
            const err = new Error(`Provider '${this.currentProviderId}' failed to start playback: ${failure.message}`);
            err.name = 'ProviderPlaybackError';
            throw err;
        }
    }
    preload(text: string, options: { voiceId: string; speed: number }): void {
        this.preloaded.push({ text, ...options });
    }
    pause(): void {
        this.pauseCount++;
    }
    stop(): void {
        this.stopCount++;
    }
    async getVoices(): Promise<TTSVoice[]> {
        return this.voices;
    }
    setProviderById(providerId: string): void {
        this.providerIds.push(providerId);
        this.currentProviderId = providerId;
    }
    setProvider(_provider: ITTSProvider): void {
        // no-op for tests
    }
    setLocale(locale: string): void {
        this.locale = locale;
    }
    playEarcon(type: 'bookmark_captured' | 'bookmark_failed'): void {
        this.earcons.push(type);
    }
    async downloadVoice(voiceId: string): Promise<void> {
        this.downloadedVoices.add(voiceId);
    }
    async deleteVoice(voiceId: string): Promise<void> {
        this.downloadedVoices.delete(voiceId);
    }
    async isVoiceDownloaded(voiceId: string): Promise<boolean> {
        return this.downloadedVoices.has(voiceId);
    }

    // --- Test-side lifecycle triggers (what the real provider would emit) ---
    fireStart() {
        this.events.onStart();
    }
    fireEnd() {
        this.events.onEnd();
    }
    fireError(error: unknown) {
        this.events.onError(error);
    }
    fireTimeUpdate(currentTime: number) {
        this.events.onTimeUpdate(currentTime);
    }
}

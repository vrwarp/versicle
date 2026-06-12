/**
 * FakePlaybackBackend — a deterministic in-memory {@link PlaybackBackend} for unit tests.
 *
 * Records the commands `AudioPlayerService` issues and captures the event callbacks so a
 * test can drive the playback lifecycle (`fireStart` / `fireEnd` / `fireError` / …) without
 * any real provider, `speechSynthesis`, `HTMLAudioElement`, or network access.
 *
 * Use the static {@link FakePlaybackBackend.factory} as the `PlaybackBackendFactory` passed
 * to `AudioPlayerService.createWithContext`.
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
     * Arm the backend so the next play() on a non-'local' provider fails over, replicating
     * TTSProviderManager's CURRENT fallback semantics (the S2 double-fire): the provider's
     * error event (TTSProviderManager.ts event path) AND the play-catch path BOTH emit
     * `{type:'fallback'}` and swap to the local provider. Events fire on microtasks to mirror
     * the async event delivery of the real providers (and of the worker transport).
     * 5a-PR2 collapses production to a single rejection path; the P21 `it.fails` rider in
     * engineParityScenarios.ts tracks that flip.
     */
    failNextPlay(error: { message: string }): void {
        this.failNext = error;
    }

    async play(text: string, options: { voiceId: string; speed: number }): Promise<void> {
        this.played.push({ text, ...options });
        const failure = this.failNext;
        if (failure && this.currentProviderId !== 'local') {
            this.failNext = null;
            this.currentProviderId = 'local';
            queueMicrotask(() => this.events.onError({ type: 'fallback', message: failure.message }));
            queueMicrotask(() => this.events.onError({ type: 'fallback', message: failure.message }));
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fireError(error: any) {
        this.events.onError(error);
    }
    fireTimeUpdate(currentTime: number) {
        this.events.onTimeUpdate(currentTime);
    }
}

/**
 * WorkerTtsEngine — the worker-resident host for the TTS orchestration brain.
 *
 * It runs a real {@link AudioPlayerService} inside the Worker, wired to:
 *  - a {@link WorkerEngineContext} (host state replicated from the main thread), and
 *  - a *proxy* {@link PlaybackBackend} + {@link MediaPlatform} whose methods call back to the
 *    main thread (where the real providers, `HTMLAudioElement`, and `navigator.mediaSession`
 *    live) and whose events are pushed back in via {@link dispatchBackendEvent}.
 *
 * The class is exposed over Comlink (see `src/workers/tts.worker.ts`). It is transport
 * agnostic — `WorkerTtsEngine.test.ts` drives it over a `MessageChannel` to verify the full
 * round-trip without spawning an OS thread.
 */
import * as Comlink from 'comlink';
import { AudioPlayerService, type TTSQueueItem, type TTSStatus, type SnapshotListener } from '../AudioPlayerService';
import { WorkerEngineContext, type EngineStateUpdate, type EngineHostCommand } from './WorkerEngineContext';
import type { PlaybackBackend, TTSProviderEvents } from './PlaybackBackend';
import type { MediaPlatform } from '../PlatformIntegration';
import type { TTSVoice } from '../providers/types';
import type { LexiconRule, ContentAnalysis, BookMetadata, GenAIPort } from './EngineContext';
import type { MediaSessionMetadata } from '../MediaSessionManager';
import type { BackgroundAudioMode } from '../BackgroundAudio';

/** Backend (provider) events the main-thread host forwards into the worker. */
export type BackendEvent =
    | { type: 'start' }
    | { type: 'end' }
    | { type: 'error'; error: unknown }
    | { type: 'timeupdate'; currentTime: number }
    | { type: 'downloadProgress'; voiceId: string; percent: number; status: string };

/**
 * The main-thread surface the worker calls back into (passed in as a Comlink proxy). It owns
 * the real audio backend, the media-session/background-audio platform, and the Zustand stores.
 */
export interface EngineHost {
    platformName(): string;

    // Playback backend (the real TTSProviderManager + providers + AudioSink).
    backendInit(): Promise<void>;
    backendPlay(text: string, options: { voiceId: string; speed: number }): Promise<void>;
    backendPreload(text: string, options: { voiceId: string; speed: number }): Promise<void>;
    backendPause(): Promise<void>;
    backendStop(): Promise<void>;
    backendGetVoices(): Promise<TTSVoice[]>;
    backendSetLocale(locale: string): Promise<void>;
    backendPlayEarcon(type: 'bookmark_captured' | 'bookmark_failed'): Promise<void>;
    backendDownloadVoice(voiceId: string): Promise<void>;
    backendDeleteVoice(voiceId: string): Promise<void>;
    backendIsVoiceDownloaded(voiceId: string): Promise<boolean>;
    backendSetProviderById(providerId: string): Promise<void>;

    // Media platform (lock-screen metadata / playback state / background keep-alive).
    platformUpdateMetadata(metadata: MediaSessionMetadata): void;
    platformUpdatePlaybackState(status: TTSStatus): void;
    platformSetPositionState(state: { duration: number; playbackRate: number; position: number }): void;
    platformSetBackgroundAudioMode(mode: BackgroundAudioMode, isPlaying: boolean): void;
    platformSetBackgroundVolume(volume: number): void;
    platformStop(): Promise<void>;

    // Lexicon reads (the main thread owns the yjs-backed lexicon store).
    lexiconGetRules(bookId: string | undefined, language: string): Promise<LexiconRule[]>;
    lexiconGetBiblePreference(bookId: string): Promise<'on' | 'off' | 'default'>;

    // Content-analysis + book-metadata reads (the main thread owns these yjs-backed stores;
    // writes flow through applyHostCommand).
    getContentAnalysis(bookId: string, sectionId: string): Promise<ContentAnalysis | undefined>;
    getBookMetadata(bookId: string): Promise<BookMetadata | undefined>;

    // GenAI model calls (the main thread owns the GenAI SDK).
    genAIIsConfigured(): Promise<boolean>;
    genAIConfigure(apiKey: string, model: string): void;
    genAIDetectContentTypes: GenAIPort['detectContentTypes'];
    genAIGenerateTableAdaptations: GenAIPort['generateTableAdaptations'];

    // Worker → main-thread store writes (the WorkerEngineContext.post channel).
    applyHostCommand(command: EngineHostCommand): void;
}

export class WorkerTtsEngine {
    private engine: AudioPlayerService | null = null;
    private ctx: WorkerEngineContext | null = null;
    private backendEvents: TTSProviderEvents | null = null;
    private backgroundAudioMode: BackgroundAudioMode = 'silence';

    /** Wire the engine to the main-thread host. Must be called once before any other method. */
    async connect(host: EngineHost): Promise<void> {
        const platformName = host.platformName();

        this.ctx = new WorkerEngineContext({
            post: (cmd) => host.applyHostCommand(cmd),
            platformName,
            getRules: (bookId, language) => host.lexiconGetRules(bookId, language),
            getBibleLexiconPreference: (bookId) => host.lexiconGetBiblePreference(bookId),
            getContentAnalysis: (bookId, sectionId) => host.getContentAnalysis(bookId, sectionId),
            getBookMetadata: (bookId) => host.getBookMetadata(bookId),
            genAIIsConfigured: () => host.genAIIsConfigured(),
            genAIConfigure: (apiKey, model) => { void host.genAIConfigure(apiKey, model); },
            genAIDetectContentTypes: (nodes, hints, context) =>
                host.genAIDetectContentTypes(nodes, hints, context),
            genAIGenerateTableAdaptations: (nodes, thinkingBudget, context) =>
                host.genAIGenerateTableAdaptations(nodes, thinkingBudget, context),
        });

        const backendFactory = (events: TTSProviderEvents): PlaybackBackend => {
            this.backendEvents = events;
            return {
                init: () => host.backendInit(),
                play: (text, options) => host.backendPlay(text, options),
                preload: (text, options) => { void host.backendPreload(text, options); },
                pause: () => { void host.backendPause(); },
                stop: () => { void host.backendStop(); },
                getVoices: () => host.backendGetVoices(),
                // The provider id is plain data, so the swap crosses the boundary unchanged;
                // the host's backend constructs the live provider via the shared factory.
                setProviderById: (providerId) => { void host.backendSetProviderById(providerId); },
                setLocale: (locale) => { void host.backendSetLocale(locale); },
                playEarcon: (type) => { void host.backendPlayEarcon(type); },
                downloadVoice: (voiceId) => host.backendDownloadVoice(voiceId),
                deleteVoice: (voiceId) => host.backendDeleteVoice(voiceId),
                isVoiceDownloaded: (voiceId) => host.backendIsVoiceDownloaded(voiceId),
            };
        };

        const platformFactory = (): MediaPlatform => ({
            updateMetadata: (m) => host.platformUpdateMetadata(m),
            updatePlaybackState: (s) => host.platformUpdatePlaybackState(s),
            setPositionState: (st) => host.platformSetPositionState(st),
            setBackgroundAudioMode: (mode, isPlaying) => {
                this.backgroundAudioMode = mode;
                host.platformSetBackgroundAudioMode(mode, isPlaying);
            },
            getBackgroundAudioMode: () => this.backgroundAudioMode,
            setBackgroundVolume: (v) => host.platformSetBackgroundVolume(v),
            stop: () => host.platformStop(),
        });

        this.engine = AudioPlayerService.createWithContext(this.ctx, backendFactory, platformFactory);
    }

    /** Main → worker: apply a replicated store-state snapshot. */
    applyStateUpdate(update: EngineStateUpdate): void {
        this.ctx?.applyUpdate(update);
    }

    /**
     * Readiness gate: whether every listed slice has been replicated at least once. The
     * client checks this after pushing the boot snapshots and refuses to hand out the engine
     * if anything is missing — a forgotten pusher fails at startup, not as stale reads later.
     */
    hasReplicated(kinds: EngineStateUpdate['kind'][]): boolean {
        const ctx = this.ctx;
        if (!ctx) return false;
        return kinds.every((kind) => ctx.receivedKinds.has(kind));
    }

    /** Main → worker: deliver a backend (provider) event into the engine. */
    dispatchBackendEvent(event: BackendEvent): void {
        const ev = this.backendEvents;
        if (!ev) return;
        switch (event.type) {
            case 'start': ev.onStart(); break;
            case 'end': ev.onEnd(); break;
            case 'error': ev.onError(event.error); break;
            case 'timeupdate': ev.onTimeUpdate(event.currentTime); break;
            case 'downloadProgress':
                ev.onDownloadProgress(event.voiceId, event.percent, event.status);
                break;
        }
    }

    private get e(): AudioPlayerService {
        if (!this.engine) throw new Error('WorkerTtsEngine.connect() must be called first');
        return this.engine;
    }

    // --- Engine API (invoked by the main thread over Comlink) ---
    // PlaybackSnapshots structured-clone across the boundary as-is (5b-PR2: the
    // single snapshot channel). The unsubscribe function must cross the boundary
    // as a Comlink proxy, not be serialized.
    subscribe(listener: SnapshotListener): () => void {
        return Comlink.proxy(this.e.subscribe(listener));
    }
    init(): Promise<void> { return this.e.init(); }
    play(): Promise<void> { return this.e.play() as Promise<void>; }
    pause(): void { void this.e.pause(); }
    stop(): void { void this.e.stop(); }
    preview(text: string): Promise<void> { return this.e.preview(text); }
    setBookId(bookId: string | null): void { this.e.setBookId(bookId); }
    loadSection(index: number, autoPlay?: boolean): void { void this.e.loadSection(index, autoPlay); }
    loadSectionBySectionId(sectionId: string, autoPlay?: boolean, title?: string): void {
        void this.e.loadSectionBySectionId(sectionId, autoPlay, title);
    }
    setQueue(items: TTSQueueItem[], startIndex?: number): void { void this.e.setQueue(items, startIndex); }
    getQueue(): ReadonlyArray<TTSQueueItem> { return this.e.getQueue(); }
    skipToNextSection(): Promise<boolean> { return this.e.skipToNextSection(); }
    skipToPreviousSection(): Promise<boolean> { return this.e.skipToPreviousSection(); }
    jumpTo(index: number): void { void this.e.jumpTo(index); }
    seek(offset: number): void { void this.e.seek(offset); }
    setSpeed(speed: number): void { void this.e.setSpeed(speed); }
    setVoice(voiceId: string): void { void this.e.setVoice(voiceId); }
    setProviderById(providerId: string): void { void this.e.setProviderById(providerId); }
    setLanguage(lang: string): void { this.e.setLanguage(lang); }
    setPrerollEnabled(enabled: boolean): void { this.e.setPrerollEnabled(enabled); }
    setBackgroundAudioMode(mode: BackgroundAudioMode): void { this.e.setBackgroundAudioMode(mode); }
    setBackgroundVolume(volume: number): void { this.e.setBackgroundVolume(volume); }
    clearPauseGesture(): void { this.e.clearPauseGesture(); }
    getVoices(): Promise<TTSVoice[]> { return this.e.getVoices(); }
    downloadVoice(voiceId: string): Promise<void> { return this.e.downloadVoice(voiceId); }
    deleteVoice(voiceId: string): Promise<void> { return this.e.deleteVoice(voiceId); }
    isVoiceDownloaded(voiceId: string): Promise<boolean> { return this.e.isVoiceDownloaded(voiceId); }
}

/**
 * WorkerEngineHandle — adapts the async, worker-backed engine to the synchronous {@link TtsEngine}
 * interface the app (`useTTSStore`, `useTTS`, `ReaderView`) expects.
 *
 * The worker client boots asynchronously and every call is async (Comlink), but the app issues
 * fire-and-forget calls synchronously and reads `getQueue()` synchronously. This handle bridges
 * the gap:
 *  - calls made before the worker is ready are queued on the boot promise and flushed in order;
 *  - it keeps an internal subscription so it can serve `getQueue()` (and fan out to the app's
 *    listeners) from a locally cached snapshot.
 *
 * Selected by {@link getAudioPlayer} only when worker mode is enabled (off by default), so the
 * default in-process path and the whole test suite are unaffected.
 */
import type {
    TtsEngine,
    PlaybackListener,
    TTSQueueItem,
    TTSStatus,
    DownloadInfo,
} from '../AudioPlayerService';
import type { ITTSProvider, TTSVoice } from '../providers/types';
import { createLogger } from '../../logger';
import { createWorkerEngineClient, type WorkerEngineClient } from './createWorkerEngineClient';

const logger = createLogger('WorkerEngineHandle');

export class WorkerEngineHandle implements TtsEngine {
    private ready: Promise<WorkerEngineClient>;
    private listeners = new Set<PlaybackListener>();

    // Locally cached playback snapshot, kept current by an internal subscription so the app's
    // synchronous reads (getQueue) and listener semantics behave like the in-process engine.
    private cachedStatus: TTSStatus = 'stopped';
    private cachedCfi: string | null = null;
    private cachedIndex = 0;
    private cachedQueue: ReadonlyArray<TTSQueueItem> = [];
    private cachedError: string | null = null;
    private cachedDownload: DownloadInfo | undefined;

    // No Web Worker in this environment (jsdom unit tests, SSR). The handle becomes a benign
    // no-op stub: getQueue() returns [], subscribe() fires the cached 'stopped' snapshot, and
    // commands/queries short-circuit. Production webviews always have Worker, so this never
    // applies there — but it keeps the handle the single engine type without a fallback branch.
    private readonly disabled = typeof Worker === 'undefined';

    constructor() {
        if (this.disabled) {
            // Never resolves; run()/call() short-circuit on `disabled`, so it's never awaited.
            this.ready = new Promise<WorkerEngineClient>(() => {});
            return;
        }
        this.ready = createWorkerEngineClient();
        this.ready
            .then(async (client) => {
                await client.subscribe((status, activeCfi, currentIndex, queue, error, downloadInfo) => {
                    this.cachedStatus = status;
                    this.cachedCfi = activeCfi;
                    this.cachedIndex = currentIndex;
                    this.cachedQueue = queue;
                    this.cachedError = error;
                    this.cachedDownload = downloadInfo;
                    this.listeners.forEach((l) => l(status, activeCfi, currentIndex, queue, error, downloadInfo));
                });
            })
            .catch((e) => logger.error('Failed to start worker TTS engine', e));
    }

    /** Fire-and-forget: run once the worker is ready (errors logged, not surfaced). */
    private run(fn: (client: WorkerEngineClient) => unknown): void {
        if (this.disabled) return;
        this.ready.then(fn).catch((e) => logger.error('worker engine call failed', e));
    }

    /** Await the worker, then call and return its result (or `fallback` if there's no Worker). */
    private async call<T>(fn: (client: WorkerEngineClient) => Promise<T>, fallback: T): Promise<T> {
        if (this.disabled) return fallback;
        return fn(await this.ready);
    }

    // --- Playback control (fire-and-forget) ---
    async play(): Promise<void> { this.run((c) => c.engine.play()); }
    async pause(): Promise<void> { this.run((c) => c.engine.pause()); }
    async stop(): Promise<void> { this.run((c) => c.engine.stop()); }
    async preview(text: string): Promise<void> { this.run((c) => c.engine.preview(text)); }
    setSpeed(speed: number): Promise<void> { this.run((c) => c.engine.setSpeed(speed)); return Promise.resolve(); }
    setVoice(voiceId: string): Promise<void> { this.run((c) => c.engine.setVoice(voiceId)); return Promise.resolve(); }
    setLanguage(lang: string): void { this.run((c) => c.engine.setLanguage(lang)); }
    setProvider(provider: ITTSProvider): Promise<void> { this.run((c) => c.setProviderById(provider.id)); return Promise.resolve(); }
    setPrerollEnabled(enabled: boolean): void { this.run((c) => c.engine.setPrerollEnabled(enabled)); }
    setBackgroundAudioMode(mode: 'silence' | 'noise' | 'off'): void { this.run((c) => c.engine.setBackgroundAudioMode(mode)); }
    setBackgroundVolume(volume: number): void { this.run((c) => c.engine.setBackgroundVolume(volume)); }
    clearPauseGesture(): void { this.run((c) => c.engine.clearPauseGesture()); }

    // --- Navigation (fire-and-forget) ---
    setBookId(bookId: string | null): void { this.run((c) => c.setBook(bookId)); }
    loadSection(sectionIndex: number, autoPlay = true): Promise<void> { this.run((c) => c.engine.loadSection(sectionIndex, autoPlay)); return Promise.resolve(); }
    loadSectionBySectionId(sectionId: string, autoPlay = true, title?: string): Promise<void> {
        this.run((c) => c.engine.loadSectionBySectionId(sectionId, autoPlay, title));
        return Promise.resolve();
    }
    jumpTo(index: number): Promise<void> { this.run((c) => c.engine.jumpTo(index)); return Promise.resolve(); }
    seek(offset: number): Promise<void> { this.run((c) => c.engine.seek(offset)); return Promise.resolve(); }
    async skipToNextSection(): Promise<boolean> { return this.call((c) => c.engine.skipToNextSection(), false); }
    async skipToPreviousSection(): Promise<boolean> { return this.call((c) => c.engine.skipToPreviousSection(), false); }

    // --- Voices / init (request/response) ---
    async init(): Promise<void> { await this.call((c) => c.engine.init(), undefined); }
    getVoices(): Promise<TTSVoice[]> { return this.call((c) => c.engine.getVoices(), []); }
    async downloadVoice(voiceId: string): Promise<void> { await this.call((c) => c.engine.downloadVoice(voiceId), undefined); }
    async deleteVoice(voiceId: string): Promise<void> { await this.call((c) => c.engine.deleteVoice(voiceId), undefined); }
    isVoiceDownloaded(voiceId: string): Promise<boolean> { return this.call((c) => c.engine.isVoiceDownloaded(voiceId), false); }

    // --- Synchronous reads served from the cached snapshot ---
    getQueue(): ReadonlyArray<TTSQueueItem> { return this.cachedQueue; }

    subscribe(listener: PlaybackListener): () => void {
        this.listeners.add(listener);
        // Mirror AudioPlayerService.subscribe: deliver the current snapshot on the next tick.
        setTimeout(() => {
            if (this.listeners.has(listener)) {
                listener(this.cachedStatus, this.cachedCfi, this.cachedIndex, this.cachedQueue, this.cachedError, this.cachedDownload);
            }
        }, 0);
        return () => { this.listeners.delete(listener); };
    }
}

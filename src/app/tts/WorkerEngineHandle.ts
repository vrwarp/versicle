/**
 * WorkerEngineHandle — adapts the async, worker-backed engine to the {@link TtsEngine}
 * interface the app (TtsController / useAudioCommands) expects.
 *
 * The worker client boots asynchronously and every call is async (Comlink), but the app issues
 * fire-and-forget calls synchronously. This handle bridges the gap:
 *  - calls made before the worker is ready are queued on the boot promise and flushed in order
 *    (a principled startup state — `whenReady()` exposes its completion so the UI can gate on it);
 *  - it keeps an internal subscription so listener semantics match the in-process engine
 *    (subscribers receive the latest snapshot on subscribe, then live updates).
 *
 * Snapshot semantics across the boundary (5b-PR2, the single PlaybackSnapshot channel):
 *  - `seq` is monotonic on the worker side; a Comlink delivery arriving out of order is
 *    DROPPED here, so consumers never observe time running backwards;
 *  - worker snapshots omit `queue` when the `queueId` did not change — the handle caches the
 *    last delivered queue and re-attaches it, so its subscribers always receive full
 *    snapshots with a stable queue identity between queue changes (P23's broadcast diet);
 *  - a rejected fire-and-forget command surfaces as a snapshot with
 *    `error.code = 'TTS_COMMAND_FAILED'` instead of a swallowed log line (S8 fix).
 *
 * Queue/playback *state* is not read from the handle: it flows through the subscription into
 * `useTTSStore` via the TtsController mirror, which the app reads reactively.
 */
import type {
    TtsEngine,
    PlaybackSnapshot,
    SnapshotListener,
    FlightRecorderExport,
} from '@lib/tts/engine/TtsEngine';
import type { TTSQueueItem } from '~types/tts';
import type { TTSVoice } from '@lib/tts/providers/types';
import { createLogger } from '@lib/logger';
import { createWorkerEngineClient, type WorkerEngineClient } from './createWorkerEngineClient';

const logger = createLogger('WorkerEngineHandle');

const INITIAL_SNAPSHOT: PlaybackSnapshot = Object.freeze({
    seq: 0,
    status: 'stopped',
    queueId: '',
    queue: [] as ReadonlyArray<TTSQueueItem>,
    index: 0,
    sectionIndex: -1,
    activeCfi: null,
    error: null,
    download: null,
});

export class WorkerEngineHandle implements TtsEngine {
    readonly engineName: string = 'WorkerEngineHandle';
    /** Resolves once the worker is booted AND the snapshot subscription is live. */
    private booted: Promise<WorkerEngineClient>;
    private listeners = new Set<SnapshotListener>();

    // Latest FULL playback snapshot (queue always attached), kept current by the internal
    // subscription, so subscribe() can replay it to new listeners (mirroring
    // PlaybackController.subscribe semantics) and snapshot() can serve it synchronously.
    private cachedSnapshot: PlaybackSnapshot = INITIAL_SNAPSHOT;

    // No Web Worker in this environment (jsdom unit tests, SSR). The handle becomes a benign
    // no-op stub: subscribe() fires the cached 'stopped' snapshot, and commands/queries
    // short-circuit. Production webviews always have Worker, so this never applies there —
    // but it keeps the handle the single engine type without a fallback branch.
    private readonly disabled = typeof Worker === 'undefined';

    constructor() {
        if (this.disabled) {
            // Never resolves; run()/call() short-circuit on `disabled`, so it's never awaited.
            this.booted = new Promise<WorkerEngineClient>(() => {});
            return;
        }
        this.booted = createWorkerEngineClient().then(async (client) => {
            await client.subscribe((snap) => {
                // Comlink deliveries can reorder; seq is monotonic worker-side, so a
                // stale snapshot is simply dropped.
                if (snap.seq <= this.cachedSnapshot.seq) return;
                // Re-attach the cached queue when the broadcast omitted it (unchanged
                // queueId) — handle subscribers always see full snapshots, and the
                // queue array identity is stable between queue changes.
                const full: PlaybackSnapshot = snap.queue
                    ? snap
                    : { ...snap, queue: this.cachedSnapshot.queue };
                this.cachedSnapshot = full;
                this.listeners.forEach((l) => l(full));
            });
            return client;
        });
        this.booted.catch((e) => logger.error('Failed to start worker TTS engine', e));
    }

    /**
     * Resolves when the worker engine is ready (booted + subscribed). In `disabled`
     * environments it resolves immediately — the no-op engine is trivially "ready".
     */
    whenReady(): Promise<void> {
        if (this.disabled) return Promise.resolve();
        return this.booted.then(() => undefined);
    }

    /**
     * Fire-and-forget: run once the worker is ready. A rejected command is not swallowed
     * into a log line — it surfaces on the snapshot channel as `TTS_COMMAND_FAILED`.
     */
    private run(fn: (client: WorkerEngineClient) => unknown): void {
        if (this.disabled) return;
        this.booted.then(fn).catch((e) => {
            logger.error('worker engine call failed', e);
            const failed: PlaybackSnapshot = {
                ...this.cachedSnapshot,
                error: {
                    code: 'TTS_COMMAND_FAILED',
                    message: e instanceof Error ? e.message : String(e),
                },
            };
            this.cachedSnapshot = failed;
            this.listeners.forEach((l) => l(failed));
        });
    }

    /** Await the worker, then call and return its result (or `fallback` if there's no Worker). */
    private async call<T>(fn: (client: WorkerEngineClient) => Promise<T>, fallback: T): Promise<T> {
        if (this.disabled) return fallback;
        return fn(await this.booted);
    }

    // --- Playback control (fire-and-forget) ---
    async play(): Promise<void> { this.run((c) => c.engine.play()); }
    async pause(): Promise<void> { this.run((c) => c.engine.pause()); }
    async stop(): Promise<void> { this.run((c) => c.engine.stop()); }
    async preview(text: string): Promise<void> { this.run((c) => c.engine.preview(text)); }
    setSpeed(speed: number): Promise<void> { this.run((c) => c.engine.setSpeed(speed)); return Promise.resolve(); }
    setVoice(voiceId: string): Promise<void> { this.run((c) => c.engine.setVoice(voiceId)); return Promise.resolve(); }
    setLanguage(lang: string): void { this.run((c) => c.engine.setLanguage(lang)); }
    setProviderById(providerId: string): Promise<void> { this.run((c) => c.engine.setProviderById(providerId)); return Promise.resolve(); }
    setPrerollEnabled(enabled: boolean): void { this.run((c) => c.engine.setPrerollEnabled(enabled)); }
    setBackgroundAudioMode(mode: 'silence' | 'noise' | 'off'): void { this.run((c) => c.engine.setBackgroundAudioMode(mode)); }
    setBackgroundVolume(volume: number): void { this.run((c) => c.engine.setBackgroundVolume(volume)); }

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

    // --- Diagnostics (S9: the worker-side flight recorder is the one that
    // sees engine traffic; the tab reads it through the handle) ---
    exportDiagnostics(): Promise<FlightRecorderExport> {
        return this.call((c) => c.engine.exportDiagnostics(), {
            stats: { eventCount: 0, capacity: 0, oldestWall: null },
            events: [],
        });
    }
    triggerDiagnosticsSnapshot(trigger: string, note?: string): Promise<string | null> {
        return this.call((c) => c.engine.triggerDiagnosticsSnapshot(trigger, note), null);
    }

    // --- The snapshot stream ---
    /** The latest full snapshot, synchronously (handle cache). */
    snapshot(): PlaybackSnapshot {
        return this.cachedSnapshot;
    }

    subscribe(listener: SnapshotListener): () => void {
        this.listeners.add(listener);
        // Mirror PlaybackController.subscribe: deliver the current snapshot on the next tick.
        setTimeout(() => {
            if (this.listeners.has(listener)) {
                listener(this.cachedSnapshot);
            }
        }, 0);
        return () => { this.listeners.delete(listener); };
    }
}

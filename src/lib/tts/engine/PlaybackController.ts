import { isPlaybackInterruption, isProviderPlaybackError } from '../providers/types';
import type { ITTSProvider, TTSVoice } from '../providers/types';
import type { TTSQueueItem } from '~types/tts';
import { lexiconApplier } from '../LexiconApplier';
import type { SectionMetadata } from '~types/book';
import { TaskSequencer, type TaskContext } from '../TaskSequencer';
import { SectionAnalysisDriver, type SectionContent } from '../SectionAnalysisDriver';
import { buildSectionQueue } from '../SectionQueueBuilder';
import { resolveSectionTitle } from '../sectionTitle';
import { AbbreviationMerger } from '../abbreviationMerge';
import { resolveBiblePreference } from '../biblePreference';
import { QueueModel } from '../QueueModel';
import type { PlaybackBackend, PlaybackBackendFactory, TTSProviderEvents } from './PlaybackBackend';
import type {
    TtsEngine,
    TTSStatus,
    DownloadInfo,
    PlaybackError,
    PlaybackSnapshot,
    SnapshotListener,
    FlightRecorderExport,
} from './TtsEngine';
import type { MediaPlatform, MediaPlatformFactory } from '../PlatformIntegration';
import type { BackgroundAudioMode } from '../BackgroundAudio';
import { flightRecorder } from '../TTSFlightRecorder';
import type { EngineContext, CompiledLexicon } from './EngineContext';
import { AnalysisApplier } from './AnalysisApplier';
import { MediaMetadataPublisher, type BookPresentation } from './MediaMetadataPublisher';
import { DragnetGesture } from './DragnetGesture';
import { createLogger } from '../../logger';
import { normalizeLanguageCode } from '../../language-utils';
import { coverUrl } from '@data/covers';

const logger = createLogger('PlaybackController');

/**
 * PlaybackController — the TTS engine's orchestration core (Phase 5b
 * decomposition; phase5-tts-strangler.md §5b.1 — the strangled remainder of
 * the 1,300-line AudioPlayerService god class, which is GONE).
 *
 * The controller is the playback FSM and the SOLE status writer; everything
 * else is a composed unit behind a seam:
 *
 *  - {@link QueueModel} — the immutable queue/position model (no persistence);
 *  - {@link AnalysisApplier} — GenAI mask/adaptation application (subscriptions,
 *    timestamp dedup, sequenced mutation commands);
 *  - {@link MediaMetadataPublisher} — the ONE media-session metadata builder,
 *    book progress, deadbanded position pushes;
 *  - {@link DragnetGesture} — the pause→play audio-bookmark capture, with
 *    section-change invalidation INTERNAL to the engine;
 *  - `ctx.content` / `ctx.session` (EngineContext ports) — derived-content
 *    reads and the single-owner playback-session persistence (WebKit-detach
 *    discipline documented on the port);
 *  - {@link TaskSequencer} — every status/queue mutation runs as a sequenced
 *    task (the C4 dev-assert crashes in dev/test otherwise).
 *
 * Construction: `WorkerTtsEngine.connect` builds this directly inside the
 * worker (the production path); `getInProcessAudioPlayer()` builds it on the
 * main thread for unit tests; parity tests build it with fakes.
 */
export class PlaybackController implements TtsEngine {
    readonly engineName: string = 'PlaybackController';
    // TaskSequencer ensures async operations are executed serially to prevent race conditions.
    private taskSequencer = new TaskSequencer();
    // SectionAnalysisDriver runs background GenAI detection/adaptation (5c-PR2);
    // queue building is the pure SectionQueueBuilder, orchestrated in
    // loadSectionInternal (the strangled AudioContentPipeline is gone).
    private analysisDriver: SectionAnalysisDriver;
    private readonly abbreviations = new AbbreviationMerger();
    // QueueModel manages the queue (immutably), current index, and position calculations.
    private stateManager = new QueueModel();
    private readonly analysis: AnalysisApplier;
    private readonly metadata: MediaMetadataPublisher;
    private readonly dragnet: DragnetGesture;

    private readonly ctx: EngineContext;
    private providerManager: PlaybackBackend;
    private platformIntegration: MediaPlatform;

    private status: TTSStatus = 'stopped';
    private listeners: SnapshotListener[] = [];
    /** Monotonic snapshot sequence (5b-PR2 single channel). */
    private seq = 0;
    /** The queueId carried by the previously PUBLISHED snapshot (broadcast diet). */
    private lastPublishedQueueId: string | null = null;
    /** The queueId last handed to the session store (persistence dedupe). */
    private lastPersistedQueueId: string | null = null;
    /** The assembled lexicon handle (5c-PR3): null → refetch on next sentence. */
    private activeLexicon: CompiledLexicon | null = null;
    private speed: number = 1.0;
    private voiceId: string | null = null;
    /**
     * The provider id this engine last routed the backend to ('local' initially,
     * like the manager). Owns the fallback DECISION (5a-PR2): recovery applies only
     * while a non-'local' provider is active, and flips this back to 'local' so the
     * failed sentence is replayed exactly once.
     */
    private currentProviderId: string = 'local';
    private currentBookId: string | null = null;
    private currentCoverUrl: string | null = null;
    private playlist: SectionMetadata[] = [];
    private playlistPromise: Promise<void> | null = null;
    private sessionRestored: boolean = false;
    private prerollEnabled: boolean = false;
    private isPreviewing: boolean = false;
    /**
     * Scrubber-seek coalescing. A drag on the OS media controls (Chrome's
     * Global Media Controls, the lock screen, a Bluetooth head unit) fires a
     * BURST of absolute `seekto` actions. Applying each one — re-deriving the
     * queue index, rebuilding lock-screen metadata (cover-artwork canvas),
     * persisting progress, pushing position state, and (when playing)
     * re-synthesizing the landed sentence — is what makes the scrubber lag. We
     * keep only the latest target and apply it ONCE the drag settles.
     */
    private static readonly SEEK_SETTLE_MS = 180;
    private pendingSeekTime: number | null = null;
    /** The queue identity the pending scrub targets — discard it if the queue
     *  changed underneath (a section/chapter/book navigation stamps a new id). */
    private pendingSeekQueueId: string | null = null;
    private seekSettleTimer: ReturnType<typeof setTimeout> | null = null;
    private book: BookPresentation = {
        title: '', author: '', coverUrl: undefined, palette: undefined, perceptualPalette: undefined,
    };

    private constructor(
        ctx: EngineContext,
        backendFactory: PlaybackBackendFactory,
        platformFactory: MediaPlatformFactory,
    ) {
        this.ctx = ctx;
        this.analysisDriver = new SectionAnalysisDriver(this.ctx);

        this.platformIntegration = platformFactory({
            onPlay: () => this.play(),
            onPause: () => this.pause(),
            onStop: () => this.stop(),
            onPrev: () => this.prev(),
            onNext: () => this.next(),
            onSeek: (offset) => this.seek(offset),
            onSeekTo: (time) => this.seekTo(time),
            onBookmark: () => { void this.captureBookmark(); },
        });

        // Provider events that drive the FSM (start/end/error) run as sequenced
        // tasks (5b-PR3): the dev-assert makes any un-sequenced status/queue
        // mutation a crash in dev/test, and these three were the violators.
        // onTimeUpdate/onDownloadProgress are pure telemetry passthroughs — they
        // mutate neither status nor queue, and sequencing per-second time updates
        // would queue them behind synthesis tasks for no benefit.
        const providerEvents: TTSProviderEvents = {
            onStart: () => {
                void this.enqueue('provider.start', async () => {
                    this.setStatus('playing');
                });
            },
            onEnd: () => {
                void this.enqueue('provider.end', () => this.handlePlaybackEnded());
            },
            onError: (error) => {
                void this.enqueue('provider.error', async () => {
                    // Mid-playback failure on a non-local provider: recover inside
                    // THIS task (one sequenced task end-to-end — swap + replay).
                    // The manager doesn't self-swap or emit synthetic 'fallback'
                    // events, so this is the only fallback trigger on the event
                    // channel.
                    if (this.currentProviderId !== 'local') {
                        logger.warn("Cloud provider error during playback; falling back to local provider", error);
                        await this.recoverWithLocalProvider();
                        return;
                    }

                    logger.error("TTS Provider Error", error);
                    this.setStatus('stopped');
                    // Providers reject with Error instances OR plain
                    // { message } shapes (the provider contract pins both) —
                    // read .message structurally, never via instanceof.
                    const message = (error as { message?: unknown } | null | undefined)?.message;
                    this.notifyError(
                        "Playback Error: " +
                        (typeof message === 'string' && message ? message : "Unknown error"));
                });
            },
            onTimeUpdate: (currentTime) => {
                this.metadata.updatePosition(currentTime);
            },
            onDownloadProgress: (voiceId, percent, status) => {
                this.notifyDownloadProgress(voiceId, percent, status);
            }
        };
        this.providerManager = backendFactory(providerEvents);

        this.metadata = new MediaMetadataPublisher(this.platformIntegration, {
            queue: this.stateManager,
            getPlaylist: () => this.playlist,
            getBook: () => this.book,
            getSpeed: () => this.speed,
        });

        this.dragnet = new DragnetGesture({
            queue: this.stateManager,
            annotations: this.ctx.annotations,
            backend: () => this.providerManager,
            getBookId: () => this.currentBookId,
        });

        // Mid-playback lexicon edits (S15): any lexicon change drops the handle;
        // the next sentence refetches the assembled rules.
        this.ctx.lexicon.subscribe(() => {
            this.activeLexicon = null;
        });

        this.analysis = new AnalysisApplier({
            ctx: this.ctx,
            driver: this.analysisDriver,
            queue: this.stateManager,
            enqueue: (label, task) => this.enqueue(label, task),
            getBookId: () => this.currentBookId,
            getSection: (sectionIndex) => this.playlist[sectionIndex],
        });
        this.analysis.start();

        // Subscribe to state manager changes
        this.stateManager.subscribe((snapshot) => {
            // Update Yjs Progress
            if (this.currentBookId && snapshot.currentSectionIndex !== -1) {
                this.ctx.readingState.updateTTSProgress(
                    this.currentBookId,
                    snapshot.currentIndex,
                    snapshot.currentSectionIndex
                );
            }
            // Section-change invalidation of a pending dragnet gesture is
            // INTERNAL since 5b-PR4 (the ReaderView/useTTS clearPauseGesture
            // call sites are gone).
            this.dragnet.noteSectionIndex(snapshot.currentSectionIndex);
            // Persistence (single owner: the SessionStore port), deduped on the
            // queue's content identity. Resets publish an EMPTY queue with a
            // fresh queueId and must NOT clobber the persisted session (the
            // restore that follows a book switch still reads it) — the legacy
            // QueueModel likewise never persisted from reset().
            if (this.currentBookId && snapshot.queue.length > 0 && snapshot.queueId !== this.lastPersistedQueueId) {
                this.lastPersistedQueueId = snapshot.queueId;
                this.ctx.session.persistQueue(this.currentBookId, snapshot.queue);
            }
            this.metadata.updateMediaSessionMetadata();
            this.publishSnapshot({ activeCfi: snapshot.currentItem?.cfi || null });
        });

        // Subscribe to book store changes for proactive language synchronization.
        // This ensures that if a user (or Yjs sync) updates the book's language,
        // the TTS system reactively switches its profile and voice.
        this.ctx.book.subscribe(() => {
            const bookId = this.currentBookId;
            if (!bookId) {
                return;
            }

            const currentLang = normalizeLanguageCode(this.ctx.book.getBookLanguage(bookId));

            // Trigger sync if language changed for the CURRENT book,
            // using activeLanguage to prevent unwarranted restarts.
            const lastLang = this.ctx.config.getActiveLanguage();

            if (currentLang !== lastLang) {
                logger.info(`Syncing TTS language to book: ${currentLang} (Book: ${bookId})`);
                this.ctx.config.setActiveLanguage(currentLang);

                // Force lexicon reload for the new language
                this.activeLexicon = null;

                // If playing, restart to apply the new voice/language immediately.
                // Sequenced (5b-PR3): a store subscription must not drive the FSM
                // outside the sequencer.
                if (this.status === 'playing' || this.status === 'loading') {
                    void this.enqueue('languageSync.restart', () => this.playInternal(true));
                }
            }
        });

        // Flight Recorder Context
        flightRecorder.setContextProvider(() => {
            const queue = this.stateManager.queue;
            const idx = this.stateManager.currentIndex;
            let skippedCount = 0;
            for (let i = 0; i < queue.length; i++) {
                if (queue[i]?.isSkipped) skippedCount++;
            }
            return {
                bookId: this.currentBookId,
                sectionIndex: this.stateManager.currentSectionIndex,
                currentIndex: idx,
                queueLength: queue.length,
                status: this.status,
                skippedCount,
                nextItemSkipped: queue[idx + 1]?.isSkipped,
            };
        });

        // Anomaly callback: emit detailed queue diagnostics before the snapshot is frozen.
        // This captures the exact isSkipped values at the anomaly boundary.
        flightRecorder.onAnomalyDetected = (currentIndex: number, queueLen: number) => {
            const diag = this.stateManager.getSkipDiagnostics(currentIndex);
            flightRecorder.record('APS', 'playNext.queueDiag', {
                skippedCount: diag.skippedCount,
                firstSkipped: diag.firstSkippedIndex,
                lastSkipped: diag.lastSkippedIndex,
                rawRemaining: queueLen - currentIndex - 1,
                sample: JSON.stringify(diag.sample),
            });
        };

        // The C4 dev-assert (5b-PR3, §5b.3): status writes and queue mutations
        // happen ONLY inside a running sequenced task — a crashing invariant
        // in dev/test instead of a convention.
        if (import.meta.env.DEV) {
            this.stateManager.setMutationGuard((op) => this.assertSequencedMutation(`QueueModel.${op}`));
        }
    }

    private assertSequencedMutation(op: string): void {
        if (import.meta.env.DEV && !this.taskSequencer.isInsideTask()) {
            throw new Error(
                `[PlaybackController] ${op} outside a sequenced task — status/queue ` +
                'mutations must run through the TaskSequencer (5b-PR3 C4 invariant; ' +
                'plan/overhaul/prep/phase5-tts-strangler.md §5b.3)',
            );
        }
    }

    /**
     * Construct a PlaybackController with an explicitly injected context and playback
     * backend. This is the ONLY construction path: the worker host uses it
     * (WorkerTtsEngine.connect — the production wiring), the main thread's in-process
     * builder uses it for unit tests, and the parity suites use it with fakes.
     * Keeping all dependencies injected (no defaults) is what keeps this module free of
     * worker-unsafe imports. See {@link EngineContext} and {@link PlaybackBackend}.
     */
    static createWithContext(
        ctx: EngineContext,
        backendFactory: PlaybackBackendFactory,
        platformFactory: MediaPlatformFactory,
    ): PlaybackController {
        return new PlaybackController(ctx, backendFactory, platformFactory);
    }

    private enqueue<T>(label: string, task: (ctx: TaskContext) => Promise<T>): Promise<T | void> {
        return this.taskSequencer.enqueue(label, task);
    }

    /**
     * Switch the active book. The CONTEXT SWITCH happens synchronously at call
     * time — the epoch bump (which makes every previously enqueued task stale,
     * §5b.3), `currentBookId`, and the metadata/playlist load kickoffs — while
     * the status/queue mutations (stop + reset) run as a sequenced task, per
     * the C4 dev-assert. The returned promise resolves when the reset task has
     * run; fire-and-forget callers may ignore it.
     */
    setBookId(bookId: string | null): Promise<void> {
        if (this.currentBookId === bookId) return Promise.resolve();

        this.taskSequencer.bumpEpoch('setBookId');

        if (this.currentCoverUrl) {
            if (typeof URL !== 'undefined' && URL.revokeObjectURL) {
                URL.revokeObjectURL(this.currentCoverUrl);
            }
            this.currentCoverUrl = null;
        }

        if (bookId) {
            // Proactively sync language to ensure proper voices are loaded before playback starts
            const currentLang = normalizeLanguageCode(this.ctx.book.getBookLanguage(bookId));
            if (currentLang !== this.ctx.config.getActiveLanguage()) {
                this.ctx.config.setActiveLanguage(currentLang);
            }
        }

        this.currentBookId = bookId;
        this.sessionRestored = false;
        this.analysis.reset();
        this.book = { title: '', author: '', coverUrl: undefined, palette: undefined, perceptualPalette: undefined };
        this.activeLexicon = null;
        this.dragnet.clear('setBookId');
        this.cancelPendingSeek();
        this.lastPersistedQueueId = null;

        // Stop playback and reset queue state to prevent leakage of old book
        // state. Enqueued (5b-PR3) — but protected against in-flight tasks of
        // the OLD book by the epoch bump above: any earlier-enqueued task that
        // checkpoints (play, loadSection…) bails instead of touching the not-
        // yet-reset queue.
        const reset = this.enqueue('setBookId.reset', async () => {
            if (this.status !== 'stopped') {
                this.setStatus('stopped');
                this.providerManager.stop();
                this.platformIntegration.stop().catch(e => logger.error("Failed to stop platform integration", e));
            }
            this.stateManager.reset();
        });

        if (bookId) {
            this.ctx.book.getMetadata(bookId).then(metadata => {
                if (this.currentBookId === bookId) {
                    let coverUrlStr: string | undefined = metadata?.coverUrl;
                    if (!coverUrlStr && metadata?.coverBlob) {
                        const hasController = typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller;
                        if (hasController) {
                            coverUrlStr = coverUrl(bookId);
                        } else if (typeof URL !== 'undefined' && URL.createObjectURL) {
                            if (this.currentCoverUrl) {
                                URL.revokeObjectURL(this.currentCoverUrl);
                            }
                            this.currentCoverUrl = URL.createObjectURL(metadata.coverBlob);
                            coverUrlStr = this.currentCoverUrl;
                        }
                    }
                    this.book = {
                        title: metadata?.title || '',
                        author: metadata?.author || '',
                        coverUrl: coverUrlStr,
                        palette: metadata?.coverPalette,
                        perceptualPalette: metadata?.perceptualPalette,
                    };
                    this.metadata.updateMediaSessionMetadata();
                }
            }).catch(e => logger.warn("Failed to load book metadata", e));

            this.playlistPromise = this.ctx.content.getSections(bookId).then(sections => {
                if (this.currentBookId !== bookId) return; this.playlist = sections;
                this.restoreQueue(bookId);
            }).catch(e => logger.error("Failed to load playlist", e));
        } else {
            this.playlist = [];
            this.playlistPromise = null;
        }

        return reset as Promise<void>;
    }

    private async restoreQueue(bookId: string) {
        // NOTE: the book-id guard below is deliberately NOT converted to
        // ctx.checkpoint(): stop() also bumps the epoch, and a user stop
        // between setBookId and the playlist resolving must not cancel the
        // restore (the queue should still be there for the next play).
        this.enqueue('restoreQueue', async () => {
            try {
                const session = await this.ctx.session.loadSession(bookId);
                const state = session ? { bookId, queue: session.playbackQueue, updatedAt: session.updatedAt } : undefined;
                const progress = this.ctx.readingState.getProgress(bookId);

                if (this.currentBookId !== bookId) return;

                if (state && state.queue && state.queue.length > 0) {
                    await this.stopInternal();

                    const currentIndex = progress?.currentQueueIndex || 0;
                    const sectionIndex = progress?.currentSectionIndex ?? -1;

                    // Detect stale isSkipped flags persisted from a prior session
                    let skippedCount = 0;
                    let firstSkipped = -1;
                    let lastSkipped = -1;
                    for (let i = 0; i < state.queue.length; i++) {
                        if (state.queue[i]?.isSkipped) {
                            skippedCount++;
                            if (firstSkipped === -1) firstSkipped = i;
                            lastSkipped = i;
                        }
                    }

                    flightRecorder.record('APS', 'restoreQueue', {
                        queueLen: state.queue.length,
                        currentIndex,
                        sectionIndex,
                        skippedCount,
                        firstSkipped,
                        lastSkipped,
                    });

                    // Clear stale isSkipped flags — the content analysis pipeline
                    // will re-apply them asynchronously from current GenAI settings.
                    const cleanedQueue = skippedCount > 0
                        ? state.queue.map(item => item.isSkipped ? { ...item, isSkipped: false } : item)
                        : state.queue;

                    // The restored queue's identity matches what's already persisted —
                    // don't immediately write it back.
                    this.stateManager.setQueue(cleanedQueue, currentIndex, sectionIndex);
                    // Subscription handles metadata and listeners

                    // Trigger background content analysis (GenAI) for the restored section
                    if (sectionIndex >= 0 && sectionIndex < this.playlist.length) {
                        const section = this.playlist[sectionIndex];

                        this.analysis.applyCachedAnalysis(bookId, section.sectionId);

                        void this.analysisDriver.triggerAnalysis(
                            bookId,
                            section.sectionId,
                            undefined, // will fetch from DB ({sentences, citationMarkers} together)
                            this.analysis.maskCallback(bookId, sectionIndex, section.sectionId),
                            this.analysis.adaptationsCallback(bookId, sectionIndex)
                        );
                    }
                }
            } catch (e) {
                logger.error("Failed to restore TTS queue", e);
            }
        });
    }

    public setBackgroundAudioMode(mode: BackgroundAudioMode) {
        this.platformIntegration.setBackgroundAudioMode(mode, this.status === 'playing' || this.status === 'loading');
    }

    public setBackgroundVolume(volume: number) {
        this.platformIntegration.setBackgroundVolume(volume);
    }

    public setPrerollEnabled(enabled: boolean) {
        this.prerollEnabled = enabled;
    }

    /** Swap the active provider by id — the uniform engine API on both transports. */
    public setProviderById(providerId: string) {
        return this.enqueue('setProviderById', async () => {
            await this.stopInternal();
            this.providerManager.setProviderById(providerId);
            this.currentProviderId = providerId;
        });
    }

    /**
     * In-process/test seam: install a live provider instance through the backend's optional
     * direct-injection hook. Not part of the {@link TtsEngine} app contract.
     */
    public setProvider(provider: ITTSProvider) {
        return this.enqueue('setProvider', async () => {
            await this.stopInternal();
            this.providerManager.setProvider?.(provider);
            this.currentProviderId = provider.id;
        });
    }

    /**
     * The single fallback path (5a-PR2, phase5-tts-strangler.md §5a.1): swap the
     * backend to the platform's local provider and replay the current sentence ONCE.
     * Always runs INSIDE the sequenced task that observed the failure (5b-PR3):
     * `playInternal`'s rejection handler awaits it in the same `play` task, and the
     * mid-playback error event awaits it inside its own `provider.error` task — the
     * fallback is one sequenced task end-to-end. The id guard makes a doubly-
     * triggered recovery a no-op, so a provider failure can never double-fire the
     * replay.
     */
    private async recoverWithLocalProvider(): Promise<void> {
        if (this.currentProviderId === 'local') return; // already recovered
        logger.warn('Falling back to local provider...');
        this.currentProviderId = 'local';
        this.providerManager.setProviderById('local');
        await this.playInternal(true);
    }

    /**
     * Resolves when the engine is ready to accept commands. The in-process engine is ready
     * at construction; the worker handle resolves once the worker has booted and subscribed.
     */
    public whenReady(): Promise<void> {
        return Promise.resolve();
    }

    async init() {
        await this.providerManager.init();
    }

    async getVoices(): Promise<TTSVoice[]> {
        return this.providerManager.getVoices();
    }

    async downloadVoice(voiceId: string): Promise<void> {
        await this.providerManager.downloadVoice(voiceId);
    }

    async deleteVoice(voiceId: string): Promise<void> {
        await this.providerManager.deleteVoice(voiceId);
    }

    async isVoiceDownloaded(voiceId: string): Promise<boolean> {
        return await this.providerManager.isVoiceDownloaded(voiceId);
    }

    public getQueue(): ReadonlyArray<TTSQueueItem> {
        return this.stateManager.queue;
    }

    public loadSection(sectionIndex: number, autoPlay: boolean = true) {
        // Context-switch command (§5b.3): bump before enqueueing ourselves so
        // previously queued navigation/playback tasks go stale.
        this.taskSequencer.bumpEpoch('loadSection');
        this.cancelPendingSeek();
        return this.enqueue('loadSection', async (ctx) => {
            if (this.playlistPromise) await this.playlistPromise;
            // Converted hand-rolled guard (S7): originalBookId comparison -> epoch
            // checkpoint. setBookId bumps the epoch synchronously, so a load
            // enqueued for the old book cancels here (P17/P18 own this behavior).
            ctx.checkpoint();
            return this.loadSectionInternal(sectionIndex, autoPlay);
        });
    }

    public loadSectionBySectionId(sectionId: string, autoPlay: boolean = true, sectionTitle?: string) {
        return this.enqueue('loadSectionBySectionId', async (ctx) => {
            if (this.playlistPromise) await this.playlistPromise;
            // Converted hand-rolled guard (S7): stale after setBookId/stop/
            // loadSection bumped the epoch (P18 pins the setBookId case).
            ctx.checkpoint();

            const index = this.playlist.findIndex(s => s.sectionId === sectionId);

            flightRecorder.record('APS', 'loadSectionBySectionId.guard', {
                sectionId,
                found: index !== -1,
                currentSecIdx: this.stateManager.currentSectionIndex,
                targetIdx: index,
                autoPlay
            });

            if (index !== -1) {
                // Optimization: If the section is already loaded (e.g. from restore) and we are not forcing playback,
                // keep the current state (including current index/progress).
                if (!autoPlay && this.stateManager.currentSectionIndex === index && this.stateManager.queue.length > 0) {
                    flightRecorder.record('APS', 'loadSectionBySectionId.guard', { reason: 'bail' });
                    return;
                }
                flightRecorder.record('APS', 'loadSectionBySectionId.guard', { reason: 'proceed' });
                await this.loadSectionInternal(index, autoPlay, sectionTitle);
            }
        });
    }

    // Section skips are sequenced tasks (5b-PR3): they mutate the queue via
    // loadSectionInternal.
    public async skipToNextSection(): Promise<boolean> {
        const loaded = await this.enqueue('skipToNextSection', async () => this.advanceToNextChapter());
        return loaded ?? false;
    }

    public async skipToPreviousSection(): Promise<boolean> {
        const loaded = await this.enqueue('skipToPreviousSection', async () => {
            if (!this.currentBookId || this.playlist.length === 0) return false;
            let prevSectionIndex = this.stateManager.currentSectionIndex - 1;
            while (prevSectionIndex >= 0) {
                const ok = await this.loadSectionInternal(prevSectionIndex, true);
                if (ok) return true;
                prevSectionIndex--;
            }
            return false;
        });
        return loaded ?? false;
    }

    setQueue(items: TTSQueueItem[], startIndex: number = 0) {
        return this.enqueue('setQueue', async () => {
            if (this.stateManager.isIdenticalTo(items)) {
                this.stateManager.setQueue(items, startIndex, this.stateManager.currentSectionIndex);
                // persist and notify are automatic (the state-manager subscription).
                return;
            }

            await this.stopInternal();

            this.stateManager.setQueue(items, startIndex, this.stateManager.currentSectionIndex);
            // persist and notify automatic.
        });
    }

    jumpTo(index: number) {
        return this.enqueue('jumpTo', async () => {
            if (this.stateManager.jumpTo(index)) {
                await this.stopInternal();
                await this.playInternal();
            }
        });
    }

    async preview(text: string): Promise<void> {
        return this.enqueue('preview', async () => {
            await this.stopInternal();
            this.isPreviewing = true;
            this.setStatus('playing');

            try {
                const voiceId = this.voiceId || '';
                await this.providerManager.play(text, {
                    voiceId,
                    speed: this.speed
                });

            } catch (e) {
                logger.error("Preview error", e);
                this.setStatus('stopped');
                this.isPreviewing = false;
                this.notifyError(e instanceof Error ? e.message : "Preview error");
            }
        });
    }

    /**
     * Capture an audio-bookmark at the current location on demand, driven by
     * the OS media-notification "Bookmark" custom action (capacitor-media-session
     * 4.1.0). Runs INSIDE the sequencer — like the pause→play Dragnet capture —
     * so it observes a consistent queue snapshot, and a capture that went stale
     * (a stop/setBookId/loadSection bumped the epoch after it was enqueued)
     * cancels at its checkpoint before touching the store.
     */
    captureBookmark(): Promise<void> {
        flightRecorder.record('APS', 'captureBookmark', { status: this.status });
        return this.enqueue('captureBookmark', async (ctx) => {
            ctx.checkpoint();
            await this.dragnet.captureNow();
        }) as Promise<void>;
    }

    async play(): Promise<void> {
        flightRecorder.record('APS', 'play', { status: this.status });
        // Dragnet capture is part of the play task (5b-PR3): the pause->play
        // gesture check runs INSIDE the sequencer with the timestamp evaluated
        // at task time. A play that went stale (stop/setBookId/loadSection
        // bumped the epoch after it was enqueued) cancels before capturing or
        // synthesizing.
        return this.enqueue('play', async (ctx) => {
            ctx.checkpoint();
            // A scrubber drag ends with seekto → play (Chrome's Global Media
            // Controls pause on grab and resume on release). Land on the dropped
            // position here so we resume at the scrubbed spot instead of racing
            // the settle timer — which would briefly resume at the PRE-drag spot
            // and then jump. The dragnet was already disarmed by seekTo, so the
            // capture below correctly no-ops for a scrub.
            this.takeOverPendingSeek();
            await this.dragnet.maybeCapture();
            return this.playInternal();
        }) as Promise<void>;
    }

    private async playInternal(force: boolean = false): Promise<void> {
        if (this.status === 'paused' && !force) {
            return this.resumeInternal();
        }

        const initialBookId = this.currentBookId;

        if (this.status === 'stopped' && initialBookId && !this.sessionRestored) {
            this.sessionRestored = true;
            try {
                const book = await this.ctx.book.getMetadata(initialBookId);
                if (this.currentBookId !== initialBookId) return;

                if (book) {
                    if (book.lastPlayedCfi && this.stateManager.currentIndex === 0) {
                        const index = this.stateManager.queue.findIndex(item => item.cfi === book.lastPlayedCfi);
                        if (index >= 0) this.stateManager.jumpTo(index);
                    }
                    if (book.lastPauseTime) return this.resumeInternal();
                }
            } catch (e) {
                logger.warn("Failed to restore playback state", e);
            }
        }

        const item = this.stateManager.getCurrentItem();
        flightRecorder.record('APS', 'playInternal', {
            index: this.stateManager.currentIndex,
            textPreview: item?.text,
            cfi: item?.cfi
        });

        if (!item) {
            this.setStatus('stopped');
            // notifyListeners handled by setStatus
            return;
        }

        if (this.status !== 'playing') {
            const engaged = this.metadata.engageBackgroundMode(item);
            if (this.currentBookId !== initialBookId) return;

            if (!engaged && this.ctx.platform.getPlatform() === 'android') {
                this.setStatus('stopped');
                this.notifyError("Cannot play in background");
                return;
            }
            this.setStatus('loading');
        }

        // Ensure persistence before play (deduped on queueId — a no-op unless
        // the queue content changed since the last persist).
        this.persistQueueNow();

        try {
            const voiceId = this.voiceId || '';

            if (!this.activeLexicon) {
                const bookLang = initialBookId ? this.ctx.book.getBookLanguage(initialBookId) : 'en';
                this.activeLexicon = await this.ctx.lexicon.getCompiled(initialBookId || undefined, bookLang);
                if (this.currentBookId !== initialBookId) return;
            }
            const rules = this.activeLexicon.rules;

            const processedText = lexiconApplier.applyLexicon(item.text, rules);

            await this.providerManager.play(processedText, {
                voiceId,
                speed: this.speed
            });

            if (this.stateManager.hasNext()) {
                const nextItem = this.stateManager.queue[this.stateManager.currentIndex + 1];
                const nextProcessed = lexiconApplier.applyLexicon(nextItem.text, rules);
                this.providerManager.preload(nextProcessed, {
                    voiceId,
                    speed: this.speed
                });
            }

        } catch (e) {
            if (isPlaybackInterruption(e)) {
                // Deliberate stop/swap aborted the synthesis mid-flight — the stop
                // path already owns the status; surfacing it would toast the user
                // for their own action.
                logger.debug("Playback start interrupted", e);
                return;
            }
            if (isProviderPlaybackError(e) && this.currentProviderId !== 'local') {
                // The single failure path: providers reject exactly once; the manager
                // rethrows typed and does NOT self-swap. Recovery completes INSIDE the
                // task that observed the failure (one sequenced task end-to-end,
                // 5b-PR3) — the failed sentence replays exactly once.
                logger.warn("Cloud provider failed to start playback; falling back to local provider", e);
                await this.recoverWithLocalProvider();
                return;
            }
            logger.error("Play error", e);
            this.setStatus('stopped');
            this.notifyError(e instanceof Error ? e.message : "Playback error");
        }
    }

    private async resumeInternal(): Promise<void> {
        this.sessionRestored = true;
        return this.playInternal(true);
    }

    pause() {
        this.dragnet.armPause();
        return this.enqueue('pause', async () => {
            flightRecorder.record('APS', 'pause', { index: this.stateManager.currentIndex });
            this.providerManager.pause();
            this.setStatus('paused');
            // Persist best-effort, OUTSIDE the sequencer. The session-state IndexedDB
            // write can hang indefinitely on WebKit (its transaction never settles);
            // awaiting it here would wedge the TaskSequencer so every subsequent
            // play/pause/skip task queues behind it forever (isPlaying never flips,
            // skip never advances). Detach it so playback control stays responsive.
            // (The policy lives on the SessionStore port — see EngineContext.)
            void this.savePlaybackState('paused').catch(() => {});
        });
    }

    stop() {
        // Context-switch command (§5b.3): bump before enqueueing ourselves so
        // previously queued playback tasks (play/loadSection) cancel at their
        // checkpoints instead of racing the stop.
        this.taskSequencer.bumpEpoch('stop');
        this.cancelPendingSeek();
        return this.enqueue('stop', async () => {
            await this.stopInternal();
        });
    }

    private async stopInternal() {
        flightRecorder.record('APS', 'stop', { status: this.status });
        // Detach the persistence write (see pause()): on WebKit the session-state
        // IndexedDB transaction can hang and would otherwise wedge the sequencer.
        void this.savePlaybackState('stopped').catch(() => {});
        await this.platformIntegration.stop();
        this.setStatus('stopped');
        this.providerManager.stop();
    }

    next() {
        return this.enqueue('next', async () => {
            flightRecorder.record('APS', 'next', { hasNext: this.stateManager.hasNext() });
            if (this.stateManager.hasNext()) {
                this.stateManager.next();
                if (this.status === 'paused') this.setStatus('stopped');
                await this.playInternal();
            } else {
                await this.stopInternal();
            }
        });
    }

    prev() {
        return this.enqueue('prev', async () => {
            flightRecorder.record('APS', 'prev', { hasPrev: this.stateManager.hasPrev() });
            if (this.stateManager.hasPrev()) {
                this.stateManager.prev();
                if (this.status === 'paused') this.setStatus('stopped');
                await this.playInternal();
            }
        });
    }

    setLanguage(lang: string) {
        this.providerManager.setLocale(lang);
    }

    setSpeed(speed: number) {
        if (this.speed === speed) return;
        this.speed = speed;
        return this.enqueue('setSpeed', async () => {
            if (this.status === 'playing' || this.status === 'loading') {
                this.providerManager.stop();
                await this.playInternal();
            }
        });
    }

    seekTo(time: number) {
        // A scrubber drag is NAVIGATION, not a pause→resume "Dragnet" gesture.
        // The OS media controls surface a drag as pause → seekto(×N) → play, and
        // a quick grab-drag-release lands inside the 5s Dragnet capture window —
        // so without this it captures a spurious audio-bookmark. Disarm here,
        // mirroring the loadSection / section-change invalidation. (Cleared
        // synchronously, like pause()'s armPause(), so it wins regardless of how
        // the burst interleaves with the sequencer.)
        this.dragnet.clear('seekTo');

        // Coalesce the burst: keep only the latest target and apply it once the
        // drag settles (see the SEEK_SETTLE_MS field doc). seekTo is fire-and-
        // forget on every transport (WorkerTtsEngine / WorkerEngineHandle /
        // createWorkerEngineClient never await it), so returning before the
        // commit runs is safe.
        this.pendingSeekTime = time;
        this.pendingSeekQueueId = this.stateManager.queueId;
        this.armSeekSettle();
        return Promise.resolve();
    }

    /** (Re)start the settle timer that commits the coalesced scrub target. */
    private armSeekSettle(): void {
        if (this.seekSettleTimer !== null) clearTimeout(this.seekSettleTimer);
        this.seekSettleTimer = setTimeout(() => {
            this.seekSettleTimer = null;
            void this.enqueue('seekTo', (ctx) => this.commitPendingSeek(ctx));
        }, PlaybackController.SEEK_SETTLE_MS);
    }

    /** Drop a pending scrub without applying it (a context switch made it stale). */
    private cancelPendingSeek(): void {
        if (this.seekSettleTimer !== null) {
            clearTimeout(this.seekSettleTimer);
            this.seekSettleTimer = null;
        }
        this.pendingSeekTime = null;
        this.pendingSeekQueueId = null;
    }

    /**
     * Take the pending scrub target IF it is still valid for the current queue,
     * always clearing the pending state + timer. Returns null (skip the seek)
     * when nothing is pending, the queue emptied, or the queue identity changed
     * since the scrub began — a section/chapter/book navigation (loadSection,
     * skipTo*, advanceToNextChapter, setBookId) stamps a fresh queueId, so a
     * scrub that outlived its section is dropped rather than mis-applied to the
     * new one. (A plain stop keeps the queueId, hence the explicit
     * {@link cancelPendingSeek} on the stop path.)
     */
    private consumePendingSeek(): number | null {
        if (this.seekSettleTimer !== null) {
            clearTimeout(this.seekSettleTimer);
            this.seekSettleTimer = null;
        }
        const time = this.pendingSeekTime;
        const forQueue = this.pendingSeekQueueId;
        this.pendingSeekTime = null;
        this.pendingSeekQueueId = null;
        if (time === null) return null;
        if (forQueue !== this.stateManager.queueId) return null;
        if (this.stateManager.queue.length === 0) return null;
        return time;
    }

    /**
     * Apply the coalesced scrub target inside a sequenced task: move the queue
     * index to the settled time, then — only if playback was live — re-synthesize
     * from the new position. This is the body the old seekTo ran on EVERY tick,
     * now run ONCE per drag. A no-op if the target was already flushed by a
     * takeover (play), cancelled by a context switch, or invalidated by a queue
     * change after the timer was armed.
     */
    private async commitPendingSeek(ctx: TaskContext): Promise<void> {
        ctx.checkpoint();
        const time = this.consumePendingSeek();
        if (time === null) return;

        const wasPlaying = (this.status === 'playing' || this.status === 'loading');
        const changed = this.stateManager.seekToTime(time);

        if (!changed) {
            if (this.stateManager.hasNext()) {
                this.stateManager.next();
            } else {
                await this.advanceToNextChapter();
                return;
            }
        }

        if (wasPlaying) {
            this.providerManager.stop();
            await this.playInternal();
        }
        // else: paused/stopped — the index moved and the state-manager
        // subscription already pushed fresh metadata/position; nothing to synth.
    }

    /**
     * Settle a pending scrub onto its final index IMMEDIATELY, without
     * re-synthesizing — the calling command (play) owns playback from here.
     * Lets play() resume at the dropped position instead of racing
     * {@link armSeekSettle}'s timer. Runs inside the caller's sequenced task
     * (queue mutation is allowed there); safe when no scrub is pending.
     */
    private takeOverPendingSeek(): void {
        const time = this.consumePendingSeek();
        if (time === null) return;
        const changed = this.stateManager.seekToTime(time);
        if (!changed && this.stateManager.hasNext()) {
            this.stateManager.next();
        }
    }

    seek(offset: number) {
        return this.enqueue('seek', async () => {
            if (offset > 0) {
                if (this.stateManager.hasNext()) {
                    this.stateManager.next();
                    await this.playInternal();
                } else {
                    await this.advanceToNextChapter();
                }
            } else {
                if (this.stateManager.hasPrev()) {
                    this.stateManager.prev();
                    await this.playInternal();
                } else {
                    await this.retreatToPreviousChapter();
                }
            }
        });
    }

    setVoice(voiceId: string) {
        if (this.voiceId === voiceId) return;
        this.voiceId = voiceId;
        return this.enqueue('setVoice', async () => {
            if (this.status === 'playing' || this.status === 'loading') {
                this.providerManager.stop();
                await this.playInternal();
            }
        });
    }

    /**
     * The provider's `end` event, executed as the sequenced `provider.end`
     * task (5b-PR3): record history, then advance to the next visible item,
     * the next chapter, or completion.
     */
    private async handlePlaybackEnded(): Promise<void> {
        if (this.isPreviewing) {
            this.isPreviewing = false;
            this.setStatus('stopped');
            return;
        }
        if (this.status === 'stopped') return;

        if (this.currentBookId) {
            const item = this.stateManager.getCurrentItem();
            if (item && item.cfi && !item.isPreroll) {
                try {
                    this.ctx.readingState.addCompletedRange(this.currentBookId, item.cfi, 'tts');
                } catch (e) {
                    logger.error("Failed to update history", e);
                }
            }
        }

        const hasNext = this.stateManager.hasNext();
        flightRecorder.record('APS', 'playNext', {
            index: this.stateManager.currentIndex,
            hasNext,
            queueLen: this.stateManager.queue.length
        });

        if (hasNext) {
            this.platformIntegration.setBackgroundAudioMode(this.platformIntegration.getBackgroundAudioMode(), true);

            this.stateManager.next();
            await this.playInternal();
        } else {
            const loaded = await this.advanceToNextChapter();
            if (!loaded) {
                flightRecorder.record('APS', 'playNext.completed');
                this.setStatus('completed');
            }
        }
    }

    private setStatus(status: TTSStatus) {
        this.assertSequencedMutation('setStatus');
        const oldStatus = this.status;
        if ((oldStatus === 'playing' || oldStatus === 'loading') && (status === 'paused' || status === 'stopped')) {
            if (this.currentBookId) {
                const item = this.stateManager.getCurrentItem();
                if (item && item.cfi && !item.isPreroll) {
                    try {
                        this.ctx.readingState.addCompletedRange(this.currentBookId, item.cfi, 'tts');
                    } catch (e) {
                        logger.error("Failed to update history", e);
                    }
                }
            }
        }

        flightRecorder.record('APS', 'status', { from: oldStatus, to: status });
        this.status = status;

        if (status === 'stopped' || status === 'paused') {
            this.activeLexicon = null;
        }

        this.platformIntegration.updatePlaybackState(status);

        const currentCfi = (this.stateManager.getCurrentItem() && (status === 'playing' || status === 'loading' || status === 'paused'))
            ? this.stateManager.getCurrentItem()!.cfi
            : null;

        this.publishSnapshot({ activeCfi: currentCfi });
    }

    /**
     * THE single emission point of the engine (5b-PR2; §5b.2): every outbound
     * notification — queue changes, status transitions, errors, download
     * progress — funnels through here and leaves as one immutable
     * {@link PlaybackSnapshot} with a monotonic `seq`. The queue itself is
     * attached only when its content identity (`queueId`) changed since the
     * last publish (P23's broadcast diet); consumers keep their cached array
     * otherwise.
     */
    private publishSnapshot(opts: {
        activeCfi?: string | null;
        error?: PlaybackError | null;
        download?: DownloadInfo | null;
    } = {}) {
        const queueId = this.stateManager.queueId;
        const includeQueue = queueId !== this.lastPublishedQueueId;
        this.lastPublishedQueueId = queueId;

        const snapshot: PlaybackSnapshot = {
            seq: ++this.seq,
            status: this.status,
            queueId,
            ...(includeQueue ? { queue: this.stateManager.queue } : {}),
            index: this.stateManager.currentIndex,
            sectionIndex: this.stateManager.currentSectionIndex,
            activeCfi: opts.activeCfi !== undefined
                ? opts.activeCfi
                : (this.stateManager.getCurrentItem()?.cfi || null),
            error: opts.error ?? null,
            download: opts.download ?? null,
        };
        this.listeners.forEach(l => l(snapshot));
    }

    /** The latest playback state as a full snapshot (queue always attached). */
    public snapshot(): PlaybackSnapshot {
        return {
            seq: this.seq,
            status: this.status,
            queueId: this.stateManager.queueId,
            queue: this.stateManager.queue,
            index: this.stateManager.currentIndex,
            sectionIndex: this.stateManager.currentSectionIndex,
            activeCfi: this.stateManager.getCurrentItem()?.cfi || null,
            error: null,
            download: null,
        };
    }

    subscribe(listener: SnapshotListener): () => void {
        let isSubscribed = true;
        this.listeners.push(listener);
        // Replay the current state on the next tick (full snapshot incl. queue),
        // mirroring the pre-snapshot subscribe semantics (state read at fire time).
        setTimeout(() => {
            if (isSubscribed) {
                listener(this.snapshot());
            }
        }, 0);
        return () => {
            isSubscribed = false;
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private notifyError(message: string, code: string = 'TTS_PLAYBACK_ERROR') {
        this.publishSnapshot({ error: { code, message } });
    }

    private notifyDownloadProgress(voiceId: string, percent: number, status: string) {
        this.publishSnapshot({ download: { voiceId, percent, status } });
    }

    // --- Diagnostics (S9: served over the engine handle so the UI reads the
    // ENGINE-side flight recorder — in production, the worker's instance) ---

    async exportDiagnostics(): Promise<FlightRecorderExport> {
        return flightRecorder.exportForHandle();
    }

    triggerDiagnosticsSnapshot(trigger: string, note: string = ''): Promise<string | null> {
        return flightRecorder.snapshot(trigger, note);
    }

    /** Persist queue content NOW (deduped on queueId; reset/empty never persists). */
    private persistQueueNow(): void {
        if (!this.currentBookId) return;
        const queue = this.stateManager.queue;
        if (queue.length === 0) return;
        if (this.stateManager.queueId === this.lastPersistedQueueId) return;
        this.lastPersistedQueueId = this.stateManager.queueId;
        this.ctx.session.persistQueue(this.currentBookId, queue);
    }

    private async loadSectionInternal(sectionIndex: number, autoPlay: boolean, sectionTitle?: string): Promise<boolean> {
        if (!this.currentBookId || sectionIndex < 0 || sectionIndex >= this.playlist.length) return false;

        // Clear dragnet state on navigation to prevent capturing previous section context
        this.dragnet.clear('loadSection');
        this.analysis.reset();

        const section = this.playlist[sectionIndex];
        const bookId = this.currentBookId;

        // --- Host orchestration of the PURE SectionQueueBuilder (5c-PR2;
        // phase5-tts-strangler.md §5c.2): fetch content, resolve the title,
        // build — then the HOST writes the reader UI. The builder never
        // touches ports.
        let newQueue: TTSQueueItem[] | null = null;
        let content: SectionContent | null = null;
        try {
            const ttsContent = await this.ctx.content.getTTSPreparation(bookId, section.sectionId);
            content = {
                sentences: ttsContent?.sentences || [],
                citationMarkers: ttsContent?.citationMarkers || [],
            };

            const bookMetadata = await this.ctx.book.getMetadata(bookId);
            const language = bookMetadata?.language || 'en';

            const title = await resolveSectionTitle(
                { contentAnalysis: this.ctx.contentAnalysis, content: this.ctx.content },
                { bookId, sectionId: section.sectionId, metadata: bookMetadata, spineTitle: sectionTitle || section.title },
            );

            const settings = this.ctx.config.getSettings();
            const biblePref = await this.ctx.lexicon.getBibleLexiconPreference(bookId);
            const includeBible = resolveBiblePreference(biblePref, settings.isBibleLexiconEnabled);

            const built = buildSectionQueue(content.sentences, {
                abbreviations: await this.abbreviations.merge(settings.customAbbreviations, includeBible),
                alwaysMerge: settings.alwaysMerge,
                sentenceStarters: settings.sentenceStarters,
                minSentenceLength: settings.profiles[language]?.minSentenceLength
                    ?? this.ctx.config.getDefaultMinSentenceLength(language),
                language,
            }, {
                sectionTitle: title,
                sectionIndex,
                prerollEnabled: this.prerollEnabled,
                speed: this.speed,
                characterCount: section.characterCount,
            });
            newQueue = built.queue;

            // Sync the Reader UI (CompassPill stays accurate during auto-advance).
            // The HOST write — the pipeline never touches UI ports again (§5c.2).
            this.ctx.readerUI.setCurrentSection(built.title, section.sectionId);
        } catch (e) {
            logger.error("Failed to load section content", e);
            newQueue = null;
        }

        flightRecorder.record('APS', 'loadSectionInternal', {
            sectionIndex,
            sectionId: section.sectionId,
            queueLen: newQueue?.length || 0,
            autoPlay
        });

        if (newQueue && newQueue.length > 0) {
            if (autoPlay) {
                this.providerManager.stop();
                // Detached persistence (see pause()): never let the session-state
                // IndexedDB write wedge cross-section navigation on WebKit.
                void this.savePlaybackState('stopped').catch(() => {});
                this.setStatus('loading');
            } else {
                await this.stopInternal();
            }

            this.stateManager.setQueue(newQueue, 0, sectionIndex);
            // Automatic persist and notify (the state-manager subscription).

            if (autoPlay) {
                await this.playInternal();
            }

            this.analysis.applyCachedAnalysis(this.currentBookId, section.sectionId);
            // ONE analysis trigger, carrying {sentences, citationMarkers} TOGETHER
            // (D4 — the legacy split between a markers-less loadSection trigger and
            // a fetch-everything refresh trigger is gone).
            void this.analysisDriver.triggerAnalysis(
                bookId,
                section.sectionId,
                content ?? undefined,
                this.analysis.maskCallback(bookId, sectionIndex, section.sectionId),
                this.analysis.adaptationsCallback(bookId, sectionIndex)
            );
            void this.analysisDriver.prewarmNextSection(this.currentBookId, sectionIndex, this.playlist);
            return true;
        }

        return false;
    }

    private async advanceToNextChapter(): Promise<boolean> {
        if (!this.currentBookId || this.playlist.length === 0) return false;

        let nextSectionIndex = this.stateManager.currentSectionIndex + 1;
        if (this.stateManager.currentSectionIndex === -1) nextSectionIndex = 0;

        while (nextSectionIndex < this.playlist.length) {
            flightRecorder.record('APS', 'playNext.advance', {
                fromSection: this.stateManager.currentSectionIndex,
                toSection: nextSectionIndex
            });
            const loaded = await this.loadSectionInternal(nextSectionIndex, true);
            if (loaded) return true;
            nextSectionIndex++;
        }
        return false;
    }

    private async retreatToPreviousChapter(): Promise<boolean> {
        if (!this.currentBookId || this.playlist.length === 0) return false;

        let prevSectionIndex = this.stateManager.currentSectionIndex - 1;

        while (prevSectionIndex >= 0) {
            // Load without autoplay
            const loaded = await this.loadSectionInternal(prevSectionIndex, false);
            if (loaded) {
                // Jump to end
                this.stateManager.jumpToEnd();
                await this.playInternal();
                return true;
            }
            prevSectionIndex--;
        }
        return false;
    }

    private async savePlaybackState(status: TTSStatus) {
        if (!this.currentBookId) return;

        // updatePlaybackPosition in Yjs
        const currentItem = this.stateManager.getCurrentItem();
        const lastPlayedCfi = (currentItem && currentItem.cfi) ? currentItem.cfi : undefined;

        if (lastPlayedCfi) {
            this.ctx.readingState.updatePlaybackPosition(this.currentBookId, lastPlayedCfi);
        }

        // Persist the pause timestamp through the SessionStore port (callers
        // detach this promise — the WebKit policy on the port).
        const isPaused = status === 'paused';
        await this.ctx.session.persistPauseTime(this.currentBookId, isPaused ? Date.now() : null);
    }
}

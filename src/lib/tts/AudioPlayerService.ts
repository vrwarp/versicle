import { isPlaybackInterruption, isProviderPlaybackError } from './providers/types';
import type { ITTSProvider, TTSVoice } from './providers/types';
import type { TTSQueueItem } from '~types/tts';
import { lexiconApplier } from './LexiconApplier';
import { bookContent } from '@data/repos/bookContent';
import { playbackCache } from '@data/repos/playbackCache';
import type { SectionMetadata, LexiconRule, PerceptualPalette } from '~types/db';
import { TaskSequencer, type TaskContext } from './TaskSequencer';
import { AudioContentPipeline } from './AudioContentPipeline';
import { QueueModel } from './QueueModel';
import type { PlaybackBackend, PlaybackBackendFactory, TTSProviderEvents } from './engine/PlaybackBackend';
import type {
    TtsEngine,
    TTSStatus,
    DownloadInfo,
    PlaybackError,
    PlaybackSnapshot,
    SnapshotListener,
} from './engine/TtsEngine';
import type { MediaPlatform, MediaPlatformFactory } from './PlatformIntegration';
import { flightRecorder } from './TTSFlightRecorder';
import type { SectionAnalysis, TableAdaptation, EngineContext } from './engine/EngineContext';
import { mergeCfiSlow } from '../cfi-utils';
import { createLogger } from '../logger';
import { normalizeLanguageCode } from '../language-utils';
import { coverUrl } from '@data/covers';

const logger = createLogger('AudioPlayerService');

/**
 * Canonical home of {@link TTSQueueItem} is src/types/tts.ts (Phase 1a type
 * split, layering-deps.md LD-1): types/db.ts (CacheSessionState.playbackQueue,
 * TTSState.queue) needs it and the types layer may not import lib/tts.
 * Canonical home of the engine contract — {@link TtsEngine},
 * {@link PlaybackSnapshot}, {@link TTSStatus}, {@link DownloadInfo} — is
 * src/lib/tts/engine/TtsEngine.ts (5b-PR2: TtsEngine is a STANDALONE
 * interface, no longer a Pick of this class; the positional PlaybackListener
 * tuple is gone). Re-exported here (type-only, zero runtime change) so
 * existing consumers keep compiling.
 */
export type { TTSQueueItem } from '~types/tts';
export type {
    TtsEngine,
    TTSStatus,
    DownloadInfo,
    PlaybackError,
    PlaybackSnapshot,
    SnapshotListener,
} from './engine/TtsEngine';

/**
 * Singleton service that manages Text-to-Speech playback.
 * Handles queue management, provider switching (Local/Cloud), synchronization,
 * media session integration, and state persistence.
 */
export class AudioPlayerService implements TtsEngine {
    readonly engineName: string = 'AudioPlayerService';
    // Components
    // TaskSequencer ensures async operations are executed serially to prevent race conditions.
    private taskSequencer = new TaskSequencer();
    // AudioContentPipeline handles loading content, GenAI filtering, and text refinement.
    // Assigned in the constructor so it shares the service's injected EngineContext.
    private contentPipeline: AudioContentPipeline;
    // QueueModel manages the queue (immutably), current index, and position calculations.
    private stateManager = new QueueModel();

    private readonly ctx: EngineContext;
    private providerManager: PlaybackBackend;
    private platformIntegration: MediaPlatform;

    private status: TTSStatus = 'stopped';
    private listeners: SnapshotListener[] = [];
    /** Monotonic snapshot sequence (5b-PR2 single channel). */
    private seq = 0;
    /** The queueId carried by the previously PUBLISHED snapshot (broadcast diet). */
    private lastPublishedQueueId: string | null = null;
    private activeLexiconRules: LexiconRule[] | null = null;
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
    private playlist: SectionMetadata[] = [];
    private playlistPromise: Promise<void> | null = null;
    private sessionRestored: boolean = false;
    private prerollEnabled: boolean = false;
    private isPreviewing: boolean = false;
    private lastAppliedAnalysisSectionId: string | null = null;
    private lastAppliedAnalysisTimestamp: number = 0;
    private lastUserPauseTimestamp: number | null = null;
    private currentBookPalette: number[] | undefined = undefined;
    private currentBookPerceptualPalette: PerceptualPalette | undefined = undefined;
    private currentBookTitle: string = '';
    private currentBookAuthor: string = '';
    private currentBookCoverUrl: string | undefined = undefined;

    private constructor(
        ctx: EngineContext,
        backendFactory: PlaybackBackendFactory,
        platformFactory: MediaPlatformFactory,
    ) {
        this.ctx = ctx;
        this.contentPipeline = new AudioContentPipeline(this.ctx);

        // Subscribe to content analysis changes (Reactive Injection)
        this.ctx.contentAnalysis.subscribe((state) => {
            this.handleContentAnalysisUpdate(state);
        });

        this.platformIntegration = platformFactory({
            onPlay: () => this.play(),
            onPause: () => this.pause(),
            onStop: () => this.stop(),
            onPrev: () => this.prev(),
            onNext: () => this.next(),
            onSeek: (offset) => this.seek(offset),
            onSeekTo: (time) => this.seekTo(time),
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
                    // THIS task (one sequenced task end-to-end — swap + replay; the
                    // legacy un-enqueued `playInternal(true)` S1 escape hatch and the
                    // task-per-trigger indirection are both gone). The manager no
                    // longer self-swaps or emits synthetic 'fallback' events, so this
                    // is the only fallback trigger on the event channel.
                    if (this.currentProviderId !== 'local') {
                        logger.warn("Cloud provider error during playback; falling back to local provider", error);
                        await this.recoverWithLocalProvider();
                        return;
                    }

                    logger.error("TTS Provider Error", error);
                    this.setStatus('stopped');
                    this.notifyError("Playback Error: " + (error?.message || "Unknown error"));
                });
            },
            onTimeUpdate: (currentTime) => {
                this.updateSectionMediaPosition(currentTime);
            },
            onDownloadProgress: (voiceId, percent, status) => {
                this.notifyDownloadProgress(voiceId, percent, status);
            }
        };
        this.providerManager = backendFactory(providerEvents);

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
            this.updateMediaSessionMetadata();
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
                this.activeLexiconRules = null;

                // If playing, restart to apply the new voice/language immediately.
                // Sequenced (5b-PR3): this was the second un-enqueued playInternal
                // call site (S1) — a store subscription must not drive the FSM
                // outside the sequencer.
                if (this.status === 'playing' || this.status === 'loading') {
                    void this.enqueue('languageSync.restart', () => this.playInternal(true));
                }
            }
        });

        // Subscribe to GenAI settings changes for hot-swapping behavior and late-hydration support
        this.ctx.genAI.subscribe(() => {
            const bookId = this.currentBookId;
            if (!bookId) return;

            const sectionIndex = this.stateManager.currentSectionIndex;
            if (sectionIndex === -1) return;

            const section = this.playlist[sectionIndex];
            if (!section) return;

            // Reset timestamp to force re-application or clearing of mask
            this.lastAppliedAnalysisSectionId = null;
            this.lastAppliedAnalysisTimestamp = 0;

            this.applyCachedAnalysis(bookId, section.sectionId);
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
        // happen ONLY inside a running sequenced task. A crashing invariant in
        // dev/test instead of a convention — the known violators (provider
        // events, dragnet, setBookId's reset, the language-sync restart, the
        // async mask/adaptation callbacks) were sequenced in the same change,
        // so the assert is born green.
        if (import.meta.env.DEV) {
            this.stateManager.setMutationGuard((op) => this.assertSequencedMutation(`QueueModel.${op}`));
        }
    }

    private assertSequencedMutation(op: string): void {
        if (import.meta.env.DEV && !this.taskSequencer.isInsideTask()) {
            throw new Error(
                `[AudioPlayerService] ${op} outside a sequenced task — status/queue ` +
                'mutations must run through the TaskSequencer (5b-PR3 C4 invariant; ' +
                'plan/overhaul/prep/phase5-tts-strangler.md §5b.3)',
            );
        }
    }

    /**
     * Construct an AudioPlayerService with an explicitly injected context and playback
     * backend. This is the ONLY construction path: the main thread uses it via
     * {@link getAudioPlayer} (Zustand context + TTSProviderManager), tests use it with fakes,
     * and a worker shell uses it with a message-channel-backed context + proxy backend.
     * Keeping both dependencies injected (no defaults) is what keeps this module free of
     * worker-unsafe imports. See {@link EngineContext} and {@link PlaybackBackend}.
     */
    static createWithContext(
        ctx: EngineContext,
        backendFactory: PlaybackBackendFactory,
        platformFactory: MediaPlatformFactory,
    ): AudioPlayerService {
        return new AudioPlayerService(ctx, backendFactory, platformFactory);
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

        if (bookId) {
            // Proactively sync language to ensure proper voices are loaded before playback starts
            const currentLang = normalizeLanguageCode(this.ctx.book.getBookLanguage(bookId));
            if (currentLang !== this.ctx.config.getActiveLanguage()) {
                this.ctx.config.setActiveLanguage(currentLang);
            }
        }

        this.currentBookId = bookId;
        this.sessionRestored = false;
        this.lastAppliedAnalysisSectionId = null;
        this.lastAppliedAnalysisTimestamp = 0;
        this.currentBookPalette = undefined;
        this.currentBookPerceptualPalette = undefined;
        this.currentBookTitle = '';
        this.currentBookAuthor = '';
        this.currentBookCoverUrl = undefined;
        this.activeLexiconRules = null;
        this.lastUserPauseTimestamp = null;

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
            this.stateManager.setBookId(bookId);
        });

        if (bookId) {
            this.ctx.book.getMetadata(bookId).then(metadata => {
                if (this.currentBookId === bookId) {
                    this.currentBookPalette = metadata?.coverPalette;
                    this.currentBookPerceptualPalette = metadata?.perceptualPalette;
                    this.currentBookTitle = metadata?.title || '';
                    this.currentBookAuthor = metadata?.author || '';
                    this.currentBookCoverUrl = metadata?.coverUrl || (metadata?.coverBlob ? coverUrl(bookId) : undefined);
                    this.updateMediaSessionMetadata();
                }
            }).catch(e => logger.warn("Failed to load book metadata", e));

            this.playlistPromise = bookContent.getSections(bookId).then(sections => {
                if (this.currentBookId !== bookId) return; this.playlist = sections;
                this.restoreQueue(bookId);
            }).catch(e => logger.error("Failed to load playlist", e));
        } else {
            this.playlist = [];
            this.playlistPromise = null;
        }

        return reset as Promise<void>;
    }

    private async engageBackgroundMode(item: TTSQueueItem): Promise<boolean> {
        try {
            this.platformIntegration.updateMetadata({
                title: item.title || 'Chapter Text',
                artist: this.currentBookAuthor || 'Versicle',
                album: this.currentBookTitle || '',
                artwork: this.currentBookCoverUrl ? [{ src: this.currentBookCoverUrl }] : [],
                coverPalette: this.currentBookPalette,
                perceptualPalette: this.currentBookPerceptualPalette,
                sectionIndex: this.stateManager.currentSectionIndex,
                totalSections: this.playlist.length,
                progress: this.calculateBookProgress()
            });
            this.platformIntegration.updatePlaybackState('playing');
            return true;
        } catch (e) {
            logger.error('Background engagement failed', e);
            return false;
        }
    }

    private updateSectionMediaPosition(providerTime: number) {
        const position = this.stateManager.getCurrentPosition(providerTime);
        const duration = this.stateManager.getTotalDuration();

        const safeDuration = Math.max(duration, position);

        this.platformIntegration.setPositionState({
            duration: safeDuration,
            playbackRate: this.speed,
            position: position
        });
    }

    private async restoreQueue(bookId: string) {
        // NOTE: the book-id guard below is deliberately NOT converted to
        // ctx.checkpoint(): stop() also bumps the epoch, and a user stop
        // between setBookId and the playlist resolving must not cancel the
        // restore (the queue should still be there for the next play). The
        // epoch conversion for this task rides the decomposition PR with a
        // P12 rider of its own.
        this.enqueue('restoreQueue', async () => {
            try {
                const session = await playbackCache.getSession(bookId);
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

                    this.stateManager.setQueue(cleanedQueue, currentIndex, sectionIndex);
                    // Subscription handles metadata and listeners

                    // Trigger background content analysis (GenAI) for the restored section
                    if (sectionIndex >= 0 && sectionIndex < this.playlist.length) {
                        const section = this.playlist[sectionIndex];

                        this.applyCachedAnalysis(bookId, section.sectionId);

                        this.contentPipeline.triggerAnalysis(
                            bookId,
                            section.sectionId,
                            undefined, // will fetch from DB
                            this.sequencedMaskCallback(bookId, sectionIndex, section.sectionId),
                            this.sequencedAdaptationsCallback(bookId, sectionIndex)
                        );
                    }
                }
            } catch (e) {
                logger.error("Failed to restore TTS queue", e);
            }
        });
    }

    /**
     * The content pipeline reports skip masks / table adaptations through
     * detached async callbacks (triggerAnalysis runs in the background) —
     * which used to mutate the queue OUTSIDE the sequencer (S3-adjacent).
     * These wrappers enqueue the mutation with the book/section guard
     * evaluated inside the task (5b-PR3; the AnalysisApplier absorbs all
     * three call sites in the decomposition PR).
     */
    private sequencedMaskCallback(bookId: string, sectionIndex: number, sectionId: string) {
        return (mask: Set<number>) => {
            void this.enqueue('analysis.maskCallback', async () => {
                if (this.currentBookId === bookId && this.stateManager.currentSectionIndex === sectionIndex) {
                    this.stateManager.applySkippedMask(mask, sectionId);
                }
            });
        };
    }

    private sequencedAdaptationsCallback(bookId: string, sectionIndex: number) {
        return (adaptations: { indices: number[], text: string }[]) => {
            void this.enqueue('analysis.adaptationsCallback', async () => {
                if (this.currentBookId === bookId && this.stateManager.currentSectionIndex === sectionIndex) {
                    this.stateManager.applyTableAdaptations(adaptations);
                }
            });
        };
    }

    private updateMediaSessionMetadata() {
        const item = this.stateManager.getCurrentItem();
        if (item) {
            this.platformIntegration.updateMetadata({
                title: item.title || 'Chapter Text',
                artist: this.currentBookAuthor || 'Versicle',
                album: this.currentBookTitle || '',
                artwork: this.currentBookCoverUrl ? [{ src: this.currentBookCoverUrl }] : [],
                coverPalette: this.currentBookPalette,
                perceptualPalette: this.currentBookPerceptualPalette,
                sectionIndex: this.stateManager.currentSectionIndex,
                totalSections: this.playlist.length,
                progress: this.calculateBookProgress()
            });

            this.updateSectionMediaPosition(0);
        }
    }

    private calculateBookProgress(): number {
        if (!this.currentBookId || this.playlist.length === 0) return 0;

        let totalChars = 0;
        let completedChars = 0;

        for (let i = 0; i < this.playlist.length; i++) {
            const section = this.playlist[i];
            totalChars += section.characterCount || 0;

            if (i < this.stateManager.currentSectionIndex) {
                completedChars += section.characterCount || 0;
            } else if (i === this.stateManager.currentSectionIndex) {
                // Add characters consumed within the current section
                // prefixSums[index] gives cumulative chars before index in the current queue.
                if (this.stateManager.prefixSums && this.stateManager.currentIndex >= 0) {
                    completedChars += this.stateManager.prefixSums[this.stateManager.currentIndex];
                }
            }
        }

        if (totalChars === 0) return 0;
        return Math.min(Math.max(completedChars / totalChars, 0), 1);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public setBackgroundAudioMode(mode: any) {
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

    // Section skips are sequenced tasks (5b-PR3): they were the remaining
    // un-sequenced public paths that mutate the queue (via loadSectionInternal).
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
                // persist and notify are automatic.
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

    async play(): Promise<void> {
        flightRecorder.record('APS', 'play', { status: this.status });
        // Dragnet capture is part of the play task (5b-PR3): the pause->play
        // gesture check runs INSIDE the sequencer with the timestamp evaluated
        // at task time, instead of as an un-sequenced prelude (S3). A play that
        // went stale (stop/setBookId/loadSection bumped the epoch after it was
        // enqueued) cancels before capturing or synthesizing.
        return this.enqueue('play', async (ctx) => {
            ctx.checkpoint();
            const now = Date.now();
            logger.debug(`Play called. lastUserPauseTimestamp: ${this.lastUserPauseTimestamp}, diff: ${this.lastUserPauseTimestamp ? now - this.lastUserPauseTimestamp : 'N/A'}`);
            if (this.lastUserPauseTimestamp && (now - this.lastUserPauseTimestamp <= 5000)) {
                logger.debug('Triggering Dragnet Capture');
                await this.executeDragnetCapture();
            }
            this.lastUserPauseTimestamp = null;
            return this.playInternal();
        }) as Promise<void>;
    }

    private async executeDragnetCapture() {
        const queue = this.stateManager.queue;
        const currentIndex = this.stateManager.currentIndex;

        logger.debug(`executeDragnetCapture. currentIndex: ${currentIndex}, queueLength: ${queue.length}, currentBookId: ${this.currentBookId}`);

        // Boundary protection: don't cross chapter boundaries backwards
        const startIndex = Math.max(0, currentIndex - 1);
        const targetItems = queue.slice(startIndex, currentIndex + 1);

        logger.debug(`targetItems count: ${targetItems.length}`);

        if (targetItems.length === 0 || !this.currentBookId) {
            logger.warn('Dragnet Capture failed: no target items or no bookId');
            this.providerManager.playEarcon('bookmark_failed');
            return;
        }

        // 1. Concatenate Text
        const mergedText = targetItems.map((item: TTSQueueItem) => item.text).join(' ');

        // 2. Generate Spanning CFI
        let mergedCfi = targetItems[0].cfi;
        if (targetItems.length > 1 && targetItems[0].cfi && targetItems[1].cfi) {
            mergedCfi = mergeCfiSlow(targetItems[0].cfi, targetItems[1].cfi);
        }

        if (!mergedCfi) {
            this.providerManager.playEarcon('bookmark_failed');
            return;
        }

        // 3. Audio Feedback (Earcon)
        this.providerManager.playEarcon('bookmark_captured');

        // 4. Dispatch to Yjs Store
        this.ctx.annotations.add({
            bookId: this.currentBookId,
            cfiRange: mergedCfi,
            type: 'audio-bookmark',
            text: mergedText,
            color: '#ff9800' // Default color, won't be strictly used due to custom CSS
        });
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
            const engaged = await this.engageBackgroundMode(item);
            if (this.currentBookId !== initialBookId) return;

            if (!engaged && this.ctx.platform.getPlatform() === 'android') {
                this.setStatus('stopped');
                this.notifyError("Cannot play in background");
                return;
            }
            this.setStatus('loading');
        }

        // updateMediaSessionMetadata() and notifyListeners() are handled by listeners or setStatus
        this.stateManager.persistQueue(); // Ensure persistence before play.

        try {
            const voiceId = this.voiceId || '';

            if (!this.activeLexiconRules) {
                const bookLang = initialBookId ? this.ctx.book.getBookLanguage(initialBookId) : 'en';
                this.activeLexiconRules = await this.ctx.lexicon.getRules(initialBookId || undefined, bookLang);
                if (this.currentBookId !== initialBookId) return;
            }
            const rules = this.activeLexiconRules;

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

    async resume(): Promise<void> {
        return this.enqueue('resume', () => this.resumeInternal());
    }

    private async resumeInternal(): Promise<void> {
        this.sessionRestored = true;
        return this.playInternal(true);
    }

    pause() {
        this.lastUserPauseTimestamp = Date.now();
        return this.enqueue('pause', async () => {
            flightRecorder.record('APS', 'pause', { index: this.stateManager.currentIndex });
            this.providerManager.pause();
            this.setStatus('paused');
            // Persist best-effort, OUTSIDE the sequencer. The session-state IndexedDB
            // write can hang indefinitely on WebKit (its transaction never settles);
            // awaiting it here would wedge the TaskSequencer so every subsequent
            // play/pause/skip task queues behind it forever (isPlaying never flips,
            // skip never advances). Detach it so playback control stays responsive.
            void this.savePlaybackState('paused').catch(() => {});
        });
    }

    /**
     * Invalidate any pending pause→play "Dragnet" capture. Called synchronously when the
     * reader navigates to a different section (see useTTS). A chapter change between a
     * pause and a play is a deliberate navigation, not a resume gesture, so it must not
     * capture a stale audio-bookmark. This runs OUTSIDE the task sequencer so it always
     * precedes a subsequent play() — unlike the clear inside loadSectionInternal, which is
     * enqueued and can be skipped by the loadSectionBySectionId guard (or never reached
     * when the queue-sync early-returns while playing).
     */
    public clearPauseGesture(): void {
        if (this.lastUserPauseTimestamp !== null) {
            flightRecorder.record('APS', 'clearPauseGesture', {});
            this.lastUserPauseTimestamp = null;
        }
    }

    stop() {
        // Context-switch command (§5b.3): bump before enqueueing ourselves so
        // previously queued playback tasks (play/loadSection) cancel at their
        // checkpoints instead of racing the stop.
        this.taskSequencer.bumpEpoch('stop');
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
        return this.enqueue('seekTo', async () => {
            const changed = this.stateManager.seekToTime(time);
            const wasPlaying = (this.status === 'playing' || this.status === 'loading');

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
            }

            if (wasPlaying) {
                await this.playInternal();
            } else {
                // Subscription handles metadata/listeners.
            }
        });
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
     * task (5b-PR3; the former `playNext` + the preview-stop branch of the
     * event handler): record history, then advance to the next visible item,
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
            this.activeLexiconRules = null;
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

    private handleContentAnalysisUpdate(state: { sections: Record<string, SectionAnalysis> }) {
        const bookId = this.currentBookId;
        if (!bookId) return;

        const sectionIndex = this.stateManager.currentSectionIndex;
        if (sectionIndex === -1) return;

        const section = this.playlist[sectionIndex];
        if (!section) return;

        const key = `${bookId}/${section.sectionId}`;
        const analysis = state.sections[key];

        if (analysis && analysis.status === 'success') {
            // Skip if we've already processed this exact analysis update for this specific section
            if (this.lastAppliedAnalysisSectionId === section.sectionId && analysis.generatedAt <= this.lastAppliedAnalysisTimestamp) return;

            // Update timestamp synchronously to prevent concurrent duplicate enqueueing
            this.lastAppliedAnalysisSectionId = section.sectionId;
            this.lastAppliedAnalysisTimestamp = analysis.generatedAt;

            this.enqueue('analysis.apply', async () => {
                // Validate current context
                if (this.currentBookId !== bookId) return;
                const activeSection = this.playlist[this.stateManager.currentSectionIndex];
                if (!activeSection || activeSection.sectionId !== section.sectionId) return;

                const genAISettings = this.ctx.genAI.getSettings();

                // 1. Apply or clear Skip Mask
                if (genAISettings.isEnabled && genAISettings.isContentAnalysisEnabled && genAISettings.contentFilterSkipTypes.length > 0) {
                    const mask = await this.contentPipeline.detectContentSkipMask(bookId, section.sectionId, genAISettings.contentFilterSkipTypes);
                    if (mask.size > 0 && this.currentBookId === bookId && this.stateManager.currentSectionIndex === sectionIndex) {
                        this.stateManager.applySkippedMask(mask, section.sectionId);
                    }
                } else {
                    this.stateManager.applySkippedMask(new Set(), section.sectionId);
                }

                // 2. Apply or clear Table Adaptations
                if (genAISettings.isEnabled && genAISettings.isTableAdaptationEnabled && analysis.tableAdaptations) {
                    const ttsContent = await bookContent.getTTSPreparation(bookId, section.sectionId);
                    if (ttsContent && this.currentBookId === bookId && this.stateManager.currentSectionIndex === sectionIndex) {
                        const adaptations = this.contentPipeline.tableProcessor.mapSentencesToAdaptations(
                            ttsContent.sentences,
                            new Map(analysis.tableAdaptations.map((a: TableAdaptation) => [a.rootCfi, a.text]))
                        );
                        this.stateManager.applyTableAdaptations(adaptations);
                    }
                } else {
                    this.stateManager.applyTableAdaptations([]);
                }
            });
        }
    }

    private applyCachedAnalysis(bookId: string, sectionId: string) {
        const analysis = this.ctx.contentAnalysis.getAnalysis(bookId, sectionId);
        if (analysis && analysis.status === 'success') {
            this.handleContentAnalysisUpdate(this.ctx.contentAnalysis.getSnapshot());
        }
    }

    private notifyError(message: string, code: string = 'TTS_PLAYBACK_ERROR') {
        this.publishSnapshot({ error: { code, message } });
    }

    private notifyDownloadProgress(voiceId: string, percent: number, status: string) {
        this.publishSnapshot({ download: { voiceId, percent, status } });
    }

    public async checkBatteryOptimization() {
        if (this.ctx.platform.getPlatform() === 'android') {
            const isEnabled = await this.ctx.platform.isBatteryOptimizationEnabled();
            if (isEnabled) {
                // Prompt user to disable battery optimization for reliable background playback
                this.ctx.notifications.showToast(
                    'For reliable background playback, please disable battery optimization for this app.',
                    'info'
                );
                await this.ctx.platform.openBatteryOptimizationSettings();
            }
        }
    }

    private async loadSectionInternal(sectionIndex: number, autoPlay: boolean, sectionTitle?: string): Promise<boolean> {
        if (!this.currentBookId || sectionIndex < 0 || sectionIndex >= this.playlist.length) return false;

        // Clear dragnet state on navigation to prevent capturing previous section context
        this.lastUserPauseTimestamp = null;
        this.lastAppliedAnalysisSectionId = null;
        this.lastAppliedAnalysisTimestamp = 0;

        const section = this.playlist[sectionIndex];

        const bookId = this.currentBookId;
        const newQueue = await this.contentPipeline.loadSection(
            this.currentBookId,
            section,
            sectionIndex,
            this.prerollEnabled,
            this.speed,
            sectionTitle || section.title,
            this.sequencedMaskCallback(bookId, sectionIndex, section.sectionId),
            this.sequencedAdaptationsCallback(bookId, sectionIndex)
        );

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
            // Automatic persist and notify.

            if (autoPlay) {
                await this.playInternal();
            }

            this.applyCachedAnalysis(this.currentBookId, section.sectionId);
            this.contentPipeline.triggerAnalysis(this.currentBookId, section.sectionId, undefined);
            this.contentPipeline.triggerNextChapterAnalysis(this.currentBookId, sectionIndex, this.playlist);
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

        // Call stateManager to save legacy cache/db
        await this.stateManager.savePlaybackState(status);
    }
}

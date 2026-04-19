import type { ITTSProvider, TTSVoice } from './providers/types';
import { Capacitor } from '@capacitor/core';
import { BatteryOptimization } from '@capawesome-team/capacitor-android-battery-optimization';
import { SyncEngine } from './SyncEngine';
import { LexiconService } from './LexiconService';
import { dbService } from '../../db/DBService';
import type { SectionMetadata, LexiconRule } from '../../types/db';
import { TaskSequencer } from './TaskSequencer';
import { AudioContentPipeline } from './AudioContentPipeline';
import { PlaybackStateManager } from './PlaybackStateManager';
import { TTSProviderManager } from './TTSProviderManager';
import { PlatformIntegration } from './PlatformIntegration';
import { useReadingStateStore } from '../../store/useReadingStateStore';
import { useToastStore } from '../../store/useToastStore';
import { type SectionAnalysis, type TableAdaptation, useContentAnalysisStore } from '../../store/useContentAnalysisStore';
import { useGenAIStore } from '../../store/useGenAIStore';
import { useAnnotationStore } from '../../store/useAnnotationStore';
import { mergeCfiSlow } from '../cfi-utils';
import { createLogger } from '../logger';

const logger = createLogger('AudioPlayerService');

/**
 * Defines the possible states of the TTS playback.
 */
export type TTSStatus = 'playing' | 'paused' | 'stopped' | 'loading' | 'completed';

/**
 * Represents a single item in the TTS playback queue.
 */
export interface TTSQueueItem {
    /** The text content to be spoken. */
    text: string;
    /** The Canonical Fragment Identifier (CFI) for the location in the book. */
    cfi: string | null;
    /** Optional chapter title. */
    title?: string;
    /** Optional author name. */
    author?: string;
    /** Optional book title. */
    bookTitle?: string;
    /** Optional cover image URL. */
    coverUrl?: string;
    /** Indicates if this item is a pre-roll announcement. */
    isPreroll?: boolean;
    /** Indicates if this item should be skipped during playback. */
    isSkipped?: boolean;
    /** The indices of the raw source sentences that make up this item. */
    sourceIndices?: number[];
}

export interface DownloadInfo {
    voiceId: string;
    percent: number;
    status: string;
}

type PlaybackListener = (status: TTSStatus, activeCfi: string | null, currentIndex: number, queue: ReadonlyArray<TTSQueueItem>, error: string | null, downloadInfo?: DownloadInfo) => void;

/**
 * Singleton service that manages Text-to-Speech playback.
 * Handles queue management, provider switching (Local/Cloud), synchronization,
 * media session integration, and state persistence.
 */
export class AudioPlayerService {
    private static instance: AudioPlayerService;

    // Components
    // TaskSequencer ensures async operations are executed serially to prevent race conditions.
    private taskSequencer = new TaskSequencer();
    // AudioContentPipeline handles loading content, GenAI filtering, and text refinement.
    private contentPipeline = new AudioContentPipeline();
    // PlaybackStateManager manages the queue, current index, and position calculations.
    private stateManager = new PlaybackStateManager();

    private providerManager: TTSProviderManager;
    private platformIntegration: PlatformIntegration;
    private syncEngine: SyncEngine | null = null;
    private lexiconService: LexiconService;

    private status: TTSStatus = 'stopped';
    private listeners: PlaybackListener[] = [];
    private activeLexiconRules: LexiconRule[] | null = null;
    private speed: number = 1.0;
    private voiceId: string | null = null;
    private currentBookId: string | null = null;
    private playlist: SectionMetadata[] = [];
    private playlistPromise: Promise<void> | null = null;
    private sessionRestored: boolean = false;
    private prerollEnabled: boolean = false;
    private isPreviewing: boolean = false;
    private lastAppliedAnalysisTimestamp: number = 0;
    private lastUserPauseTimestamp: number | null = null;

    private constructor() {
        this.syncEngine = new SyncEngine();
        this.lexiconService = LexiconService.getInstance();

        // Subscribe to content analysis changes (Reactive Injection)
        useContentAnalysisStore.subscribe((state) => {
            this.handleContentAnalysisUpdate(state);
        });

        this.platformIntegration = new PlatformIntegration({
            onPlay: () => this.play(),
            onPause: () => this.pause(),
            onStop: () => this.stop(),
            onPrev: () => this.prev(),
            onNext: () => this.next(),
            onSeek: (offset) => this.seek(offset),
            onSeekTo: (time) => this.seekTo(time),
        });

        this.providerManager = new TTSProviderManager({
            onStart: () => {
                this.setStatus('playing');
            },
            onEnd: () => {
                if (this.isPreviewing) {
                    this.isPreviewing = false;
                    this.setStatus('stopped');
                    return;
                }
                this.playNext();
            },
            onError: (error) => {
                if (error?.type === 'fallback') {
                    logger.warn("Falling back to local provider due to cloud error");
                    this.playInternal(true);
                    return;
                }

                logger.error("TTS Provider Error", error);
                this.setStatus('stopped');
                this.notifyError("Playback Error: " + (error?.message || "Unknown error"));
            },
            onTimeUpdate: (currentTime) => {
                this.syncEngine?.updateTime(currentTime);
                this.updateSectionMediaPosition(currentTime);
            },
            onBoundary: () => {
                // Optionally update sync engine or progress
            },
            onMeta: (alignment) => {
                if (this.syncEngine) {
                    this.syncEngine.loadAlignment(alignment);
                }
            },
            onDownloadProgress: (voiceId, percent, status) => {
                this.notifyDownloadProgress(voiceId, percent, status);
            }
        });

        this.syncEngine.setOnHighlight(() => {
            // No action currently
        });

        // Subscribe to state manager changes
        this.stateManager.subscribe((snapshot) => {
            // Update Yjs Progress
            if (this.currentBookId && snapshot.currentSectionIndex !== -1) {
                useReadingStateStore.getState().updateTTSProgress(
                    this.currentBookId,
                    snapshot.currentIndex,
                    snapshot.currentSectionIndex
                );
            }
            this.updateMediaSessionMetadata();
            this.notifyListeners(snapshot.currentItem?.cfi || null);
        });
    }

    static getInstance(): AudioPlayerService {
        if (!AudioPlayerService.instance) {
            AudioPlayerService.instance = new AudioPlayerService();
        }
        return AudioPlayerService.instance;
    }

    private enqueue<T>(task: () => Promise<T>): Promise<T | void> {
        return this.taskSequencer.enqueue(task);
    }

    setBookId(bookId: string | null) {
        if (this.currentBookId !== bookId) {
            // Immediately stop playback and reset state to prevent leakage of old book state
            if (this.status !== 'stopped') {
                this.setStatus('stopped');
                this.providerManager.stop();
                this.platformIntegration.stop().catch(e => logger.error("Failed to stop platform integration", e));
            }
            this.stateManager.reset();

            this.currentBookId = bookId;
            this.sessionRestored = false;
            this.lastAppliedAnalysisTimestamp = 0;
            this.stateManager.setBookId(bookId);

            if (bookId) {
                this.playlistPromise = dbService.getSections(bookId).then(sections => {
                    if (this.currentBookId !== bookId) return; this.playlist = sections;
                    this.restoreQueue(bookId);
                }).catch(e => logger.error("Failed to load playlist", e));
            } else {
                this.playlist = [];
                this.playlistPromise = null;
            }

            this.activeLexiconRules = null;
            this.lastUserPauseTimestamp = null;
        }
    }

    private async engageBackgroundMode(item: TTSQueueItem): Promise<boolean> {
        try {
            this.platformIntegration.updateMetadata({
                title: item.title || 'Chapter Text',
                artist: item.author || 'Versicle',
                album: item.bookTitle || '',
                artwork: item.coverUrl ? [{ src: item.coverUrl }] : [],
                sectionIndex: this.stateManager.currentSectionIndex,
                totalSections: this.playlist.length
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
        this.enqueue(async () => {
            try {
                const state = await dbService.getTTSState(bookId);
                const progress = useReadingStateStore.getState().getProgress(bookId);

                if (this.currentBookId !== bookId) return;

                if (state && state.queue && state.queue.length > 0) {
                    await this.stopInternal();

                    const currentIndex = progress?.currentQueueIndex || 0;
                    const sectionIndex = progress?.currentSectionIndex ?? -1;

                    this.stateManager.setQueue(state.queue, currentIndex, sectionIndex);
                    // Subscription handles metadata and listeners

                    // Trigger background content analysis (GenAI) for the restored section
                    if (sectionIndex >= 0 && sectionIndex < this.playlist.length) {
                        const section = this.playlist[sectionIndex];

                        this.applyCachedAnalysis(bookId, section.sectionId);

                        this.contentPipeline.triggerAnalysis(
                            bookId,
                            section.sectionId,
                            undefined // will fetch from DB
                        );
                    }
                }
            } catch (e) {
                logger.error("Failed to restore TTS queue", e);
            }
        });
    }

    private updateMediaSessionMetadata() {
        const item = this.stateManager.getCurrentItem();
        if (item) {
            this.platformIntegration.updateMetadata({
                title: item.title || 'Chapter Text',
                artist: item.author || 'Versicle',
                album: item.bookTitle || '',
                artwork: item.coverUrl ? [{ src: item.coverUrl }] : [],
                sectionIndex: this.stateManager.currentSectionIndex,
                totalSections: this.playlist.length
            });

            this.updateSectionMediaPosition(0);
        }
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

    public setProvider(provider: ITTSProvider) {
        return this.enqueue(async () => {
            await this.stopInternal();
            this.providerManager.setProvider(provider);
        });
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
        const originalBookId = this.currentBookId;
        return this.enqueue(async () => {
            if (this.playlistPromise) await this.playlistPromise;
            if (this.currentBookId !== originalBookId) return;
            return this.loadSectionInternal(sectionIndex, autoPlay);
        });
    }

    public loadSectionBySectionId(sectionId: string, autoPlay: boolean = true, sectionTitle?: string) {
        const originalBookId = this.currentBookId;
        return this.enqueue(async () => {
            if (this.playlistPromise) await this.playlistPromise;
            if (this.currentBookId !== originalBookId) return;

            const index = this.playlist.findIndex(s => s.sectionId === sectionId);
            if (index !== -1) {
                // Optimization: If the section is already loaded (e.g. from restore) and we are not forcing playback,
                // keep the current state (including current index/progress).
                if (!autoPlay && this.stateManager.currentSectionIndex === index && this.stateManager.queue.length > 0) {
                    return;
                }
                await this.loadSectionInternal(index, autoPlay, sectionTitle);
            }
        });
    }

    public async skipToNextSection(): Promise<boolean> {
        return this.advanceToNextChapter();
    }

    public async skipToPreviousSection(): Promise<boolean> {
        if (!this.currentBookId || this.playlist.length === 0) return false;
        let prevSectionIndex = this.stateManager.currentSectionIndex - 1;
        while (prevSectionIndex >= 0) {
            const loaded = await this.loadSectionInternal(prevSectionIndex, true);
            if (loaded) return true;
            prevSectionIndex--;
        }
        return false;
    }

    setQueue(items: TTSQueueItem[], startIndex: number = 0) {
        return this.enqueue(async () => {
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
        return this.enqueue(async () => {
            if (this.stateManager.jumpTo(index)) {
                await this.stopInternal();
                await this.playInternal();
            }
        });
    }

    async preview(text: string): Promise<void> {
        return this.enqueue(async () => {
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
        const now = Date.now();
        logger.debug(`Play called. lastUserPauseTimestamp: ${this.lastUserPauseTimestamp}, diff: ${this.lastUserPauseTimestamp ? now - this.lastUserPauseTimestamp : 'N/A'}`);
        if (this.lastUserPauseTimestamp && (now - this.lastUserPauseTimestamp <= 5000)) {
            logger.debug('Triggering Dragnet Capture');
            await this.executeDragnetCapture();
        }
        this.lastUserPauseTimestamp = null;

        return this.enqueue(() => this.playInternal());
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
        useAnnotationStore.getState().add({
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
                const book = await dbService.getBookMetadata(initialBookId);
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
        if (!item) {
            this.setStatus('stopped');
            // notifyListeners handled by setStatus
            return;
        }

        if (this.status !== 'playing') {
            const engaged = await this.engageBackgroundMode(item);
            if (this.currentBookId !== initialBookId) return;

            if (!engaged && Capacitor.getPlatform() === 'android') {
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
                this.activeLexiconRules = await this.lexiconService.getRules(initialBookId || undefined);
                if (this.currentBookId !== initialBookId) return;
            }
            const rules = this.activeLexiconRules;

            const processedText = this.lexiconService.applyLexicon(item.text, rules);

            await this.providerManager.play(processedText, {
                voiceId,
                speed: this.speed
            });

            if (this.stateManager.hasNext()) {
                const nextItem = this.stateManager.queue[this.stateManager.currentIndex + 1];
                const nextProcessed = this.lexiconService.applyLexicon(nextItem.text, rules);
                this.providerManager.preload(nextProcessed, {
                    voiceId,
                    speed: this.speed
                });
            }

        } catch (e) {
            logger.error("Play error", e);
            this.setStatus('stopped');
            this.notifyError(e instanceof Error ? e.message : "Playback error");
        }
    }

    async resume(): Promise<void> {
        return this.enqueue(() => this.resumeInternal());
    }

    private async resumeInternal(): Promise<void> {
        this.sessionRestored = true;
        return this.playInternal(true);
    }

    pause() {
        this.lastUserPauseTimestamp = Date.now();
        return this.enqueue(async () => {
            this.providerManager.pause();
            this.setStatus('paused');
            await this.savePlaybackState('paused');
        });
    }

    stop() {
        return this.enqueue(async () => {
            await this.stopInternal();
        });
    }

    private async stopInternal() {
        await this.savePlaybackState('stopped');
        await this.platformIntegration.stop();
        this.setStatus('stopped');
        this.providerManager.stop();
    }

    next() {
        return this.enqueue(async () => {
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
        return this.enqueue(async () => {
            if (this.stateManager.hasPrev()) {
                this.stateManager.prev();
                if (this.status === 'paused') this.setStatus('stopped');
                await this.playInternal();
            }
        });
    }

    setSpeed(speed: number) {
        this.speed = speed;
        return this.enqueue(async () => {
            if (this.status === 'playing' || this.status === 'loading') {
                this.providerManager.stop();
                await this.playInternal();
            }
        });
    }

    seekTo(time: number) {
        return this.enqueue(async () => {
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
        return this.enqueue(async () => {
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
        this.voiceId = voiceId;
        return this.enqueue(async () => {
            if (this.status === 'playing' || this.status === 'loading') {
                this.providerManager.stop();
                await this.playInternal();
            }
        });
    }

    private playNext() {
        this.enqueue(async () => {
            if (this.status !== 'stopped') {
                if (this.currentBookId) {
                    const item = this.stateManager.getCurrentItem();
                    if (item && item.cfi && !item.isPreroll) {
                        try {
                            useReadingStateStore.getState().addCompletedRange(this.currentBookId, item.cfi, 'tts');
                        } catch (e) {
                            logger.error("Failed to update history", e);
                        }
                    }
                }

                if (this.stateManager.hasNext()) {
                    this.platformIntegration.setBackgroundAudioMode(this.platformIntegration.getBackgroundAudioMode(), true);

                    this.stateManager.next();
                    await this.playInternal();
                } else {
                    const loaded = await this.advanceToNextChapter();
                    if (!loaded) {
                        this.setStatus('completed');
                    }
                }
            }
        });
    }

    private setStatus(status: TTSStatus) {
        const oldStatus = this.status;
        if ((oldStatus === 'playing' || oldStatus === 'loading') && (status === 'paused' || status === 'stopped')) {
            if (this.currentBookId) {
                const item = this.stateManager.getCurrentItem();
                if (item && item.cfi && !item.isPreroll) {
                    try {
                        useReadingStateStore.getState().addCompletedRange(this.currentBookId, item.cfi, 'tts');
                    } catch (e) {
                        logger.error("Failed to update history", e);
                    }
                }
            }
        }

        this.status = status;

        if (status === 'stopped' || status === 'paused') {
            this.activeLexiconRules = null;
        }

        this.platformIntegration.updatePlaybackState(status);

        const currentCfi = (this.stateManager.getCurrentItem() && (status === 'playing' || status === 'loading' || status === 'paused'))
            ? this.stateManager.getCurrentItem()!.cfi
            : null;

        this.notifyListeners(currentCfi);
    }

    subscribe(listener: PlaybackListener) {
        let isSubscribed = true;
        this.listeners.push(listener);
        const currentCfi = this.stateManager.getCurrentItem()?.cfi || null;
        setTimeout(() => {
            if (isSubscribed) {
                listener(this.status, currentCfi, this.stateManager.currentIndex, this.stateManager.queue, null);
            }
        }, 0);
        return () => {
            isSubscribed = false;
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private notifyListeners(activeCfi: string | null) {
        this.listeners.forEach(l => l(this.status, activeCfi, this.stateManager.currentIndex, this.stateManager.queue, null));
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
            // Skip if we've already processed this exact analysis update
            if (analysis.generatedAt <= this.lastAppliedAnalysisTimestamp) return;

            // Update timestamp synchronously to prevent concurrent duplicate enqueueing
            this.lastAppliedAnalysisTimestamp = analysis.generatedAt;

            this.enqueue(async () => {
                // Validate current context
                if (this.currentBookId !== bookId) return;
                const activeSection = this.playlist[this.stateManager.currentSectionIndex];
                if (!activeSection || activeSection.sectionId !== section.sectionId) return;

                const genAISettings = useGenAIStore.getState();

                // 1. Apply Skip Mask if needed
                if (genAISettings.isEnabled && genAISettings.isContentAnalysisEnabled && genAISettings.contentFilterSkipTypes.length > 0) {
                    const mask = await this.contentPipeline.detectContentSkipMask(bookId, section.sectionId, genAISettings.contentFilterSkipTypes);
                    if (mask.size > 0 && this.currentBookId === bookId && this.stateManager.currentSectionIndex === sectionIndex) {
                        this.stateManager.applySkippedMask(mask, section.sectionId);
                    }
                }

                // 2. Apply Table Adaptations if needed
                if (genAISettings.isEnabled && genAISettings.isTableAdaptationEnabled && analysis.tableAdaptations) {
                    const ttsContent = await dbService.getTTSContent(bookId, section.sectionId);
                    if (ttsContent && this.currentBookId === bookId && this.stateManager.currentSectionIndex === sectionIndex) {
                        const adaptations = this.contentPipeline.tableProcessor.mapSentencesToAdaptations(
                            ttsContent.sentences,
                            new Map(analysis.tableAdaptations.map((a: TableAdaptation) => [a.rootCfi, a.text]))
                        );
                        this.stateManager.applyTableAdaptations(adaptations);
                    }
                }
            });
        }
    }

    private applyCachedAnalysis(bookId: string, sectionId: string) {
        const analysis = useContentAnalysisStore.getState().getAnalysis(bookId, sectionId);
        if (analysis && analysis.status === 'success') {
            this.handleContentAnalysisUpdate(useContentAnalysisStore.getState());
        }
    }

    private notifyError(message: string) {
        this.listeners.forEach(l => l(this.status, this.stateManager.getCurrentItem()?.cfi || null, this.stateManager.currentIndex, this.stateManager.queue, message));
    }

    private notifyDownloadProgress(voiceId: string, percent: number, status: string) {
        this.listeners.forEach(l => l(this.status, this.stateManager.getCurrentItem()?.cfi || null, this.stateManager.currentIndex, this.stateManager.queue, null, { voiceId, percent, status }));
    }

    public async checkBatteryOptimization() {
        if (Capacitor.getPlatform() === 'android') {
            const isEnabled = await BatteryOptimization.isBatteryOptimizationEnabled();
            if (isEnabled.enabled) {
                // Prompt user to disable battery optimization for reliable background playback
                useToastStore.getState().showToast(
                    'For reliable background playback, please disable battery optimization for this app.',
                    'info'
                );
                await BatteryOptimization.openBatteryOptimizationSettings();
            }
        }
    }

    private async loadSectionInternal(sectionIndex: number, autoPlay: boolean, sectionTitle?: string): Promise<boolean> {
        if (!this.currentBookId || sectionIndex < 0 || sectionIndex >= this.playlist.length) return false;

        // Clear dragnet state on navigation to prevent capturing previous section context
        this.lastUserPauseTimestamp = null;

        const section = this.playlist[sectionIndex];

        const newQueue = await this.contentPipeline.loadSection(
            this.currentBookId,
            section,
            sectionIndex,
            this.prerollEnabled,
            this.speed,
            sectionTitle || section.title
        );

        if (newQueue && newQueue.length > 0) {
            if (autoPlay) {
                this.providerManager.stop();
                await this.savePlaybackState('stopped');
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
            useReadingStateStore.getState().updatePlaybackPosition(this.currentBookId, lastPlayedCfi);
        }

        // Call stateManager to save legacy cache/db
        await this.stateManager.savePlaybackState(status);
    }
}

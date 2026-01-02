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
}

export interface DownloadInfo {
    voiceId: string;
    percent: number;
    status: string;
}

type PlaybackListener = (status: TTSStatus, activeCfi: string | null, currentIndex: number, queue: TTSQueueItem[], error: string | null, downloadInfo?: DownloadInfo) => void;

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

    // State
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

    private constructor() {
        this.syncEngine = new SyncEngine();
        this.lexiconService = LexiconService.getInstance();

        this.platformIntegration = new PlatformIntegration({
            onPlay: () => this.resume(),
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
                      console.warn("Falling back to local provider due to cloud error");
                      // Retrying playInternal will use the new provider (which was switched internally by manager if logic allows,
                      // but manager actually switched instance. We just need to re-trigger play.)
                      this.playInternal(true);
                      return;
                 }

                 console.error("TTS Provider Error", error);
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
            this.currentBookId = bookId;
            this.sessionRestored = false;
            this.stateManager.setBookId(bookId);

            if (bookId) {
                this.playlistPromise = dbService.getSections(bookId).then(sections => {
                    this.playlist = sections;
                    this.restoreQueue(bookId);
                }).catch(e => console.error("Failed to load playlist", e));
            } else {
                this.stateManager.reset();
                this.playlist = [];
                this.playlistPromise = null;
                this.setStatus('stopped');
            }

            // Clear cached rules when book changes
            this.activeLexiconRules = null;
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
            console.error('Background engagement failed', e);
            return false;
        }
    }

    private updateSectionMediaPosition(providerTime: number) {
        const position = this.stateManager.getCurrentPosition(providerTime, this.speed);
        const duration = this.stateManager.getTotalDuration(this.speed);

        // Safety check
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
                if (this.currentBookId !== bookId) return;

                if (state && state.queue && state.queue.length > 0) {
                    await this.stopInternal();
                    this.stateManager.setQueue(state.queue, state.currentIndex || 0, state.sectionIndex ?? -1);
                    this.updateMediaSessionMetadata();
                    this.notifyListeners(this.stateManager.getCurrentItem()?.cfi || null);
                }
            } catch (e) {
                console.error("Failed to restore TTS queue", e);
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

            // Always update position when track changes, even if metadata is identical
            this.updateSectionMediaPosition(0);
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public setBackgroundAudioMode(mode: any) {
         // Pass through to platform integration
         // Casting because mode type is imported from BackgroundAudio file which is not exported from PlatformIntegration explicitly
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

    public getQueue(): TTSQueueItem[] {
        return this.stateManager.queue;
    }

    public loadSection(sectionIndex: number, autoPlay: boolean = true) {
        return this.enqueue(() => this.loadSectionInternal(sectionIndex, autoPlay));
    }

    public loadSectionBySectionId(sectionId: string, autoPlay: boolean = true, sectionTitle?: string) {
        return this.enqueue(async () => {
            if (this.playlistPromise) await this.playlistPromise;
            const index = this.playlist.findIndex(s => s.sectionId === sectionId);
            if (index !== -1) {
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
            // Load and play from start
            const loaded = await this.loadSectionInternal(prevSectionIndex, true);
            if (loaded) return true;
            prevSectionIndex--;
        }
        return false;
    }

    private isQueueEqual(newItems: TTSQueueItem[]): boolean {
        const currentQueue = this.stateManager.queue;
        if (currentQueue.length !== newItems.length) return false;
        for (let i = 0; i < currentQueue.length; i++) {
            if (currentQueue[i].text !== newItems[i].text) return false;
            if (currentQueue[i].cfi !== newItems[i].cfi) return false;
        }
        return true;
    }

    setQueue(items: TTSQueueItem[], startIndex: number = 0) {
        return this.enqueue(async () => {
            if (this.isQueueEqual(items)) {
                // Optimization: If the new queue is identical to the current one,
                // we skip the heavy stop/reset logic. We update the state manager with the new start index
                // and persist the state, but maintain continuity if possible.

                this.stateManager.setQueue(items, startIndex, this.stateManager.currentSectionIndex);
                this.updateMediaSessionMetadata();
                this.notifyListeners(this.stateManager.getCurrentItem()?.cfi || null);
                this.stateManager.persistQueue();
                return;
            }

            // If the queue has changed, we must stop playback and fully reset the state.
            await this.stopInternal();

            // Note: setQueue is often called for the current section. We assume `currentSectionIndex` remains valid.
            this.stateManager.setQueue(items, startIndex, this.stateManager.currentSectionIndex);

            this.updateMediaSessionMetadata();
            this.notifyListeners(this.stateManager.getCurrentItem()?.cfi || null);
            this.stateManager.persistQueue();
        });
    }

    jumpTo(index: number) {
        return this.enqueue(async () => {
            if (this.stateManager.jumpTo(index)) {
                await this.stopInternal();
                this.stateManager.persistQueue();
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
                console.error("Preview error", e);
                this.setStatus('stopped');
                this.isPreviewing = false;
                this.notifyError(e instanceof Error ? e.message : "Preview error");
            }
        });
    }

    async play(): Promise<void> {
        return this.enqueue(() => this.playInternal());
    }

    /**
     * Internal playback logic.
     * @param force If true, forces a full restart/re-synthesis of the current item, even if paused.
     */
    private async playInternal(force: boolean = false): Promise<void> {
        if (this.status === 'paused' && !force) {
            return this.resumeInternal();
        }

        if (this.status === 'stopped' && this.currentBookId && !this.sessionRestored) {
            this.sessionRestored = true;
            try {
                const book = await dbService.getBookMetadata(this.currentBookId);
                if (book) {
                    if (book.lastPlayedCfi && this.stateManager.currentIndex === 0) {
                        const index = this.stateManager.queue.findIndex(item => item.cfi === book.lastPlayedCfi);
                        if (index >= 0) this.stateManager.currentIndex = index;
                    }
                    if (book.lastPauseTime) return this.resumeInternal();
                }
            } catch (e) {
                console.warn("Failed to restore playback state", e);
            }
        }

        const item = this.stateManager.getCurrentItem();
        if (!item) {
            this.setStatus('stopped');
            this.notifyListeners(null);
            return;
        }

        if (this.status !== 'playing') {
            const engaged = await this.engageBackgroundMode(item);
            if (!engaged && Capacitor.getPlatform() === 'android') {
                this.setStatus('stopped');
                this.notifyError("Cannot play in background");
                return;
            }
            this.setStatus('loading');
        }

        this.notifyListeners(item.cfi);
        this.updateMediaSessionMetadata();
        this.stateManager.persistQueue();

        try {
            const voiceId = this.voiceId || '';

            // Load and cache rules if not already cached for this session
            if (!this.activeLexiconRules) {
                this.activeLexiconRules = await this.lexiconService.getRules(this.currentBookId || undefined);
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
            console.error("Play error", e);
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
        return this.enqueue(async () => {
            this.providerManager.pause();
            this.setStatus('paused');
            await this.stateManager.savePlaybackState('paused');
        });
    }

    stop() {
        return this.enqueue(async () => {
            await this.stopInternal();
        });
    }

    private async stopInternal() {
        await this.stateManager.savePlaybackState('stopped');
        await this.platformIntegration.stop();
        this.setStatus('stopped');
        this.notifyListeners(null);
        this.providerManager.stop();
    }

    next() {
        return this.enqueue(async () => {
            if (this.stateManager.hasNext()) {
                this.stateManager.next();
                this.stateManager.persistQueue();
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
                this.stateManager.persistQueue();
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
            const newIndex = this.stateManager.calculateIndexFromTime(time, this.speed);
            const wasPlaying = (this.status === 'playing' || this.status === 'loading');

            // Fix: If the approximated index is the same as current...
            if (newIndex === this.stateManager.currentIndex) {
                if (this.stateManager.hasNext()) {
                    this.stateManager.next();
                } else {
                    await this.advanceToNextChapter();
                    return;
                }
            } else {
                this.stateManager.currentIndex = newIndex;
            }

            if (wasPlaying) {
                this.providerManager.stop();
            }

            this.stateManager.persistQueue();

            if (wasPlaying) {
                await this.playInternal();
            } else {
                this.updateMediaSessionMetadata();
                this.notifyListeners(this.stateManager.getCurrentItem()?.cfi || null);
                this.updateSectionMediaPosition(0);
            }
        });
    }

    seek(offset: number) {
        return this.enqueue(async () => {
            if (offset > 0) {
                if (this.stateManager.hasNext()) {
                    this.stateManager.next();
                    this.stateManager.persistQueue();
                    await this.playInternal();
                } else {
                    await this.advanceToNextChapter();
                }
            } else {
                if (this.stateManager.hasPrev()) {
                    this.stateManager.prev();
                    this.stateManager.persistQueue();
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
                // Update Reading History
                if (this.currentBookId) {
                    const item = this.stateManager.getCurrentItem();
                    if (item && item.cfi && !item.isPreroll) {
                        dbService.updateReadingHistory(this.currentBookId, item.cfi, 'tts', item.text, true).catch(console.error);
                    }
                }

                if (this.stateManager.hasNext()) {
                    // Start Background Audio if needed (might be redundant but ensures continuity)
                    // Actually PlatformIntegration manages this on status change, but here status doesn't change from 'playing'.
                    this.platformIntegration.setBackgroundAudioMode(this.platformIntegration.getBackgroundAudioMode(), true);

                    this.stateManager.next();
                    this.stateManager.persistQueue();
                    await this.playInternal();
                } else {
                    const loaded = await this.advanceToNextChapter();
                    if (!loaded) {
                        this.setStatus('completed');
                        this.notifyListeners(null);
                    }
                }
            }
        });
    }

    private setStatus(status: TTSStatus) {
        // Record TTS Session on Pause/Stop
        const oldStatus = this.status;
        if ((oldStatus === 'playing' || oldStatus === 'loading') && (status === 'paused' || status === 'stopped')) {
            if (this.currentBookId) {
                const item = this.stateManager.getCurrentItem();
                if (item && item.cfi && !item.isPreroll) {
                    dbService.updateReadingHistory(this.currentBookId, item.cfi, 'tts', item.text, false).catch(console.error);
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
        this.listeners.push(listener);
        const currentCfi = this.stateManager.getCurrentItem()?.cfi || null;
        setTimeout(() => {
            listener(this.status, currentCfi, this.stateManager.currentIndex, this.stateManager.queue, null);
        }, 0);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private notifyListeners(activeCfi: string | null) {
        this.listeners.forEach(l => l(this.status, activeCfi, this.stateManager.currentIndex, this.stateManager.queue, null));
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
                // TODO: Prompt user to disable optimization
            }
        }
    }

    private async loadSectionInternal(sectionIndex: number, autoPlay: boolean, sectionTitle?: string): Promise<boolean> {
        if (!this.currentBookId || sectionIndex < 0 || sectionIndex >= this.playlist.length) return false;

        const section = this.playlist[sectionIndex];
        const newQueue = await this.contentPipeline.loadSection(
            this.currentBookId,
            section,
            sectionIndex,
            this.prerollEnabled,
            this.speed,
            sectionTitle
        );

        if (newQueue && newQueue.length > 0) {
            if (autoPlay) {
                this.providerManager.stop();
                await this.stateManager.savePlaybackState('stopped'); // or just save state
                this.setStatus('loading');
            } else {
                await this.stopInternal();
            }

            this.stateManager.setQueue(newQueue, 0, sectionIndex);

            this.updateMediaSessionMetadata();
            this.notifyListeners(this.stateManager.getCurrentItem()?.cfi || null);
            this.stateManager.persistQueue();

            if (autoPlay) {
                await this.playInternal();
            }
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
            // Note: loadSectionInternal handles setting queue and calling listeners
            // But we need to jump to end.
            const loaded = await this.loadSectionInternal(prevSectionIndex, false);
            if (loaded) {
                // Jump to end
                this.stateManager.currentIndex = Math.max(0, this.stateManager.queue.length - 1);
                this.stateManager.persistQueue();
                this.updateMediaSessionMetadata();
                this.notifyListeners(this.stateManager.getCurrentItem()?.cfi || null);

                await this.playInternal();
                return true;
            }
            prevSectionIndex--;
        }
        return false;
    }
}

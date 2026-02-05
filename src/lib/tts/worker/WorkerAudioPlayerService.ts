import type { ITTSProvider, TTSVoice } from '../providers/types';
import { SyncEngine } from '../SyncEngine';
import { LexiconService } from '../LexiconService';
import { dbService } from '../../../db/DBService';
import type { SectionMetadata, LexiconRule } from '../../../types/db';
import { TaskSequencer } from '../TaskSequencer';
import { AudioContentPipeline } from '../AudioContentPipeline';
import { PlaybackStateManager } from '../PlaybackStateManager';
import { WorkerTTSProviderManager } from './WorkerTTSProviderManager';
import { createLogger } from '../../logger';
import { WorkerAudioPlayer } from './WorkerAudioPlayer';
import { PiperProvider } from '../providers/PiperProvider';
import { GoogleTTSProvider } from '../providers/GoogleTTSProvider';
import { OpenAIProvider } from '../providers/OpenAIProvider';
import { LemonFoxProvider } from '../providers/LemonFoxProvider';
import { RemoteCapacitorProvider } from './RemoteCapacitorProvider';
import { RemoteWebSpeechProvider } from './RemoteWebSpeechProvider';
import { useCostStore } from '../CostEstimator';
import type { TTSQueueItem, TTSStatus } from '../types';
import type { IWorkerAudioService, IMainThreadAudioCallback } from './interfaces';

const logger = createLogger('WorkerAudioPlayerService');

export class WorkerAudioPlayerService implements IWorkerAudioService {
    private taskSequencer = new TaskSequencer();
    private contentPipeline = new AudioContentPipeline();
    private stateManager = new PlaybackStateManager();
    private providerManager: WorkerTTSProviderManager;
    private syncEngine: SyncEngine;
    private lexiconService: LexiconService;

    private status: TTSStatus = 'stopped';
    private activeLexiconRules: LexiconRule[] | null = null;
    private speed: number = 1.0;
    private voiceId: string | null = null;
    private currentBookId: string | null = null;
    private playlist: SectionMetadata[] = [];
    private playlistPromise: Promise<void> | null = null;
    private sessionRestored: boolean = false;
    private prerollEnabled: boolean = false;
    private isPreviewing: boolean = false;
    private isNative: boolean = false;

    private callback: IMainThreadAudioCallback | null = null;
    private activeAudioPlayer: WorkerAudioPlayer | null = null;
    private currentRemoteProvider: RemoteCapacitorProvider | RemoteWebSpeechProvider | null = null;

    constructor() {
        this.syncEngine = new SyncEngine();
        this.lexiconService = LexiconService.getInstance();
        this.providerManager = this.createProviderManager();
    }

    private createProviderManager(): WorkerTTSProviderManager {
        return new WorkerTTSProviderManager({
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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                if ((error as any)?.type === 'fallback') {
                    logger.warn("Falling back to local provider due to cloud error");
                    this.playInternal(true);
                    return;
                }

                logger.error("TTS Provider Error", error);
                this.setStatus('stopped');
                if (this.callback) this.callback.onError("Playback Error: " + (error?.message || "Unknown error"));
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
                if (this.callback) this.callback.onDownloadProgress(voiceId, percent, status);
            }
        }, this.isNative);
    }

    async init(callback: IMainThreadAudioCallback, isNative: boolean) {
        this.callback = callback;
        this.isNative = isNative;
        this.providerManager = this.createProviderManager();
        await this.providerManager.init();

        this.syncEngine.setOnHighlight(() => {
            // No action currently
        });

        useCostStore.subscribe((state, prevState) => {
            const diff = state.sessionCharacters - prevState.sessionCharacters;
            if (diff > 0 && this.callback) {
                this.callback.updateCost(diff);
            }
        });

        this.stateManager.subscribe((snapshot) => {
            if (this.currentBookId && snapshot.currentSectionIndex !== -1 && this.callback) {
                 // Note: Logic for UPDATE_TTS_PROGRESS was removed as discussed
            }
            this.updateMediaSessionMetadata();
            this.notifyStatusUpdate(snapshot.currentItem?.cfi || null);
        });
    }

    private enqueue<T>(task: () => Promise<T>): Promise<T | void> {
        return this.taskSequencer.enqueue(task);
    }

    setBookId(bookId: string | null) {
        if (this.currentBookId !== bookId) {
            if (this.status !== 'stopped') {
                this.setStatus('stopped');
                this.providerManager.stop();
                if (this.callback) this.callback.stopPlayback();
            }
            this.stateManager.reset();

            this.currentBookId = bookId;
            this.sessionRestored = false;
            this.stateManager.setBookId(bookId);

            if (bookId) {
                this.playlistPromise = dbService.getSections(bookId).then(sections => {
                    this.playlist = sections;
                    this.restoreQueue(bookId);
                }).catch(e => logger.error("Failed to load playlist", e));
            } else {
                this.playlist = [];
                this.playlistPromise = null;
            }

            this.activeLexiconRules = null;
        }
    }

    private updateSectionMediaPosition(providerTime: number) {
        const position = this.stateManager.getCurrentPosition(providerTime);
        const duration = this.stateManager.getTotalDuration();
        const safeDuration = Math.max(duration, position);

        if (this.callback) {
            this.callback.updateMetadata({
                positionState: {
                    duration: safeDuration,
                    playbackRate: this.speed,
                    position: position
                }
            });
        }
    }

    private async restoreQueue(bookId: string) {
        this.enqueue(async () => {
            try {
                const state = await dbService.getTTSState(bookId);
                if (this.currentBookId !== bookId) return;

                if (state && state.queue && state.queue.length > 0) {
                    await this.stopInternal();
                    this.stateManager.setQueue(state.queue, 0, -1);
                }
            } catch (e) {
                logger.error("Failed to restore TTS queue", e);
            }
        });
    }

    private updateMediaSessionMetadata() {
        const item = this.stateManager.getCurrentItem();
        if (item && this.callback) {
            this.callback.updateMetadata({
                metadata: {
                    title: item.title || 'Chapter Text',
                    artist: item.author || 'Versicle',
                    album: item.bookTitle || '',
                    artwork: item.coverUrl ? [{ src: item.coverUrl }] : [],
                    sectionIndex: this.stateManager.currentSectionIndex,
                    totalSections: this.playlist.length
                }
            });
            this.updateSectionMediaPosition(0);
        }
    }

    public setBackgroundAudioMode(_mode: any) {
        // No-op in worker
    }

    public setBackgroundVolume(_volume: number) {
        // No-op in worker
    }

    public setPrerollEnabled(enabled: boolean) {
        this.prerollEnabled = enabled;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public setProvider(providerId: string, config?: any) {
        return this.enqueue(async () => {
            if (!this.callback) return;

            await this.stopInternal();
            let provider: ITTSProvider;

            const audioPlayer = new WorkerAudioPlayer(this.callback);
            this.activeAudioPlayer = audioPlayer;
            this.currentRemoteProvider = null;

            switch (providerId) {
                case 'piper':
                    provider = new PiperProvider(audioPlayer);
                    break;
                case 'openai':
                    provider = new OpenAIProvider(audioPlayer, config);
                    break;
                case 'google':
                    provider = new GoogleTTSProvider(audioPlayer, config);
                    break;
                case 'lemonfox':
                    provider = new LemonFoxProvider(audioPlayer, config);
                    break;
                case 'local':
                default:
                    if (this.isNative) {
                        const p = new RemoteCapacitorProvider(this.callback);
                        this.currentRemoteProvider = p;
                        provider = p;
                    } else {
                        const p = new RemoteWebSpeechProvider(this.callback);
                        this.currentRemoteProvider = p;
                        provider = p;
                    }
                    break;
            }
            this.providerManager.setProvider(provider);
            await this.providerManager.init();
        });
    }

    async getVoices(reqId: string): Promise<TTSVoice[]> {
        return await this.providerManager.getVoices();
    }

    async downloadVoice(voiceId: string) {
        await this.providerManager.downloadVoice(voiceId);
    }

    async deleteVoice(voiceId: string) {
        await this.providerManager.deleteVoice(voiceId);
    }

    async isVoiceDownloaded(voiceId: string, reqId: string): Promise<boolean> {
        return await this.providerManager.isVoiceDownloaded(voiceId);
    }

    public getQueue(): ReadonlyArray<TTSQueueItem> {
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
                if (!autoPlay && this.stateManager.currentSectionIndex === index && this.stateManager.queue.length > 0) {
                    return;
                }
                await this.loadSectionInternal(index, autoPlay, sectionTitle);
            }
        });
    }

    public async skipToNextSection(): Promise<void> {
        await this.advanceToNextChapter();
    }

    public async skipToPreviousSection(): Promise<void> {
        if (!this.currentBookId || this.playlist.length === 0) return;
        let prevSectionIndex = this.stateManager.currentSectionIndex - 1;
        while (prevSectionIndex >= 0) {
            const loaded = await this.loadSectionInternal(prevSectionIndex, true);
            if (loaded) return;
            prevSectionIndex--;
        }
    }

    setQueue(items: TTSQueueItem[], startIndex: number = 0) {
        return this.enqueue(async () => {
            if (this.stateManager.isIdenticalTo(items)) {
                this.stateManager.setQueue(items, startIndex, this.stateManager.currentSectionIndex);
                return;
            }

            await this.stopInternal();
            this.stateManager.setQueue(items, startIndex, this.stateManager.currentSectionIndex);
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
                if (this.callback) this.callback.onError(e instanceof Error ? e.message : "Preview error");
            }
        });
    }

    async play(): Promise<void> {
        return this.enqueue(() => this.playInternal());
    }

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
                         if (index >= 0) this.stateManager.jumpTo(index);
                    }
                }
            } catch (e) {
                logger.warn("Failed to restore playback state", e);
            }
        }

        const item = this.stateManager.getCurrentItem();
        if (!item) {
            this.setStatus('stopped');
            return;
        }

        if (this.status !== 'playing') {
            this.setStatus('loading');
        }

        this.stateManager.persistQueue();

        try {
            const voiceId = this.voiceId || '';

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
            logger.error("Play error", e);
            this.setStatus('stopped');
            if (this.callback) this.callback.onError(e instanceof Error ? e.message : "Playback error");
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
            await this.persistPlaybackState('paused');
        });
    }

    stop() {
        return this.enqueue(async () => {
            await this.stopInternal();
        });
    }

    private async stopInternal() {
        await this.persistPlaybackState('stopped');
        if (this.callback) this.callback.stopPlayback();
        this.setStatus('stopped');
        this.providerManager.stop();
    }

    private async persistPlaybackState(status: TTSStatus) {
        if (!this.currentBookId) return;
        const currentItem = this.stateManager.getCurrentItem();
        const lastPlayedCfi = (currentItem && currentItem.cfi) ? currentItem.cfi : undefined;

        if (lastPlayedCfi && this.callback) {
             this.callback.updatePlaybackPosition(this.currentBookId, lastPlayedCfi);
        }
        await this.stateManager.savePlaybackState(status);
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
            const loaded = await this.loadSectionInternal(prevSectionIndex, false);
            if (loaded) {
                this.stateManager.jumpToEnd();
                await this.playInternal();
                return true;
            }
            prevSectionIndex--;
        }
        return false;
    }

    private playNext() {
        this.enqueue(async () => {
            if (this.status !== 'stopped') {
                if (this.currentBookId) {
                    const item = this.stateManager.getCurrentItem();
                    if (item && item.cfi && !item.isPreroll && this.callback) {
                        this.callback.addCompletedRange(this.currentBookId, item.cfi);
                        this.callback.updateHistory(this.currentBookId, item.cfi, item.text, true);
                    }
                }

                if (this.stateManager.hasNext()) {
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
                if (item && item.cfi && !item.isPreroll && this.callback) {
                    this.callback.addCompletedRange(this.currentBookId, item.cfi);
                    this.callback.updateHistory(this.currentBookId, item.cfi, item.text, false);
                }
            }
        }

        this.status = status;

        if (status === 'stopped' || status === 'paused') {
            this.activeLexiconRules = null;
        }

        this.notifyStatusUpdate(this.stateManager.getCurrentItem()?.cfi || null);
    }

    private notifyStatusUpdate(activeCfi: string | null) {
        if (this.callback) {
            this.callback.onStatusUpdate(
                this.status,
                activeCfi,
                this.stateManager.currentIndex,
                this.stateManager.queue
            );
        }
    }

    private async loadSectionInternal(sectionIndex: number, autoPlay: boolean, sectionTitle?: string): Promise<boolean> {
        if (!this.currentBookId || sectionIndex < 0 || sectionIndex >= this.playlist.length) return false;

        const section = this.playlist[sectionIndex];
        const currentBookId = this.currentBookId;
        const currentSectionId = section.sectionId;

        const onMaskFound = (mask: Set<number>) => {
            this.enqueue(async () => {
                if (this.currentBookId !== currentBookId) return;
                const activeSection = this.playlist[this.stateManager.currentSectionIndex];
                if (activeSection && activeSection.sectionId === currentSectionId) {
                    this.stateManager.applySkippedMask(mask, currentSectionId);
                }
            });
        };

        const onAdaptationsFound = (adaptations: { indices: number[], text: string }[]) => {
            this.enqueue(async () => {
                if (this.currentBookId !== currentBookId) return;
                const activeSection = this.playlist[this.stateManager.currentSectionIndex];
                if (activeSection && activeSection.sectionId === currentSectionId) {
                    this.stateManager.applyTableAdaptations(adaptations);
                }
            });
        };

        const newQueue = await this.contentPipeline.loadSection(
            this.currentBookId,
            section,
            sectionIndex,
            this.prerollEnabled,
            this.speed,
            sectionTitle || section.title,
            onMaskFound,
            onAdaptationsFound
        );

        if (newQueue && newQueue.length > 0) {
            if (autoPlay) {
                this.providerManager.stop();
                await this.persistPlaybackState('stopped');
                this.setStatus('loading');
            } else {
                await this.stopInternal();
            }

            this.stateManager.setQueue(newQueue, 0, sectionIndex);

            if (autoPlay) {
                await this.playInternal();
            }

            this.contentPipeline.triggerNextChapterAnalysis(this.currentBookId, sectionIndex, this.playlist);
            return true;
        }

        return false;
    }

    onRemotePlayStart(provider: 'local' | 'native'): void {
        this.forwardRemoteEvent(provider, { type: 'start' });
    }
    onRemotePlayEnded(provider: 'local' | 'native'): void {
        this.forwardRemoteEvent(provider, { type: 'end' });
    }
    onRemotePlayError(provider: 'local' | 'native', error: string): void {
        this.forwardRemoteEvent(provider, { type: 'error', error });
    }
    onRemoteTimeUpdate(provider: 'local' | 'native', time: number, duration: number): void {
        this.forwardRemoteEvent(provider, { type: 'timeupdate', time, duration });
    }
    onRemoteBoundary(provider: 'local' | 'native', charIndex: number): void {
        this.forwardRemoteEvent(provider, { type: 'boundary', charIndex });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private forwardRemoteEvent(_providerType: 'local' | 'native', event: any) {
        if (this.currentRemoteProvider) {
            this.currentRemoteProvider.handleRemoteEvent(event);
        }
    }

    onAudioEnded(): void {
        this.activeAudioPlayer?.handleAudioEnded();
    }
    onAudioError(error: string): void {
        this.activeAudioPlayer?.handleAudioError(error);
    }
    onAudioTimeUpdate(time: number, duration: number): void {
        this.activeAudioPlayer?.handleAudioTimeUpdate(time, duration);
    }
}

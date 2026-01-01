import type { ITTSProvider, TTSVoice } from './providers/types';
import type { BackgroundAudioMode } from './BackgroundAudio';
import { SyncEngine } from './SyncEngine';
import { LexiconService } from './LexiconService';
import { dbService } from '../../db/DBService';
import type { SectionMetadata, LexiconRule } from '../../types/db';
import { TaskSequencer } from './TaskSequencer';
import { AudioContentPipeline } from './AudioContentPipeline';
import { PlaybackStateManager } from './PlaybackStateManager';
import { TTSProviderManager } from './TTSProviderManager';
import { PlatformIntegration } from './PlatformIntegration';
import { Capacitor } from '@capacitor/core';

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

  // Sub-modules
  private taskSequencer: TaskSequencer;
  private contentPipeline: AudioContentPipeline;
  private stateManager: PlaybackStateManager;
  private providerManager: TTSProviderManager;
  private platformIntegration: PlatformIntegration;

  // Services
  private syncEngine: SyncEngine | null = null;
  private lexiconService: LexiconService;

  // State
  private status: TTSStatus = 'stopped';
  private listeners: PlaybackListener[] = [];
  private activeLexiconRules: LexiconRule[] | null = null;
  private speed: number = 1.0;
  private voiceId: string | null = null;

  // Context
  private currentBookId: string | null = null;
  private playlist: SectionMetadata[] = [];
  private playlistPromise: Promise<void> | null = null;
  private sessionRestored: boolean = false;
  private prerollEnabled: boolean = false;
  private isPreviewing: boolean = false;
  private currentCoverUrl: string | null = null;

  // Dependency Injection for Testing
  constructor(
      taskSequencer?: TaskSequencer,
      contentPipeline?: AudioContentPipeline,
      stateManager?: PlaybackStateManager,
      providerManager?: TTSProviderManager,
      platformIntegration?: PlatformIntegration
  ) {
      this.taskSequencer = taskSequencer || new TaskSequencer();
      this.contentPipeline = contentPipeline || new AudioContentPipeline();
      this.stateManager = stateManager || new PlaybackStateManager();

      this.syncEngine = new SyncEngine();
      this.lexiconService = LexiconService.getInstance();

      // Initialize Managers with Callbacks
      this.platformIntegration = platformIntegration || new PlatformIntegration({
          onPlay: () => this.resume(),
          onPause: () => this.pause(),
          onStop: () => this.stop(),
          onPrev: () => this.prev(),
          onNext: () => this.next(),
          onSeekBackward: () => this.seek(-10),
          onSeekForward: () => this.seek(10),
          onSeekTo: (time) => this.seekTo(time),
      });

      this.providerManager = providerManager || new TTSProviderManager({
          onStart: () => this.setStatus('playing'),
          onEnd: () => {
              if (this.isPreviewing) {
                  this.isPreviewing = false;
                  this.setStatus('stopped');
                  return;
              }
              this.playNext();
          },
          onError: (err) => {
               this.setStatus('stopped');
               this.notifyError("Playback Error: " + err.message);
          },
          onTimeUpdate: (time) => {
               this.syncEngine?.updateTime(time);
               this.updateSectionMediaPosition(time);
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

      this.providerManager.init();

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

  // --- Public API Delegates ---

  async init() {
    await this.providerManager.init();
  }

  getVoices(): Promise<TTSVoice[]> {
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

  getQueue(): TTSQueueItem[] {
      return this.stateManager.getQueue();
  }

  setBackgroundAudioMode(mode: BackgroundAudioMode) {
      this.platformIntegration.setBackgroundAudioMode(mode);
      this.platformIntegration.handleBackgroundAudio(this.status);
  }

  setBackgroundVolume(volume: number) {
      this.platformIntegration.setBackgroundVolume(volume);
  }

  setPrerollEnabled(enabled: boolean) {
      this.prerollEnabled = enabled;
  }

  setProvider(provider: ITTSProvider) {
      return this.taskSequencer.enqueue(async () => {
        await this.stopInternal();
        this.providerManager.setProvider(provider);
      });
  }

  async checkBatteryOptimization() {
      await this.platformIntegration.checkBatteryOptimization();
  }

  setBookId(bookId: string | null) {
      if (this.currentBookId !== bookId) {
          if (this.currentCoverUrl) {
              URL.revokeObjectURL(this.currentCoverUrl);
              this.currentCoverUrl = null;
          }
          this.currentBookId = bookId;
          this.sessionRestored = false;

          if (bookId) {
              this.playlistPromise = dbService.getSections(bookId).then(sections => {
                  this.playlist = sections;
                  this.restoreQueue(bookId);
              }).catch(e => console.error("Failed to load playlist", e));
          } else {
              this.stateManager.setQueue([], 0, -1);
              this.playlist = [];
              this.playlistPromise = null;
              this.setStatus('stopped');
          }

          this.activeLexiconRules = null;
      }
  }

  setQueue(items: TTSQueueItem[], startIndex: number = 0) {
    return this.taskSequencer.enqueue(async () => {
        // Basic equality check to avoid redundant updates
        const currentQueue = this.stateManager.getQueue();
        const isQueueEqual = currentQueue.length === items.length &&
                             currentQueue.every((item, i) => item.text === items[i].text && item.cfi === items[i].cfi);

        if (isQueueEqual) {
            // Update items but keep position if equal (preserving objects)
            // Actually if it's equal we might not need to do anything but `stateManager.setQueue` might handle persistence
            // Let's assume we just update it.
            this.stateManager.setQueue(items, this.stateManager.getCurrentIndex(), this.stateManager.getCurrentSectionIndex());
            this.updateMediaSessionMetadata();
            this.notifyListeners(this.stateManager.getCurrentItem()?.cfi || null);
            if (this.currentBookId) this.stateManager.persistQueue(this.currentBookId);
            return;
        }

        await this.stopInternal();
        // Since we are setting a manual queue, we assume it belongs to the current section or it's a transient queue.
        // If it's a manual setQueue call, we might not know the section index.
        // We'll keep the current section index if valid, or -1.
        this.stateManager.setQueue(items, startIndex, this.stateManager.getCurrentSectionIndex());

        this.updateMediaSessionMetadata();
        this.notifyListeners(this.stateManager.getCurrentItem()?.cfi || null);
        if (this.currentBookId) this.stateManager.persistQueue(this.currentBookId);
    });
  }

  // --- Playback Logic ---

  async play(): Promise<void> {
    return this.taskSequencer.enqueue(() => this.playInternal());
  }

  async resume(): Promise<void> {
     return this.taskSequencer.enqueue(() => this.resumeInternal());
  }

  pause() {
    return this.taskSequencer.enqueue(async () => {
        this.providerManager.pause();
        this.setStatus('paused');
        await this.savePlaybackState();
    });
  }

  stop() {
      return this.taskSequencer.enqueue(async () => {
          await this.stopInternal();
      });
  }

  next() {
      return this.taskSequencer.enqueue(async () => {
        if (this.stateManager.hasNext()) {
            this.stateManager.next();
            if (this.currentBookId) this.stateManager.persistQueue(this.currentBookId);

            if (this.status === 'paused') this.setStatus('stopped');
            await this.playInternal();
        } else {
            await this.stopInternal();
        }
      });
  }

  prev() {
      return this.taskSequencer.enqueue(async () => {
        if (this.stateManager.hasPrev()) {
            this.stateManager.prev();
            if (this.currentBookId) this.stateManager.persistQueue(this.currentBookId);

            if (this.status === 'paused') this.setStatus('stopped');
            await this.playInternal();
        }
      });
  }

  jumpTo(index: number) {
      return this.taskSequencer.enqueue(async () => {
          if (index >= 0 && index < this.stateManager.getQueue().length) {
              await this.stopInternal();
              this.stateManager.setCurrentIndex(index);
              if (this.currentBookId) this.stateManager.persistQueue(this.currentBookId);
              await this.playInternal();
          }
      });
  }

  seek(offset: number) {
      return this.taskSequencer.enqueue(async () => {
          if (offset > 0) {
              if (this.stateManager.hasNext()) {
                  this.stateManager.next();
                  if (this.currentBookId) this.stateManager.persistQueue(this.currentBookId);
                  await this.playInternal();
              } else {
                  await this.advanceToNextChapter();
              }
          } else {
              if (this.stateManager.hasPrev()) {
                  this.stateManager.prev();
                  if (this.currentBookId) this.stateManager.persistQueue(this.currentBookId);
                  await this.playInternal();
              } else {
                  await this.retreatToPreviousChapter();
              }
          }
      });
  }

  seekTo(time: number) {
      return this.taskSequencer.enqueue(async () => {
          const charsPerSecond = this.calculateCharsPerSecond();
          const newIndex = this.stateManager.calculateIndexForTime(time, charsPerSecond);
          const currentIndex = this.stateManager.getCurrentIndex();

          const wasPlaying = (this.status === 'playing' || this.status === 'loading');

          if (newIndex === currentIndex) {
             if (this.stateManager.hasNext()) {
                 this.stateManager.next();
             } else {
                 await this.advanceToNextChapter();
                 return;
             }
          } else {
              this.stateManager.setCurrentIndex(newIndex);
          }

          if (wasPlaying) {
              this.providerManager.stop();
          }

          if (this.currentBookId) this.stateManager.persistQueue(this.currentBookId);

          if (wasPlaying) {
              await this.playInternal();
          } else {
              this.updateMediaSessionMetadata();
              this.notifyListeners(this.stateManager.getCurrentItem()?.cfi || null);
              this.updateSectionMediaPosition(0);
          }
      });
  }

  setSpeed(speed: number) {
      this.speed = speed;
      return this.taskSequencer.enqueue(async () => {
        if (this.status === 'playing' || this.status === 'loading') {
            this.providerManager.stop();
            await this.playInternal();
        }
      });
  }

  setVoice(voiceId: string) {
      this.voiceId = voiceId;
      return this.taskSequencer.enqueue(async () => {
        if (this.status === 'playing' || this.status === 'loading') {
            this.providerManager.stop();
            await this.playInternal();
        }
      });
  }

  async preview(text: string): Promise<void> {
      return this.taskSequencer.enqueue(async () => {
        await this.stopInternal();
        this.isPreviewing = true;
        this.setStatus('playing');

        try {
            await this.providerManager.play(text, {
                voiceId: this.voiceId || '',
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

  // --- Loading Logic ---

  public loadSection(sectionIndex: number, autoPlay: boolean = true) {
      return this.taskSequencer.enqueue(() => this.loadSectionInternal(sectionIndex, autoPlay));
  }

  public loadSectionBySectionId(sectionId: string, autoPlay: boolean = true, sectionTitle?: string) {
      return this.taskSequencer.enqueue(async () => {
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
      let prevSectionIndex = this.stateManager.getCurrentSectionIndex() - 1;
      while (prevSectionIndex >= 0) {
          const loaded = await this.loadSectionInternal(prevSectionIndex, true);
          if (loaded) return true;
          prevSectionIndex--;
      }
      return false;
  }

  // --- Internal Implementation ---

  private async loadSectionInternal(sectionIndex: number, autoPlay: boolean, sectionTitle?: string): Promise<boolean> {
      if (!this.currentBookId || sectionIndex < 0 || sectionIndex >= this.playlist.length) return false;

      const section = this.playlist[sectionIndex];

      // Ensure coverUrl is available
      if (!this.currentCoverUrl) {
          const bookMetadata = await dbService.getBookMetadata(this.currentBookId);
          if (bookMetadata?.coverBlob) {
               this.currentCoverUrl = URL.createObjectURL(bookMetadata.coverBlob);
          } else if (bookMetadata?.coverUrl) {
               this.currentCoverUrl = bookMetadata.coverUrl;
          }
      }

      const result = await this.contentPipeline.processSectionWithCover(
          this.currentBookId,
          section,
          this.playlist,
          this.currentCoverUrl || undefined,
          sectionTitle
      );

      if (result) {
          const { queue } = result;

          if (this.prerollEnabled) {
             const title = queue[0]?.title || `Section ${sectionIndex + 1}`;
             const prerollText = this.generatePreroll(title, Math.round(section.characterCount / 5), this.speed);
             queue.unshift({
                  text: prerollText,
                  cfi: null,
                  isPreroll: true,
                  title: title,
                  bookTitle: queue[0]?.bookTitle,
                  author: queue[0]?.author,
                  coverUrl: this.currentCoverUrl || undefined
             });
          }

          if (queue.length > 0) {
               if (autoPlay) {
                  this.providerManager.stop();
                  await this.savePlaybackState();
                  this.setStatus('loading');
              } else {
                  await this.stopInternal();
              }

              this.stateManager.setQueue(queue, 0, sectionIndex);
              this.updateMediaSessionMetadata();
              this.notifyListeners(this.stateManager.getCurrentItem()?.cfi || null);
              if (this.currentBookId) this.stateManager.persistQueue(this.currentBookId);

              if (autoPlay) {
                   await this.playInternal();
              }

              this.contentPipeline.triggerNextChapterAnalysis(this.currentBookId, sectionIndex, this.playlist);
              return true;
          }
      }
      return false;
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
                if (book.lastPlayedCfi && this.stateManager.getCurrentIndex() === 0) {
                     const index = this.stateManager.getQueue().findIndex(item => item.cfi === book.lastPlayedCfi);
                     if (index >= 0) this.stateManager.setCurrentIndex(index);
                }
                if (book.lastPauseTime) return this.resumeInternal();
            }
        } catch (e) {
            console.warn("Failed to restore playback state", e);
        }
    }

    if (this.stateManager.getCurrentIndex() >= this.stateManager.getQueue().length) {
        this.setStatus('stopped');
        this.notifyListeners(null);
        return;
    }

    const item = this.stateManager.getCurrentItem();
    if (!item) return;

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
    if (this.currentBookId) this.stateManager.persistQueue(this.currentBookId);

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

        // Preload next
        const queue = this.stateManager.getQueue();
        const nextIndex = this.stateManager.getCurrentIndex() + 1;
        if (nextIndex < queue.length) {
             const nextItem = queue[nextIndex];
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

  private async resumeInternal(): Promise<void> {
     this.sessionRestored = true;
     return this.playInternal(true);
  }

  private async stopInternal() {
    await this.savePlaybackState();

    // We handle stopped status before notifying provider to stop
    // but the original code called provider.stop() at the end.
    // Platform integration should be updated.

    if (Capacitor.isNativePlatform()) {
        try {
            await this.platformIntegration.setPlaybackState('none');
        } catch (e) { console.warn(e); }
    }
    this.setStatus('stopped');
    this.notifyListeners(null);
    this.providerManager.stop();
  }

  private async advanceToNextChapter(): Promise<boolean> {
      if (!this.currentBookId || this.playlist.length === 0) return false;

      let nextSectionIndex = this.stateManager.getCurrentSectionIndex() + 1;
      if (this.stateManager.getCurrentSectionIndex() === -1) nextSectionIndex = 0;

      while (nextSectionIndex < this.playlist.length) {
          const loaded = await this.loadSectionInternal(nextSectionIndex, true);
          if (loaded) return true;
          nextSectionIndex++;
      }
      return false;
  }

  private async retreatToPreviousChapter(): Promise<boolean> {
      if (!this.currentBookId || this.playlist.length === 0) return false;

      let prevSectionIndex = this.stateManager.getCurrentSectionIndex() - 1;

      while (prevSectionIndex >= 0) {
          const loaded = await this.loadSectionInternal(prevSectionIndex, false);
          if (loaded) {
              this.stateManager.setCurrentIndex(Math.max(0, this.stateManager.getQueue().length - 1));
              if (this.currentBookId) this.stateManager.persistQueue(this.currentBookId);

              this.updateMediaSessionMetadata();
              this.notifyListeners(this.stateManager.getCurrentItem()?.cfi || null);

              await this.playInternal();
              return true;
          }
          prevSectionIndex--;
      }
      return false;
  }

  private playNext() {
      // Execute within the operation lock
      this.taskSequencer.enqueue(async () => {
          if (this.status !== 'stopped') {
              // Update Reading History
              if (this.currentBookId) {
                  const item = this.stateManager.getCurrentItem();
                  if (item && item.cfi && !item.isPreroll) {
                      dbService.updateReadingHistory(this.currentBookId, item.cfi, 'tts', item.text, true).catch(console.error);
                  }
              }

              if (this.stateManager.hasNext()) {
                  this.platformIntegration.handleBackgroundAudio(this.status);
                  this.stateManager.next();
                  if (this.currentBookId) this.stateManager.persistQueue(this.currentBookId);
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

      this.platformIntegration.setPlaybackState(
          status === 'playing' ? 'playing' : (status === 'paused' ? 'paused' : 'none')
      );

      this.platformIntegration.handleBackgroundAudio(status);

      const currentCfi = (this.stateManager.getCurrentItem() && (status === 'playing' || status === 'loading' || status === 'paused'))
        ? this.stateManager.getCurrentItem()?.cfi || null
        : null;

      this.notifyListeners(currentCfi);
  }

  // --- Helpers ---

  private async engageBackgroundMode(item: TTSQueueItem): Promise<boolean> {
      try {
          await this.platformIntegration.updateMediaSession(
              item,
              this.stateManager.getCurrentSectionIndex(),
              this.playlist.length,
              'playing'
          );
          return true;
      } catch (e) {
          console.error('Background engagement failed', e);
          return false;
      }
  }

  private updateMediaSessionMetadata() {
      const item = this.stateManager.getCurrentItem();
      if (item) {
          // Always update position when track changes
          this.updateSectionMediaPosition(0);

          this.platformIntegration.updateMediaSession(
              item,
              this.stateManager.getCurrentSectionIndex(),
              this.playlist.length,
              this.status === 'playing' ? 'playing' : (this.status === 'paused' ? 'paused' : 'none')
          );
      }
  }

  private updateSectionMediaPosition(providerTime: number) {
      const charsPerSecond = this.calculateCharsPerSecond();
      if (charsPerSecond === 0) return;

      const totalDuration = this.stateManager.calculateTotalDuration(charsPerSecond);
      const currentPosition = this.stateManager.calculateCurrentPosition(charsPerSecond, providerTime);
      const safeDuration = Math.max(totalDuration, currentPosition);

      this.platformIntegration.updatePosition({
          duration: safeDuration,
          playbackRate: this.speed,
          position: currentPosition
      });
  }

  private calculateCharsPerSecond(): number {
      return (900 * this.speed) / 60;
  }

  public generatePreroll(chapterTitle: string, wordCount: number, speed: number = 1.0): string {
      const WORDS_PER_MINUTE = 180;
      const adjustedWpm = WORDS_PER_MINUTE * speed;
      const minutes = Math.max(1, Math.round(wordCount / adjustedWpm));
      return `${chapterTitle}. Estimated reading time: ${minutes} minute${minutes === 1 ? '' : 's'}.`;
  }

  private async restoreQueue(bookId: string) {
      this.taskSequencer.enqueue(async () => {
          try {
              if (this.currentBookId !== bookId) return;

              const restored = await this.stateManager.restoreQueue(bookId);
              if (restored) {
                  this.updateMediaSessionMetadata();
                  this.notifyListeners(this.stateManager.getCurrentItem()?.cfi || null);
              }
          } catch (e) {
              console.error("Failed to restore TTS queue", e);
          }
      });
  }

  private async savePlaybackState() {
      if (!this.currentBookId) return;
      const currentItem = this.stateManager.getCurrentItem();
      const lastPlayedCfi = (currentItem && currentItem.cfi) ? currentItem.cfi : undefined;
      const isPaused = this.status === 'paused';
      const lastPauseTime = isPaused ? Date.now() : null;
      try {
        await dbService.updatePlaybackState(this.currentBookId, lastPlayedCfi, lastPauseTime);
      } catch (e) {
          console.warn('Failed to save playback state', e);
      }
  }

  // --- Subscriptions ---

  subscribe(listener: PlaybackListener) {
    this.listeners.push(listener);
    const currentCfi = this.stateManager.getCurrentItem()?.cfi || null;
    const queue = this.stateManager.getQueue();
    const currentIndex = this.stateManager.getCurrentIndex();

    setTimeout(() => {
        listener(this.status, currentCfi, currentIndex, queue, null);
    }, 0);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(activeCfi: string | null) {
      const queue = this.stateManager.getQueue();
      const currentIndex = this.stateManager.getCurrentIndex();
      this.listeners.forEach(l => l(this.status, activeCfi, currentIndex, queue, null));
  }

  private notifyError(message: string) {
      const queue = this.stateManager.getQueue();
      const currentIndex = this.stateManager.getCurrentIndex();
      const cfi = queue[currentIndex]?.cfi || null;
      this.listeners.forEach(l => l(this.status, cfi, currentIndex, queue, message));
  }

  private notifyDownloadProgress(voiceId: string, percent: number, status: string) {
      const queue = this.stateManager.getQueue();
      const currentIndex = this.stateManager.getCurrentIndex();
      const cfi = queue[currentIndex]?.cfi || null;
      this.listeners.forEach(l => l(this.status, cfi, currentIndex, queue, null, { voiceId, percent, status }));
  }
}

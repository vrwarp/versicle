import type { ITTSProvider, TTSVoice } from './providers/types';
import { SyncEngine, type AlignmentData } from './SyncEngine';
import { LexiconService } from './LexiconService';
import { dbService } from '../../db/DBService';
import type { SectionMetadata, LexiconRule } from '../../types/db';
import { TaskSequencer } from './TaskSequencer';
import { AudioContentPipeline } from './AudioContentPipeline';
import { PlaybackStateManager } from './PlaybackStateManager';
import { TTSProviderManager } from './TTSProviderManager';
import { PlatformIntegration } from './PlatformIntegration';
import type { BackgroundAudioMode } from './BackgroundAudio';
import { Capacitor } from '@capacitor/core';
import { WebSpeechProvider } from './providers/WebSpeechProvider';
import { CapacitorTTSProvider } from './providers/CapacitorTTSProvider';

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
  private taskSequencer: TaskSequencer;
  private pipeline: AudioContentPipeline;
  private stateManager: PlaybackStateManager;
  private providerManager: TTSProviderManager;
  private platformIntegration: PlatformIntegration;
  private syncEngine: SyncEngine | null = null;
  private lexiconService: LexiconService;

  private status: TTSStatus = 'stopped';
  private listeners: PlaybackListener[] = [];

  // State
  private currentBookId: string | null = null;
  private playlist: SectionMetadata[] = [];
  private playlistPromise: Promise<void> | null = null;
  private sessionRestored: boolean = false;
  private prerollEnabled: boolean = false;
  private isPreviewing: boolean = false;

  private voiceId: string | null = null;
  private activeLexiconRules: LexiconRule[] | null = null;
  private speed: number = 1.0;
  private currentCoverUrl: string | null = null;

  private constructor() {
    this.taskSequencer = new TaskSequencer();
    this.pipeline = new AudioContentPipeline();
    this.stateManager = new PlaybackStateManager();
    this.providerManager = new TTSProviderManager();
    this.syncEngine = new SyncEngine();
    this.lexiconService = LexiconService.getInstance();

    this.platformIntegration = new PlatformIntegration({
        onPlay: () => this.resume(),
        onPause: () => this.pause(),
        onStop: () => this.stop(),
        onPrev: () => this.prev(),
        onNext: () => this.next(),
        onSeekBackward: () => this.seek(-10),
        onSeekForward: () => this.seek(10),
        onSeekTo: (time) => this.seekTo(time),
    });

    this.setupProviderListeners();
    this.setupStateListeners();

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

  private setupProviderListeners() {
      this.providerManager.on((event) => {
          if (event.type === 'start') {
              this.setStatus('playing');
          } else if (event.type === 'end') {
              if (this.isPreviewing) {
                  this.isPreviewing = false;
                  this.setStatus('stopped');
                  return;
              }
              this.playNext();
          } else if (event.type === 'error') {
               const errorObj = event.error as unknown as { error?: string, message?: string };
               const errorType = errorObj?.error || event.error;

               if (errorType === 'interrupted' || errorType === 'canceled') return;

               console.error("TTS Provider Error", event.error);
               this.setStatus('stopped');

               let message = "Unknown error";
               if (typeof event.error === 'string') {
                   message = event.error;
               } else if (event.error && typeof event.error === 'object') {
                   // eslint-disable-next-line @typescript-eslint/no-explicit-any
                   message = (event.error as any).message || JSON.stringify(event.error);
               }

               this.notifyError("Playback Error: " + message);
          } else if (event.type === 'timeupdate') {
               this.syncEngine?.updateTime(event.currentTime);
               this.stateManager.setSpeed(this.speed);
               const position = this.stateManager.getCurrentPosition(event.currentTime);
               const duration = this.stateManager.getDuration();
               // Safety: position <= duration check handled inside updatePositionState? No, do it here or inside platform
               const safeDuration = Math.max(duration, position);
               this.platformIntegration.updatePositionState(safeDuration, position, this.speed);

          } else if (event.type === 'boundary') {
              // Optionally update sync engine or progress
          } else if (event.type === 'meta') {
              if (event.alignment && this.syncEngine) {
                   const alignmentData: AlignmentData[] = event.alignment.map(tp => ({
                       time: tp.timeSeconds,
                       textOffset: tp.charIndex,
                       type: (tp.type as 'word' | 'sentence') || 'word'
                   }));
                   this.syncEngine.loadAlignment(alignmentData);
              }
          } else if (event.type === 'download-progress') {
              this.notifyDownloadProgress(event.voiceId, event.percent, event.status);
          }
      });
  }

  private setupStateListeners() {
      // When internal state changes (e.g. index updates), notify external listeners
      this.stateManager.subscribe(() => {
         // This is a bit redundant if we notify manually, but good for reactivity
         // We handle explicit notifications in methods like next(), prev(), so maybe this is unused for now.
         // Or we can use it to sync UI.
      });
  }

  private notifyListeners(activeCfi: string | null) {
      this.listeners.forEach(l => l(this.status, activeCfi, this.stateManager.getCurrentIndex(), this.stateManager.getQueue(), null));
  }

  private notifyError(message: string) {
      this.listeners.forEach(l => l(this.status, this.stateManager.getCurrentItem()?.cfi || null, this.stateManager.getCurrentIndex(), this.stateManager.getQueue(), message));
  }

  private notifyDownloadProgress(voiceId: string, percent: number, status: string) {
      this.listeners.forEach(l => l(this.status, this.stateManager.getCurrentItem()?.cfi || null, this.stateManager.getCurrentIndex(), this.stateManager.getQueue(), null, { voiceId, percent, status }));
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
              this.stateManager.reset();
              this.playlist = [];
              this.playlistPromise = null;
              this.setStatus('stopped');
          }

          this.activeLexiconRules = null;
      }
  }

  private async restoreQueue(bookId: string) {
      this.taskSequencer.enqueue(async () => {
          try {
              const state = await dbService.getTTSState(bookId);
              if (this.currentBookId !== bookId) return;

              if (state && state.queue && state.queue.length > 0) {
                  await this.stopInternal();
                  this.stateManager.setQueue(state.queue, state.currentIndex || 0, state.sectionIndex ?? -1);

                  const item = this.stateManager.getCurrentItem();
                  if (item) {
                      this.platformIntegration.updateMediaMetadata(item, this.stateManager.getCurrentSectionIndex(), this.playlist.length);
                      this.notifyListeners(item.cfi || null);
                  }
              }
          } catch (e) {
              console.error("Failed to restore TTS queue", e);
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

  public setProvider(provider: ITTSProvider) {
      return this.taskSequencer.enqueue(async () => {
        await this.stopInternal();
        await this.providerManager.setProvider(provider);
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
      return this.stateManager.getQueue();
  }

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

  setQueue(items: TTSQueueItem[], startIndex: number = 0) {
    return this.taskSequencer.enqueue(async () => {
        // Quick equality check
        const currentQueue = this.stateManager.getQueue();
        if (currentQueue.length === items.length && items.every((val, index) => val.text === currentQueue[index].text && val.cfi === currentQueue[index].cfi)) {
             this.stateManager.setQueue(items, 0, this.stateManager.getCurrentSectionIndex()); // Just refreshes logic?
             // Actually original logic was: if queue equal, just set it and return.
             // But we might need to reset currentIndex if it's different? Original kept currentIndex if equal??
             // No, original: if equal, set queue (which is same), calc prefix sums, update metadata, notify, persist.
             // It did NOT change currentIndex.

             // Wait, original: `if (this.isQueueEqual(items)) { this.queue = items; ... return; }`
             // It did NOT change currentIndex.

             // But here `startIndex` is passed. If startIndex is different, we should jump?
             // Original `setQueue` didn't take `startIndex` in signature shown in my read_file output?
             // Ah, `setQueue(items: TTSQueueItem[], startIndex: number = 0)` YES it did.

             // Let's assume consumer knows what they are doing.
             // If queue is equal, we might still want to jump to startIndex if provided?
             // Original code ignored startIndex if queue was equal. I will replicate that behavior.

             this.stateManager.setQueue(items, this.stateManager.getCurrentIndex(), this.stateManager.getCurrentSectionIndex());
             const item = this.stateManager.getCurrentItem();
             if (item) {
                 this.platformIntegration.updateMediaMetadata(item, this.stateManager.getCurrentSectionIndex(), this.playlist.length);
                 this.notifyListeners(item.cfi || null);
             }
             this.stateManager.persist(this.currentBookId || '');
             return;
        }

        await this.stopInternal();
        this.stateManager.setQueue(items, startIndex, this.stateManager.getCurrentSectionIndex());

        const item = this.stateManager.getCurrentItem();
        if (item) {
            this.platformIntegration.updateMediaMetadata(item, this.stateManager.getCurrentSectionIndex(), this.playlist.length);
            this.notifyListeners(item.cfi || null);
        }
        this.stateManager.persist(this.currentBookId || '');
    });
  }

  jumpTo(index: number) {
      return this.taskSequencer.enqueue(async () => {
          if (this.stateManager.jumpTo(index)) {
              await this.stopInternal(); // Stop current playback
              this.stateManager.persist(this.currentBookId || '');
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

  async play(): Promise<void> {
    return this.taskSequencer.enqueue(() => this.playInternal());
  }

  private async playInternal(): Promise<void> {
    if (this.status === 'paused') {
        return this.resumeInternal();
    }

    if (this.status === 'stopped' && this.currentBookId && !this.sessionRestored) {
        this.sessionRestored = true;
        try {
            const book = await dbService.getBookMetadata(this.currentBookId);
            if (book) {
                if (book.lastPlayedCfi && this.stateManager.getCurrentIndex() === 0) {
                     // Try to find index of lastPlayedCfi
                     const queue = this.stateManager.getQueue();
                     const index = queue.findIndex(item => item.cfi === book.lastPlayedCfi);
                     if (index >= 0) this.stateManager.jumpTo(index);
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
        const engaged = await this.platformIntegration.engageBackgroundMode(
            item,
            this.stateManager.getCurrentSectionIndex(),
            this.playlist.length
        );
        if (!engaged && Capacitor.getPlatform() === 'android') {
             this.setStatus('stopped');
             this.notifyError("Cannot play in background");
             return;
        }
        this.setStatus('loading');
    }

    this.notifyListeners(item.cfi || null);
    this.platformIntegration.updateMediaMetadata(item, this.stateManager.getCurrentSectionIndex(), this.playlist.length);
    this.stateManager.persist(this.currentBookId || '');

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

        // Preload next
        const queue = this.stateManager.getQueue();
        const currentIndex = this.stateManager.getCurrentIndex();
        if (currentIndex < queue.length - 1) {
             const nextItem = queue[currentIndex + 1];
             const nextProcessed = this.lexiconService.applyLexicon(nextItem.text, rules);
             this.providerManager.preload(nextProcessed, {
                 voiceId,
                 speed: this.speed
             });
        }

    } catch (e) {
        // Provider manager handles fallback, but if it throws up here, it's fatal
        console.error("Play error", e);
        this.setStatus('stopped');
        this.notifyError(e instanceof Error ? e.message : "Playback error");
    }
  }

  async resume(): Promise<void> {
     return this.taskSequencer.enqueue(() => this.resumeInternal());
  }

  private async resumeInternal(): Promise<void> {
     this.sessionRestored = true;

     if (this.status === 'paused') {
         this.providerManager.resume();
         this.setStatus('playing');
     } else {
         return this.playInternal();
     }
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

  private async stopInternal() {
    await this.savePlaybackState();
    this.setStatus('stopped');
    this.notifyListeners(null);
    this.providerManager.stop();
  }

  next() {
      return this.taskSequencer.enqueue(async () => {
        if (this.stateManager.next()) {
            this.stateManager.persist(this.currentBookId || '');
            if (this.status === 'paused') this.setStatus('stopped');
            await this.playInternal();
        } else {
            await this.stopInternal();
        }
      });
  }

  prev() {
      return this.taskSequencer.enqueue(async () => {
        if (this.stateManager.prev()) {
            this.stateManager.persist(this.currentBookId || '');
            if (this.status === 'paused') this.setStatus('stopped');
            await this.playInternal();
        }
      });
  }

  setSpeed(speed: number) {
      this.speed = speed;
      this.stateManager.setSpeed(speed);
      return this.taskSequencer.enqueue(async () => {
        if (this.status === 'playing' || this.status === 'loading') {
            this.providerManager.stop();
            await this.playInternal();
        }
      });
  }

  seekTo(time: number) {
      return this.taskSequencer.enqueue(async () => {
          const newIndex = this.stateManager.calculateTargetIndexForTime(time);
          const currentIndex = this.stateManager.getCurrentIndex();

          // Fix: Avoid restarting current sentence if index didn't change,
          // unless it's the last sentence where we might want to go to next chapter.
          // Original logic:
          /*
          if (newIndex === this.currentIndex) {
             if (newIndex < this.queue.length - 1) {
                 newIndex++;
             } else {
                 await this.advanceToNextChapter();
                 return;
             }
          }
          */

          let adjustedIndex = newIndex;
          if (adjustedIndex === currentIndex) {
              if (this.stateManager.hasNext()) {
                  adjustedIndex++;
              } else {
                  await this.advanceToNextChapter();
                  return;
              }
          }

          const wasPlaying = (this.status === 'playing' || this.status === 'loading');

          if (wasPlaying) {
              this.providerManager.stop();
          }

          this.stateManager.jumpTo(adjustedIndex);
          this.stateManager.persist(this.currentBookId || '');

          if (wasPlaying) {
              await this.playInternal();
          } else {
              const item = this.stateManager.getCurrentItem();
              if (item) {
                 this.platformIntegration.updateMediaMetadata(item, this.stateManager.getCurrentSectionIndex(), this.playlist.length);
                 this.notifyListeners(item.cfi || null);
                 this.platformIntegration.updatePositionState(this.stateManager.getDuration(), 0, this.speed);
              }
          }
      });
  }

  seek(offset: number) {
      return this.taskSequencer.enqueue(async () => {
          if (offset > 0) {
              if (this.stateManager.next()) {
                  this.stateManager.persist(this.currentBookId || '');
                  await this.playInternal();
              } else {
                  await this.advanceToNextChapter();
              }
          } else {
              if (this.stateManager.prev()) {
                  this.stateManager.persist(this.currentBookId || '');
                  await this.playInternal();
              } else {
                  await this.retreatToPreviousChapter();
              }
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

  private playNext() {
      this.taskSequencer.enqueue(async () => {
          if (this.status !== 'stopped') {
              if (this.currentBookId) {
                  const item = this.stateManager.getCurrentItem();
                  if (item && item.cfi && !item.isPreroll) {
                      dbService.updateReadingHistory(this.currentBookId, item.cfi, 'tts', item.text, true).catch(console.error);
                  }
              }

              if (this.stateManager.next()) {
                  this.platformIntegration.setBackgroundAudioMode(this.platformIntegration['backgroundAudioMode'], true); // Hack access or add getter?
                  // Wait, platform integration handles background audio on setStatus.
                  // But playNext needs to ensure audio is playing?
                  // `this.backgroundAudio.play` was called in original.
                  // `setStatus` calls it.
                  this.stateManager.persist(this.currentBookId || '');
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
      // Record history on pause/stop
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

      this.platformIntegration.setPlaybackState(status);

      const currentItem = this.stateManager.getCurrentItem();
      const currentCfi = (currentItem && (status === 'playing' || status === 'loading' || status === 'paused'))
        ? currentItem.cfi
        : null;

      this.notifyListeners(currentCfi);
  }

  subscribe(listener: PlaybackListener) {
    this.listeners.push(listener);
    const currentItem = this.stateManager.getCurrentItem();
    const currentCfi = currentItem?.cfi || null;
    setTimeout(() => {
        listener(this.status, currentCfi, this.stateManager.getCurrentIndex(), this.stateManager.getQueue(), null);
    }, 0);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  public async checkBatteryOptimization() {
      await this.platformIntegration.checkBatteryOptimization();
  }

  private async loadSectionInternal(sectionIndex: number, autoPlay: boolean, sectionTitle?: string): Promise<boolean> {
      if (!this.currentBookId || sectionIndex < 0 || sectionIndex >= this.playlist.length) return false;
      const section = this.playlist[sectionIndex];

      try {
          // Resolve cover URL only if needed. Pipeline doesn't manage ObjectURL lifecycle.
          // Original logic managed it here.
          // Let's keep managing it here or pass it down.
          // Pipeline returns generic items.

          // Re-implement cover logic here or in pipeline?
          // Pipeline doesn't have access to `this.currentCoverUrl` state.
          // So we should handle the coverUrl *after* receiving items from pipeline or pass it in.
          // Let's pass it in? No, pipeline generates the queue items.
          // I will let pipeline generate items with *undefined* coverUrl if it's not a string in DB.
          // And then I patch them here.

          const newQueue = await this.pipeline.loadSection(
              this.currentBookId,
              section,
              sectionTitle,
              this.prerollEnabled,
              this.speed
          );

          // Handle Cover URL
          // We need bookMetadata to get the cover blob if not url.
          // Pipeline already fetched metadata but didn't return it.
          // Optimally, pipeline should return { queue, coverBlob? }.
          // Or we just fetch metadata again? It's indexeddb, cheap enough.

          const bookMetadata = await dbService.getBookMetadata(this.currentBookId);
          let coverUrl = bookMetadata?.coverUrl;
          if (!coverUrl && bookMetadata?.coverBlob) {
               if (!this.currentCoverUrl) {
                  this.currentCoverUrl = URL.createObjectURL(bookMetadata.coverBlob);
               }
               coverUrl = this.currentCoverUrl;
          }

          if (coverUrl) {
              newQueue.forEach(item => item.coverUrl = coverUrl);
          }

          if (newQueue.length > 0) {
              if (autoPlay) {
                  this.providerManager.stop();
                  await this.savePlaybackState();
                  this.setStatus('loading');
              } else {
                  await this.stopInternal();
              }

              this.stateManager.setQueue(newQueue, 0, sectionIndex);

              const item = this.stateManager.getCurrentItem();
              if (item) {
                  this.platformIntegration.updateMediaMetadata(item, sectionIndex, this.playlist.length);
                  this.notifyListeners(item.cfi || null);
              }
              this.stateManager.persist(this.currentBookId);

              if (autoPlay) {
                   await this.playInternal();
              }

              // Trigger next chapter analysis
              const nextIndex = sectionIndex + 1;
              if (nextIndex < this.playlist.length) {
                  this.pipeline.triggerNextChapterAnalysis(this.currentBookId, this.playlist[nextIndex]);
              } else {
                  console.log("Not triggering next analysis", nextIndex, this.playlist.length);
              }
              return true;
          }

      } catch (e) {
          console.error("Failed to load section content", e);
      }
      return false;
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
              this.stateManager.moveToEnd();
              this.stateManager.persist(this.currentBookId);

              const item = this.stateManager.getCurrentItem();
              if (item) {
                  this.platformIntegration.updateMediaMetadata(item, prevSectionIndex, this.playlist.length);
                  this.notifyListeners(item.cfi || null);
              }

              await this.playInternal();
              return true;
          }
          prevSectionIndex--;
      }
      return false;
  }
}

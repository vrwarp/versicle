import type { ITTSProvider, TTSVoice } from './providers/types';
import { WebSpeechProvider } from './providers/WebSpeechProvider';
import { BackgroundAudio, type BackgroundAudioMode } from './BackgroundAudio';
import { Capacitor } from '@capacitor/core';
import { BatteryOptimization } from '@capawesome-team/capacitor-android-battery-optimization';
import { CapacitorTTSProvider } from './providers/CapacitorTTSProvider';
import { SyncEngine, type AlignmentData } from './SyncEngine';
import { LexiconService } from './LexiconService';
import { MediaSessionManager, type MediaSessionMetadata } from './MediaSessionManager';
import { dbService } from '../../db/DBService';
import type { SectionMetadata, LexiconRule } from '../../types/db';
import { TextSegmenter } from './TextSegmenter';
import { useTTSStore } from '../../store/useTTSStore';

const NO_TEXT_MESSAGES = [
    "This chapter appears to be empty.",
    "There is no text to read here.",
    "This page contains only images or formatting.",
    "Silence fills this chapter.",
    "Moving on, as this section has no content.",
    "No words found on this page.",
    "This section is blank.",
    "Skipping this empty section.",
    "Nothing to read here.",
    "This part of the book is silent."
];

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
  private provider: ITTSProvider;
  private syncEngine: SyncEngine | null = null;
  private mediaSessionManager: MediaSessionManager;
  private lexiconService: LexiconService;
  private queue: TTSQueueItem[] = [];
  private currentIndex: number = 0;
  private status: TTSStatus = 'stopped';
  private listeners: PlaybackListener[] = [];

  private activeLexiconRules: LexiconRule[] | null = null;

  private speed: number = 1.0;
  private voiceId: string | null = null;

  private currentBookId: string | null = null;
  private playlist: SectionMetadata[] = [];
  private playlistPromise: Promise<void> | null = null;
  private currentSectionIndex: number = -1;
  private sessionRestored: boolean = false;
  private prerollEnabled: boolean = false;
  private isPreviewing: boolean = false;

  private pendingPromise: Promise<void> = Promise.resolve();
  private isDestroyed = false;

  private backgroundAudio: BackgroundAudio;
  private backgroundAudioMode: BackgroundAudioMode = 'silence';
  private lastMetadata: MediaSessionMetadata | null = null;

  // Track last persisted queue to avoid redundant heavy writes
  private lastPersistedQueue: TTSQueueItem[] | null = null;

  private constructor() {
    this.backgroundAudio = new BackgroundAudio();
    this.syncEngine = new SyncEngine();

    if (Capacitor.isNativePlatform()) {
        this.provider = new CapacitorTTSProvider();
    } else {
        this.provider = new WebSpeechProvider();
    }

    this.setupProviderListeners();

    this.lexiconService = LexiconService.getInstance();
    this.mediaSessionManager = new MediaSessionManager({
        onPlay: () => this.resume(),
        onPause: () => this.pause(),
        onStop: () => this.stop(),
        onPrev: () => this.prev(),
        onNext: () => this.next(),
        onSeekBackward: () => this.seek(-10),
        onSeekForward: () => this.seek(10),
        onSeekTo: () => {
             // Not supporting seekTo for now to keep consistency
             console.warn("SeekTo not supported");
        },
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

  private async enqueue<T>(task: () => Promise<T>): Promise<T | void> {
    const resultPromise = this.pendingPromise.then(async () => {
      if (this.isDestroyed) return;
      try {
        return await task();
      } catch (err) {
        console.error("Audio task failed safely:", err);
      }
    });

    this.pendingPromise = resultPromise.then(() => {}).catch(() => {});
    return resultPromise;
  }

  setBookId(bookId: string | null) {
      if (this.currentBookId !== bookId) {
          this.currentBookId = bookId;
          this.sessionRestored = false;
          // Clear tracked state when book changes
          this.lastPersistedQueue = null;

          if (bookId) {
              this.playlistPromise = dbService.getSections(bookId).then(sections => {
                  this.playlist = sections;
                  this.restoreQueue(bookId);
              }).catch(e => console.error("Failed to load playlist", e));
          } else {
              this.queue = [];
              this.playlist = [];
              this.playlistPromise = null;
              this.currentSectionIndex = -1;
              this.currentIndex = 0;
              this.setStatus('stopped');
          }

          // Clear cached rules when book changes
          this.activeLexiconRules = null;
      }
  }

  private async engageBackgroundMode(item: TTSQueueItem): Promise<boolean> {
      try {
          await this.mediaSessionManager.setMetadata({
              title: item.title || 'Chapter Text',
              artist: 'Versicle',
              album: item.bookTitle || '',
              artwork: item.coverUrl ? [{ src: item.coverUrl }] : []
          });
          await this.mediaSessionManager.setPlaybackState({
              playbackState: 'playing',
              playbackSpeed: this.speed
          });
          return true;
      } catch (e) {
          console.error('Background engagement failed', e);
          return false;
      }
  }

  private async restoreQueue(bookId: string) {
      this.enqueue(async () => {
          try {
              const state = await dbService.getTTSState(bookId);
              if (this.currentBookId !== bookId) return;

              if (state && state.queue && state.queue.length > 0) {
                  await this.stopInternal();
                  this.queue = state.queue;
                  this.currentIndex = state.currentIndex || 0;
                  this.currentSectionIndex = state.sectionIndex ?? -1;

                  // Track restored queue as persisted
                  this.lastPersistedQueue = this.queue;

                  this.updateMediaSessionMetadata();
                  this.notifyListeners(this.queue[this.currentIndex]?.cfi || null);
              }
          } catch (e) {
              console.error("Failed to restore TTS queue", e);
          }
      });
  }

  private setupProviderListeners() {
      this.provider.on((event) => {
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
               // Handle common interruption errors or real errors
               // eslint-disable-next-line @typescript-eslint/no-explicit-any
               const errorType = (event.error as any)?.error || event.error;
               // If it's just an interruption (e.g. from cancel), ignore
               if (errorType === 'interrupted' || errorType === 'canceled') return;

               console.error("TTS Provider Error", event.error);
               this.setStatus('stopped');
               this.notifyError("Playback Error: " + (event.error?.message || "Unknown error"));
          } else if (event.type === 'timeupdate') {
               this.syncEngine?.updateTime(event.currentTime);
               this.mediaSessionManager.setPositionState({
                   duration: event.duration || 0,
                   playbackRate: this.speed,
                   position: event.currentTime
               });
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

  private updateMediaSessionMetadata() {
      if (this.queue[this.currentIndex]) {
          const item = this.queue[this.currentIndex];
          const newMetadata: MediaSessionMetadata = {
              title: item.title || 'Chapter Text',
              artist: item.author || 'Versicle',
              album: item.bookTitle || '',
              artwork: item.coverUrl ? [{ src: item.coverUrl }] : []
          };

          if (this.lastMetadata && JSON.stringify(this.lastMetadata) === JSON.stringify(newMetadata)) {
              return;
          }

          this.mediaSessionManager.setMetadata(newMetadata);
          this.lastMetadata = newMetadata;
      }
  }

  public setBackgroundAudioMode(mode: BackgroundAudioMode) {
      this.backgroundAudioMode = mode;
      if (this.status === 'playing' || this.status === 'loading') {
          this.backgroundAudio.play(mode);
      }
  }

  public setBackgroundVolume(volume: number) {
      this.backgroundAudio.setVolume(volume);
  }

  public setPrerollEnabled(enabled: boolean) {
      this.prerollEnabled = enabled;
  }

  public setProvider(provider: ITTSProvider) {
      return this.enqueue(async () => {
        await this.stopInternal();
        this.provider = provider;
        this.setupProviderListeners();
      });
  }

  async init() {
    await this.provider.init();
  }

  async getVoices(): Promise<TTSVoice[]> {
    return this.provider.getVoices();
  }

  async downloadVoice(voiceId: string): Promise<void> {
      if (this.provider.id === 'piper') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const piper = this.provider as any;
          if (typeof piper.downloadVoice === 'function') {
              await piper.downloadVoice(voiceId);
          }
      }
  }

  async deleteVoice(voiceId: string): Promise<void> {
      if (this.provider.id === 'piper') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const piper = this.provider as any;
          if (typeof piper.deleteVoice === 'function') {
              await piper.deleteVoice(voiceId);
          }
      }
  }

  async isVoiceDownloaded(voiceId: string): Promise<boolean> {
       if (this.provider.id === 'piper') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const piper = this.provider as any;
           if (typeof piper.isVoiceDownloaded === 'function') {
              return await piper.isVoiceDownloaded(voiceId);
          }
       }
       return true;
  }

  public getQueue(): TTSQueueItem[] {
      return this.queue;
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

  private isQueueEqual(newItems: TTSQueueItem[]): boolean {
      if (this.queue.length !== newItems.length) return false;
      for (let i = 0; i < this.queue.length; i++) {
          if (this.queue[i].text !== newItems[i].text) return false;
          if (this.queue[i].cfi !== newItems[i].cfi) return false;
      }
      return true;
  }

  setQueue(items: TTSQueueItem[], startIndex: number = 0) {
    return this.enqueue(async () => {
        if (this.isQueueEqual(items)) {
            this.queue = items;
            this.updateMediaSessionMetadata();
            this.notifyListeners(this.queue[this.currentIndex]?.cfi || null);
            this.persistQueue();
            return;
        }

        await this.stopInternal();
        this.queue = items;
        this.currentIndex = startIndex;

        // Reset persisted tracker since queue changed
        this.lastPersistedQueue = null;

        this.updateMediaSessionMetadata();
        this.notifyListeners(this.queue[this.currentIndex]?.cfi || null);
        this.persistQueue();
    });
  }

  private persistQueue() {
      if (this.currentBookId) {
          // Optimization: If queue has not changed since last persist,
          // only update the position (currentIndex/sectionIndex).
          // This avoids serializing and writing the entire queue array to IndexedDB repeatedly.
          if (this.lastPersistedQueue === this.queue) {
              dbService.saveTTSPosition(this.currentBookId, this.currentIndex, this.currentSectionIndex);
          } else {
              dbService.saveTTSState(this.currentBookId, this.queue, this.currentIndex, this.currentSectionIndex);
              this.lastPersistedQueue = this.queue;
          }
      }
  }

  public generatePreroll(chapterTitle: string, wordCount: number, speed: number = 1.0): string {
      const WORDS_PER_MINUTE = 180;
      const adjustedWpm = WORDS_PER_MINUTE * speed;
      const minutes = Math.max(1, Math.round(wordCount / adjustedWpm));
      return `${chapterTitle}. Estimated reading time: ${minutes} minute${minutes === 1 ? '' : 's'}.`;
  }

  jumpTo(index: number) {
      return this.enqueue(async () => {
          if (index >= 0 && index < this.queue.length) {
              await this.stopInternal();
              this.currentIndex = index;
              this.persistQueue();
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

            await this.provider.play(text, {
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

  private async playInternal(): Promise<void> {
    if (this.status === 'paused') {
        return this.resumeInternal();
    }

    if (this.status === 'stopped' && this.currentBookId && !this.sessionRestored) {
        this.sessionRestored = true;
        try {
            const book = await dbService.getBookMetadata(this.currentBookId);
            if (book) {
                if (book.lastPlayedCfi && this.currentIndex === 0) {
                     const index = this.queue.findIndex(item => item.cfi === book.lastPlayedCfi);
                     if (index >= 0) this.currentIndex = index;
                }
                if (book.lastPauseTime) return this.resumeInternal();
            }
        } catch (e) {
            console.warn("Failed to restore playback state", e);
        }
    }

    if (this.currentIndex >= this.queue.length) {
        this.setStatus('stopped');
        this.notifyListeners(null);
        return;
    }

    const item = this.queue[this.currentIndex];

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
    this.persistQueue();

    try {
        const voiceId = this.voiceId || '';

        // Load and cache rules if not already cached for this session
        if (!this.activeLexiconRules) {
            this.activeLexiconRules = await this.lexiconService.getRules(this.currentBookId || undefined);
        }
        const rules = this.activeLexiconRules;

        const processedText = this.lexiconService.applyLexicon(item.text, rules);

        await this.provider.play(processedText, {
            voiceId,
            speed: this.speed
        });

        if (this.currentIndex < this.queue.length - 1) {
             const nextItem = this.queue[this.currentIndex + 1];
             const nextProcessed = this.lexiconService.applyLexicon(nextItem.text, rules);
             this.provider.preload(nextProcessed, {
                 voiceId,
                 speed: this.speed
             });
        }

    } catch (e) {
        console.error("Play error", e);

        if (this.provider.id !== 'local') {
            const errorMessage = e instanceof Error ? e.message : "Cloud TTS error";
            this.notifyError(`Cloud voice failed (${errorMessage}). Switching to local backup.`);
            console.warn("Falling back to local provider...");

             await this.stopInternal();
            if (Capacitor.isNativePlatform()) {
                this.provider = new CapacitorTTSProvider();
            } else {
                this.provider = new WebSpeechProvider();
            }
            this.setupProviderListeners();
            await this.init();
            return this.playInternal();
        }

        this.setStatus('stopped');
        this.notifyError(e instanceof Error ? e.message : "Playback error");
    }
  }

  async resume(): Promise<void> {
     return this.enqueue(() => this.resumeInternal());
  }

  private async resumeInternal(): Promise<void> {
     this.sessionRestored = true;

     if (this.status === 'paused') {
         this.provider.resume();
         this.setStatus('playing');
     } else {
         return this.playInternal();
     }
  }

  private async savePlaybackState() {
      if (!this.currentBookId) return;
      const currentItem = this.queue[this.currentIndex];
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
    return this.enqueue(async () => {
        this.provider.pause();
        this.setStatus('paused');
        await this.savePlaybackState();
    });
  }

  stop() {
      return this.enqueue(async () => {
          await this.stopInternal();
      });
  }

  private async stopInternal() {
    await this.savePlaybackState();

    if (Capacitor.isNativePlatform()) {
        try {
            await this.mediaSessionManager.setPlaybackState({ playbackState: 'none' });
        } catch (e) { console.warn(e); }
    }
    this.setStatus('stopped');
    this.notifyListeners(null);
    this.provider.stop();
  }

  next() {
      return this.enqueue(async () => {
        if (this.currentIndex < this.queue.length - 1) {
            this.currentIndex++;
            this.persistQueue();
            if (this.status === 'paused') this.setStatus('stopped');
            await this.playInternal();
        } else {
            await this.stopInternal();
        }
      });
  }

  prev() {
      return this.enqueue(async () => {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.persistQueue();
            if (this.status === 'paused') this.setStatus('stopped');
            await this.playInternal();
        }
      });
  }

  setSpeed(speed: number) {
      this.speed = speed;
      return this.enqueue(async () => {
        // If we are currently active, restart the current sentence with new speed
        // WITHOUT triggering setStatus('stopped') / mediaState 'none'
        if (this.status === 'playing' || this.status === 'loading') {
            this.provider.stop();
            await this.playInternal();
        }
        // If paused or stopped, we just update the speed variable (done above)
        // and the next manual 'play' will use it.
      });
  }

  seek(offset: number) {
      return this.enqueue(async () => {
          if (offset > 0) {
              if (this.currentIndex < this.queue.length - 1) {
                  this.currentIndex++;
                  this.persistQueue();
                  await this.playInternal();
              }
          } else {
              if (this.currentIndex > 0) {
                  this.currentIndex--;
                  this.persistQueue();
                  await this.playInternal();
              }
          }
      });
  }

  setVoice(voiceId: string) {
      this.voiceId = voiceId;
      return this.enqueue(async () => {
        if (this.status === 'playing' || this.status === 'loading') {
            this.provider.stop();
            await this.playInternal();
        }
      });
  }

  private playNext() {
      // Execute within the operation lock to prevent race conditions with user actions (pause, stop)
      this.enqueue(async () => {
          if (this.status !== 'stopped') {
              // Update Reading History:
              // The current item (this.queue[this.currentIndex]) has finished playing.
              // We mark its CFI range as "read" in the database.
              // This is used to track reading coverage (percent read) and potential sync with visual reader.
              if (this.currentBookId) {
                  const item = this.queue[this.currentIndex];
                  // Only track if it's a valid content item (not a preroll)
                  if (item && item.cfi && !item.isPreroll) {
                      dbService.updateReadingHistory(this.currentBookId, item.cfi, 'tts', item.text, true).catch(console.error);
                  }
              }

              // Advance to next item
              if (this.currentIndex < this.queue.length - 1) {
                  this.backgroundAudio.play(this.backgroundAudioMode);
                  this.currentIndex++;
                  this.persistQueue(); // Persist state so we can resume later
                  await this.playInternal(); // Start playing the next item
              } else {
                  // End of queue, try to load next chapter
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
           if (this.currentBookId && this.queue[this.currentIndex]) {
               const item = this.queue[this.currentIndex];
               if (item && item.cfi && !item.isPreroll) {
                   dbService.updateReadingHistory(this.currentBookId, item.cfi, 'tts', item.text, false).catch(console.error);
               }
           }
      }

      // State transition validation (placeholder logic for now)
      if (this.status === 'stopped' && status === 'playing') { /* valid */ }
      else if (this.status === 'stopped' && status === 'loading') { /* valid */ }
      else if (this.status === 'loading' && status === 'playing') { /* valid */ }
      else if (this.status === 'loading' && status === 'stopped') { /* valid */ }
      else if (this.status === 'playing' && status === 'paused') { /* valid */ }
      else if (this.status === 'paused' && status === 'playing') { /* valid */ }
      else if (this.status === 'paused' && status === 'loading') { /* valid */ }
      else if (this.status === 'playing' && status === 'stopped') { /* valid */ }
      else if (this.status === 'paused' && status === 'stopped') { /* valid */ }
      else if (status === 'completed') { /* valid */ }
      else if (this.status === status) { /* valid */ }

      this.status = status;

      // Clear cached rules on stop or pause to ensure freshness on next session
      if (status === 'stopped' || status === 'paused') {
          this.activeLexiconRules = null;
      }

      this.mediaSessionManager.setPlaybackState(
          status === 'playing' ? 'playing' : (status === 'paused' ? 'paused' : 'none')
      );

      if (status === 'playing' || status === 'loading' || status === 'completed') {
          this.backgroundAudio.play(this.backgroundAudioMode);
      } else if (status === 'paused') {
          this.backgroundAudio.stopWithDebounce(500);
      } else {
          this.backgroundAudio.forceStop();
      }

      const currentCfi = (this.queue[this.currentIndex] && (status === 'playing' || status === 'loading' || status === 'paused'))
        ? this.queue[this.currentIndex].cfi
        : null;

      this.notifyListeners(currentCfi);
  }

  subscribe(listener: PlaybackListener) {
    this.listeners.push(listener);
    const currentCfi = this.queue[this.currentIndex]?.cfi || null;
    setTimeout(() => {
        listener(this.status, currentCfi, this.currentIndex, this.queue, null);
    }, 0);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(activeCfi: string | null) {
      this.listeners.forEach(l => l(this.status, activeCfi, this.currentIndex, this.queue, null));
  }

  private notifyError(message: string) {
      this.listeners.forEach(l => l(this.status, this.queue[this.currentIndex]?.cfi || null, this.currentIndex, this.queue, message));
  }

  private notifyDownloadProgress(voiceId: string, percent: number, status: string) {
      this.listeners.forEach(l => l(this.status, this.queue[this.currentIndex]?.cfi || null, this.currentIndex, this.queue, null, { voiceId, percent, status }));
  }

  /**
   * OPTIONAL: Samsung Mitigation
   * Checks if the app is restricted and prompts the user.
   */
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
      try {
          const ttsContent = await dbService.getTTSContent(this.currentBookId, section.sectionId);

          // Determine Title
          let title = sectionTitle || `Section ${sectionIndex + 1}`;
          if (!sectionTitle) {
              const analysis = await dbService.getContentAnalysis(this.currentBookId, section.sectionId);
              if (analysis && analysis.structure.title) {
                  title = analysis.structure.title;
              }
          }

          const bookMetadata = await dbService.getBookMetadata(this.currentBookId);
          const newQueue: TTSQueueItem[] = [];

          if (ttsContent && ttsContent.sentences.length > 0) {
              // Dynamic Refinement: Merge segments based on current settings
              const settings = useTTSStore.getState();
              const refinedSentences = TextSegmenter.refineSegments(
                  ttsContent.sentences,
                  settings.customAbbreviations,
                  settings.alwaysMerge,
                  settings.sentenceStarters
              );

              // Add Preroll if enabled
              if (this.prerollEnabled) {
                  const prerollText = this.generatePreroll(title, Math.round(section.characterCount / 5), this.speed);
                  newQueue.push({
                      text: prerollText,
                      cfi: null,
                      isPreroll: true,
                      title: title,
                      bookTitle: bookMetadata?.title,
                      author: bookMetadata?.author
                  });
              }

              refinedSentences.forEach(s => {
                  newQueue.push({
                      text: s.text,
                      cfi: s.cfi,
                      title: title,
                      bookTitle: bookMetadata?.title,
                      author: bookMetadata?.author,
                      coverUrl: bookMetadata?.coverUrl
                  });
              });
          } else {
              // Empty Chapter Handling
              const randomMessage = NO_TEXT_MESSAGES[Math.floor(Math.random() * NO_TEXT_MESSAGES.length)];
              newQueue.push({
                  text: randomMessage,
                  cfi: null,
                  isPreroll: true,
                  title: title,
                  bookTitle: bookMetadata?.title,
                  author: bookMetadata?.author
              });
          }

          if (newQueue.length > 0) {
              if (autoPlay) {
                  this.provider.stop();
                  await this.savePlaybackState();
                  this.setStatus('loading');
              } else {
                  await this.stopInternal();
              }

              this.queue = newQueue;
              this.currentIndex = 0;
              this.currentSectionIndex = sectionIndex;
              this.lastPersistedQueue = null; // Reset persisted tracker on new section

              this.updateMediaSessionMetadata();
              this.notifyListeners(this.queue[this.currentIndex]?.cfi || null);
              this.persistQueue();

              if (autoPlay) {
                   await this.playInternal();
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

      let nextSectionIndex = this.currentSectionIndex + 1;

      if (this.currentSectionIndex === -1) nextSectionIndex = 0;

      while (nextSectionIndex < this.playlist.length) {
          const loaded = await this.loadSectionInternal(nextSectionIndex, true);
          if (loaded) return true;
          nextSectionIndex++;
      }
      return false;
  }
}

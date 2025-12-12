import type { ITTSProvider, TTSVoice } from './providers/types';
import { WebSpeechProvider, type WebSpeechConfig } from './providers/WebSpeechProvider';
import { Capacitor } from '@capacitor/core';
import { ForegroundService } from '@capawesome-team/capacitor-android-foreground-service';
import { BatteryOptimization } from '@capawesome-team/capacitor-android-battery-optimization';
import { CapacitorTTSProvider } from './providers/CapacitorTTSProvider';
import { SyncEngine, type AlignmentData } from './SyncEngine';
import { LexiconService } from './LexiconService';
import { MediaSessionManager } from './MediaSessionManager';
import { dbService } from '../../db/DBService';

interface OperationState {
    controller: AbortController;
    isCritical: boolean;
}

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

type PlaybackListener = (status: TTSStatus, activeCfi: string | null, currentIndex: number, queue: TTSQueueItem[], error: string | null) => void;

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

  private speed: number = 1.0;
  private voiceId: string | null = null;

  private currentBookId: string | null = null;
  private sessionRestored: boolean = false;
  private isPreviewing: boolean = false;

  private currentOperation: OperationState | null = null;
  private operationLock: Promise<void> = Promise.resolve();

  private localProviderConfig: WebSpeechConfig = { silentAudioType: 'silence', whiteNoiseVolume: 0.1 };

  private constructor() {
    this.syncEngine = new SyncEngine();

    if (Capacitor.isNativePlatform()) {
        this.provider = new CapacitorTTSProvider();
    } else {
        this.provider = new WebSpeechProvider(this.localProviderConfig);
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
        onSeekTo: (_details) => {
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

  private async executeWithLock(operation: (signal: AbortSignal) => Promise<void>, isCritical: boolean = false) {
      if (this.currentOperation) {
          if (!this.currentOperation.isCritical) {
              this.currentOperation.controller.abort();
          }
          this.currentOperation = null;
      }

      const controller = new AbortController();
      this.currentOperation = { controller, isCritical };
      const signal = controller.signal;

      const currentLock = this.operationLock;
      let resolveLock: () => void;
      this.operationLock = new Promise<void>((resolve) => {
          resolveLock = resolve;
      });

      try {
          await currentLock.catch(() => {});
          if (signal.aborted) {
              return;
          }
          await operation(signal);
      } finally {
          resolveLock!();
          if (this.currentOperation?.controller === controller) {
              this.currentOperation = null;
          }
      }
  }

  setBookId(bookId: string | null) {
      if (this.currentBookId !== bookId) {
          this.currentBookId = bookId;
          this.sessionRestored = false;
          if (bookId) {
              this.restoreQueue(bookId);
          } else {
              this.queue = [];
              this.currentIndex = 0;
              this.setStatus('stopped');
          }
      }
  }

  private async engageBackgroundMode(item: TTSQueueItem) {
      if (Capacitor.getPlatform() !== 'android') return;
      try {
          await ForegroundService.createNotificationChannel({
              id: 'versicle_tts_channel',
              name: 'Versicle Playback',
              description: 'Controls for background reading',
              importance: 3
          });
          await ForegroundService.startForegroundService({
              id: 1001,
              title: 'Versicle',
              body: `Reading: ${item.title || 'Chapter'}`,
              smallIcon: 'ic_stat_versicle',
              notificationChannelId: 'versicle_tts_channel',
              buttons: [{ id: 101, title: 'Pause' }]
          });
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
      } catch (e) {
          console.error('Background engagement failed', e);
      }
  }

  private async restoreQueue(bookId: string) {
      this.executeWithLock(async (signal) => {
          try {
              const state = await dbService.getTTSState(bookId);
              if (signal.aborted) return;
              if (this.currentBookId !== bookId) return;

              if (state && state.queue && state.queue.length > 0) {
                  await this.stopInternal();
                  this.queue = state.queue;
                  this.currentIndex = state.currentIndex || 0;
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
          }
      });
  }

  private updateMediaSessionMetadata() {
      if (this.queue[this.currentIndex]) {
          const item = this.queue[this.currentIndex];
          this.mediaSessionManager.setMetadata({
              title: item.title || 'Chapter Text',
              artist: item.author || 'Versicle',
              album: item.bookTitle || '',
              artwork: item.coverUrl ? [{ src: item.coverUrl }] : []
          });
      }
  }

  public setLocalProviderConfig(config: WebSpeechConfig) {
      this.localProviderConfig = config;
      if (this.provider instanceof WebSpeechProvider) {
          this.provider.setConfig(config);
      }
  }

  public setProvider(provider: ITTSProvider) {
      return this.executeWithLock(async () => {
        await this.stopInternal();
        this.provider = provider;
        // If web speech, set config
        if (this.provider instanceof WebSpeechProvider) {
             this.provider.setConfig(this.localProviderConfig);
        }
        this.setupProviderListeners();
      }, true);
  }

  async init() {
    await this.provider.init();
  }

  async getVoices(): Promise<TTSVoice[]> {
    return this.provider.getVoices();
  }

  public getQueue(): TTSQueueItem[] {
      return this.queue;
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
    return this.executeWithLock(async () => {
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

        this.updateMediaSessionMetadata();
        this.notifyListeners(this.queue[this.currentIndex]?.cfi || null);
        this.persistQueue();
    }, true);
  }

  private persistQueue() {
      if (this.currentBookId) {
          dbService.saveTTSState(this.currentBookId, this.queue, this.currentIndex);
      }
  }

  public generatePreroll(chapterTitle: string, wordCount: number, speed: number = 1.0): string {
      const WORDS_PER_MINUTE = 180;
      const adjustedWpm = WORDS_PER_MINUTE * speed;
      const minutes = Math.max(1, Math.round(wordCount / adjustedWpm));
      return `${chapterTitle}. Estimated reading time: ${minutes} minute${minutes === 1 ? '' : 's'}.`;
  }

  jumpTo(index: number) {
      return this.executeWithLock(async (signal) => {
          if (index >= 0 && index < this.queue.length) {
              await this.stopInternal();
              this.currentIndex = index;
              this.persistQueue();
              await this.playInternal(signal);
          }
      });
  }

  async preview(text: string): Promise<void> {
      return this.executeWithLock(async (signal) => {
        await this.stopInternal();
        this.isPreviewing = true;
        this.setStatus('playing');

        try {
            const voiceId = this.voiceId || '';

            await this.provider.play(text, {
                voiceId,
                speed: this.speed
            });

            if (signal.aborted) {
                this.provider.stop();
                return;
            }

        } catch (e) {
            if (signal.aborted) return;
            console.error("Preview error", e);
            this.setStatus('stopped');
            this.isPreviewing = false;
            this.notifyError(e instanceof Error ? e.message : "Preview error");
        }
      });
  }

  async play(): Promise<void> {
    return this.executeWithLock((signal) => this.playInternal(signal));
  }

  private async playInternal(signal: AbortSignal): Promise<void> {
    if (this.status === 'paused') {
        return this.resumeInternal(signal);
    }

    if (this.status === 'stopped' && this.currentBookId && !this.sessionRestored) {
        this.sessionRestored = true;
        try {
            const book = await dbService.getBookMetadata(this.currentBookId);
            if (signal.aborted) return;
            if (book) {
                if (book.lastPlayedCfi && this.currentIndex === 0) {
                     const index = this.queue.findIndex(item => item.cfi === book.lastPlayedCfi);
                     if (index >= 0) this.currentIndex = index;
                }
                if (book.lastPauseTime) return this.resumeInternal(signal);
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
        await this.engageBackgroundMode(item);
        this.setStatus('loading');
    }

    this.notifyListeners(item.cfi);
    this.updateMediaSessionMetadata();
    this.persistQueue();

    try {
        const voiceId = this.voiceId || '';
        const rules = await this.lexiconService.getRules(this.currentBookId || undefined);
        if (signal.aborted) return;

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
        if (signal.aborted) return;

        console.error("Play error", e);

        if (this.provider.id !== 'local') {
            const errorMessage = e instanceof Error ? e.message : "Cloud TTS error";
            this.notifyError(`Cloud voice failed (${errorMessage}). Switching to local backup.`);
            console.warn("Falling back to local provider...");

             await this.stopInternal();
            if (Capacitor.isNativePlatform()) {
                this.provider = new CapacitorTTSProvider();
            } else {
                this.provider = new WebSpeechProvider(this.localProviderConfig);
            }
            this.setupProviderListeners();
            await this.init();
            return this.playInternal(signal);
        }

        this.setStatus('stopped');
        this.notifyError(e instanceof Error ? e.message : "Playback error");
    }
  }

  async resume(): Promise<void> {
     return this.executeWithLock((signal) => this.resumeInternal(signal));
  }

  private async resumeInternal(signal: AbortSignal): Promise<void> {
     this.sessionRestored = true;

     if (this.status === 'paused') {
         this.provider.resume();
         this.setStatus('playing');
     } else {
         return this.playInternal(signal);
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
    return this.executeWithLock(async () => {
        this.provider.pause();
        this.setStatus('paused');
        await this.savePlaybackState();
    });
  }

  stop() {
      return this.executeWithLock(async () => {
          await this.stopInternal();
      });
  }

  private async stopInternal() {
    await this.savePlaybackState();
    if (Capacitor.isNativePlatform()) {
        try {
            await ForegroundService.stopForegroundService();
            await this.mediaSessionManager.setPlaybackState({ playbackState: 'none' });
        } catch (e) { console.warn(e); }
    }
    this.setStatus('stopped');
    this.notifyListeners(null);
    this.provider.stop();
  }

  next() {
      return this.executeWithLock(async (signal) => {
        if (this.currentIndex < this.queue.length - 1) {
            this.currentIndex++;
            this.persistQueue();
            await this.playInternal(signal);
        } else {
            await this.stopInternal();
        }
      });
  }

  prev() {
      return this.executeWithLock(async (signal) => {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.persistQueue();
            await this.playInternal(signal);
        }
      });
  }

  setSpeed(speed: number) {
      this.speed = speed;
      return this.executeWithLock(async (signal) => {
        if (this.status === 'playing') {
            await this.stopInternal();
            await this.playInternal(signal);
        }
      }, true);
  }

  seek(offset: number) {
      return this.executeWithLock(async (signal) => {
          if (offset > 0) {
              if (this.currentIndex < this.queue.length - 1) {
                  this.currentIndex++;
                  this.persistQueue();
                  await this.playInternal(signal);
              }
          } else {
              if (this.currentIndex > 0) {
                  this.currentIndex--;
                  this.persistQueue();
                  await this.playInternal(signal);
              }
          }
      });
  }

  setVoice(voiceId: string) {
      this.voiceId = voiceId;
      return this.executeWithLock(async (signal) => {
        if (this.status === 'playing') {
            await this.stopInternal();
            await this.playInternal(signal);
        }
      }, true);
  }

  private playNext() {
      this.executeWithLock(async (signal) => {
          if (this.status !== 'stopped') {
              if (this.currentIndex < this.queue.length - 1) {
                  this.currentIndex++;
                  this.persistQueue();
                  await this.playInternal(signal);
              } else {
                  this.setStatus('completed');
                  this.notifyListeners(null);
              }
          }
      });
  }

  private setStatus(status: TTSStatus) {
      if (this.status === 'stopped' && status === 'playing') {}
      else if (this.status === 'stopped' && status === 'loading') {}
      else if (this.status === 'loading' && status === 'playing') {}
      else if (this.status === 'loading' && status === 'stopped') {}
      else if (this.status === 'playing' && status === 'paused') {}
      else if (this.status === 'paused' && status === 'playing') {}
      else if (this.status === 'paused' && status === 'loading') {}
      else if (this.status === 'playing' && status === 'stopped') {}
      else if (this.status === 'paused' && status === 'stopped') {}
      else if (status === 'completed') {}
      else if (this.status === status) {}

      this.status = status;
      this.mediaSessionManager.setPlaybackState(
          status === 'playing' ? 'playing' : (status === 'paused' ? 'paused' : 'none')
      );

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

  /**
   * OPTIONAL: Samsung Mitigation
   * Checks if the app is restricted and prompts the user.
   */
  public async checkBatteryOptimization() {
      if (Capacitor.getPlatform() === 'android') {
          const isEnabled = await BatteryOptimization.isBatteryOptimizationEnabled();
          if (isEnabled.enabled) {
          }
      }
  }
}

import type { ITTSProvider, TTSVoice, SpeechSegment } from './providers/types';
import { WebSpeechProvider } from './providers/WebSpeechProvider';
import { AudioElementPlayer } from './AudioElementPlayer';
import { SyncEngine, type AlignmentData } from './SyncEngine';
import { TTSCache } from './TTSCache';
import { CostEstimator } from './CostEstimator';
import { LexiconService } from './LexiconService';
import { MediaSessionManager } from './MediaSessionManager';
import { dbService } from '../../db/DBService';
import { AsyncMutex } from '../utils/AsyncMutex';

export type TTSStatus = 'playing' | 'paused' | 'stopped' | 'loading' | 'completed';

export interface TTSQueueItem {
    text: string;
    cfi: string | null;
    title?: string;
    author?: string;
    bookTitle?: string;
    coverUrl?: string;
    isPreroll?: boolean;
}

type PlaybackListener = (status: TTSStatus, activeCfi: string | null, currentIndex: number, queue: TTSQueueItem[], error: string | null) => void;

export class AudioPlayerService {
  private static instance: AudioPlayerService;
  private provider: ITTSProvider;
  private audioPlayer: AudioElementPlayer | null = null;
  private syncEngine: SyncEngine | null = null;
  private mediaSessionManager: MediaSessionManager;
  private cache: TTSCache;
  private lexiconService: LexiconService;
  private queue: TTSQueueItem[] = [];
  private currentIndex: number = 0;
  private status: TTSStatus = 'stopped';
  private listeners: PlaybackListener[] = [];
  private mutex = new AsyncMutex();

  // Settings
  private speed: number = 1.0;
  private currentSpeechSpeed: number = 1.0;
  private voiceId: string | null = null;

  // State for current book context (to filter rules)
  private currentBookId: string | null = null;

  // Track if we have already attempted to restore session state for the current book
  private sessionRestored: boolean = false;

  // Silent audio for Media Session "anchoring" (Local TTS)
  private silentAudio: HTMLAudioElement;

  private constructor() {
    this.provider = new WebSpeechProvider();
    this.cache = new TTSCache();

    // Initialize silent audio loop to keep MediaSession active
    // 1 second of silence
    this.silentAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
    this.silentAudio.loop = true;
    this.lexiconService = LexiconService.getInstance();
    this.mediaSessionManager = new MediaSessionManager({
        onPlay: () => this.resume(),
        onPause: () => this.pause(),
        onStop: () => this.stop(),
        onPrev: () => this.prev(),
        onNext: () => this.next(),
        onSeekBackward: () => this.seek(-10),
        onSeekForward: () => this.seek(10),
        onSeekTo: (details) => {
            if (details.seekTime !== undefined && details.seekTime !== null) {
                this.seekFromMediaSession(details.seekTime);
            }
        },
    });
    this.setupWebSpeech();
  }

  private async seekFromMediaSession(time: number) {
      await this.mutex.runExclusive(async () => {
        if (this.audioPlayer) {
            this.audioPlayer.seek(time);
        } else {
             console.warn("SeekTo not supported for local TTS");
        }
      });
  }

  static getInstance(): AudioPlayerService {
    if (!AudioPlayerService.instance) {
      AudioPlayerService.instance = new AudioPlayerService();
    }
    return AudioPlayerService.instance;
  }

  /**
   * Sets the current book ID to allow loading book-specific lexicon rules.
   */
  setBookId(bookId: string | null) {
      if (this.currentBookId !== bookId) {
          this.currentBookId = bookId;
          this.sessionRestored = false; // Reset restoration flag for new book
      }
  }

  private setupWebSpeech() {
    if (this.provider instanceof WebSpeechProvider) {
       this.provider.on((event) => {
           if (event.type === 'start') {
               this.setStatus('playing');
               if (this.silentAudio.paused) {
                   this.silentAudio.play().catch(e => console.warn("Silent audio play failed", e));
               }
           } else if (event.type === 'end') {
               this.playNext();
           } else if (event.type === 'boundary') {
               // Future use
           } else if (event.type === 'error') {
               // eslint-disable-next-line @typescript-eslint/no-explicit-any
               const errorType = (event.error as any)?.error || event.error;
               if (errorType === 'interrupted' || errorType === 'canceled') {
                   return;
               }

               console.error("TTS Provider Error", event.error);
               this.setStatus('stopped');
               this.notifyError("Playback Error: " + (event.error?.message || "Unknown error"));
           }
       });
    }
  }

  private setupCloudPlayback() {
      if (!this.audioPlayer) {
          this.audioPlayer = new AudioElementPlayer();
          this.syncEngine = new SyncEngine();

          this.audioPlayer.setOnTimeUpdate((time) => {
              this.syncEngine?.updateTime(time);
              if (this.audioPlayer) {
                  this.mediaSessionManager.setPositionState({
                      duration: this.audioPlayer.getDuration() || 0,
                      playbackRate: this.speed,
                      position: time
                  });
              }
          });

          this.audioPlayer.setOnEnded(() => {
              this.playNext();
          });

          this.audioPlayer.setOnError((e) => {
              console.error("Audio Playback Error", e);
              this.setStatus('stopped');
              this.notifyError("Audio Playback Error: " + (e?.message || e || "Unknown error"));
          });

          this.syncEngine?.setOnHighlight(() => {
               // Currently no action needed
          });
      }
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

  public async setProvider(provider: ITTSProvider): Promise<void> {
      return this.mutex.runExclusive(() => this._setProvider(provider));
  }

  public async init(): Promise<void> {
    return this.mutex.runExclusive(async () => {
         await this.provider.init();
    });
  }

  public async getVoices(): Promise<TTSVoice[]> {
      return this.mutex.runExclusive(() => this.provider.getVoices());
  }

  public async setQueue(items: TTSQueueItem[], startIndex: number = 0): Promise<void> {
      return this.mutex.runExclusive(() => this._setQueue(items, startIndex));
  }

  public async play(): Promise<void> {
      return this.mutex.runExclusive(() => this._play());
  }

  public async pause(): Promise<void> {
      return this.mutex.runExclusive(() => this._pause());
  }

  public async resume(): Promise<void> {
      return this.mutex.runExclusive(() => this._resume());
  }

  public async stop(): Promise<void> {
      return this.mutex.runExclusive(() => this._stop());
  }

  public async next(): Promise<void> {
      return this.mutex.runExclusive(() => this._next());
  }

  public async prev(): Promise<void> {
      return this.mutex.runExclusive(() => this._prev());
  }

  public async jumpTo(index: number): Promise<void> {
      return this.mutex.runExclusive(() => this._jumpTo(index));
  }

  public async setSpeed(speed: number): Promise<void> {
      return this.mutex.runExclusive(() => this._setSpeed(speed));
  }

  public async setVoice(voiceId: string): Promise<void> {
      return this.mutex.runExclusive(() => this._setVoice(voiceId));
  }

  public async seek(offset: number): Promise<void> {
      return this.mutex.runExclusive(() => this._seek(offset));
  }

  private async _setProvider(provider: ITTSProvider) {
      await this._stop();
      this.provider = provider;
      if (provider instanceof WebSpeechProvider) {
          this.setupWebSpeech();
          this.audioPlayer = null;
      } else {
          this.setupCloudPlayback();
      }
  }

  private isQueueEqual(newItems: TTSQueueItem[]): boolean {
      if (this.queue.length !== newItems.length) return false;
      for (let i = 0; i < this.queue.length; i++) {
          if (this.queue[i].text !== newItems[i].text) return false;
          if (this.queue[i].cfi !== newItems[i].cfi) return false;
          if (this.queue[i].title !== newItems[i].title) return false;
      }
      return true;
  }

  private async _setQueue(items: TTSQueueItem[], startIndex: number = 0) {
    if (this.isQueueEqual(items)) {
        this.queue = items;
        return;
    }

    await this._stop();
    this.queue = items;
    this.currentIndex = startIndex;

    this.updateMediaSessionMetadata();
    this.notifyListeners(this.queue[this.currentIndex]?.cfi || null);
  }

  public generatePreroll(chapterTitle: string, wordCount: number, speed: number = 1.0): string {
      const WORDS_PER_MINUTE = 180;
      const adjustedWpm = WORDS_PER_MINUTE * speed;
      const minutes = Math.max(1, Math.round(wordCount / adjustedWpm));
      return `${chapterTitle}. Estimated reading time: ${minutes} minute${minutes === 1 ? '' : 's'}.`;
  }

  private async _jumpTo(index: number) {
      if (index >= 0 && index < this.queue.length) {
          await this._stop();
          this.currentIndex = index;
          await this._play();
      }
  }

  private async _play() {
    if (this.status === 'paused') {
        return this._resume();
    }

    if (this.status === 'stopped' && this.currentBookId && !this.sessionRestored) {
        this.sessionRestored = true;

        try {
            const book = await dbService.getBookMetadata(this.currentBookId);
            if (book) {
                if (book.lastPlayedCfi && this.currentIndex === 0) {
                     const index = this.queue.findIndex(item => item.cfi === book.lastPlayedCfi);
                     if (index >= 0) {
                         this.currentIndex = index;
                     }
                }
                if (book.lastPauseTime) {
                     return this._resume();
                }
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
        this.setStatus('loading');
    }

    this.notifyListeners(item.cfi);
    this.updateMediaSessionMetadata();

    try {
        const voiceId = this.voiceId || '';
        const rules = await this.lexiconService.getRules(this.currentBookId || undefined);
        const processedText = this.lexiconService.applyLexicon(item.text, rules);
        const lexiconHash = await this.lexiconService.getRulesHash(rules);

        if (this.provider instanceof WebSpeechProvider) {
             this.currentSpeechSpeed = this.speed;
             await this.provider.synthesize(processedText, voiceId, this.speed);
        } else {
             const cacheKey = await this.cache.generateKey(item.text, voiceId, this.speed, 1.0, lexiconHash);
             const cached = await this.cache.get(cacheKey);

             let result: SpeechSegment;

             if (cached) {
                 result = {
                     audio: new Blob([cached.audio], { type: 'audio/mp3' }),
                     alignment: cached.alignment,
                     isNative: false
                 };
             } else {
                 CostEstimator.getInstance().track(processedText);
                 result = await this.provider.synthesize(processedText, voiceId, this.speed);
                 if (result.audio) {
                     await this.cache.put(
                         cacheKey,
                         await result.audio.arrayBuffer(),
                         result.alignment
                     );
                 }
             }

             if (result.audio && this.audioPlayer) {
                 if (result.alignment && this.syncEngine) {
                     const alignmentData: AlignmentData[] = result.alignment.map(tp => ({
                         time: tp.timeSeconds,
                         textOffset: tp.charIndex,
                         type: (tp.type as 'word' | 'sentence') || 'word'
                     }));
                     this.syncEngine.loadAlignment(alignmentData);
                 }

                 this.audioPlayer.setRate(this.speed);
                 await this.audioPlayer.playBlob(result.audio);
                 this.setStatus('playing');
             }
        }
    } catch (e) {
        console.error("Play error", e);

        if (!(this.provider instanceof WebSpeechProvider)) {
            const errorMessage = e instanceof Error ? e.message : "Cloud TTS error";
            this.notifyError(`Cloud voice failed (${errorMessage}). Switching to local backup.`);

            console.warn("Falling back to WebSpeechProvider...");
            await this._setProvider(new WebSpeechProvider());
            await this.provider.init();

             setTimeout(() => {
                this.play();
            }, 500);
            return;
        }

        this.setStatus('stopped');
        this.notifyError(e instanceof Error ? e.message : "Playback error");
    }
  }

  private async _resume() {
     this.sessionRestored = true;
     let lastPauseTime: number | null = null;

     if (this.currentBookId) {
         try {
             const book = await dbService.getBookMetadata(this.currentBookId);
             if (book && book.lastPauseTime) {
                 lastPauseTime = book.lastPauseTime;
                 await dbService.updatePlaybackState(this.currentBookId, undefined, null);
             }
         } catch (e) {
             console.warn("Failed to fetch/clear lastPauseTime from DB", e);
         }
     }

     const now = Date.now();
     let elapsed = 0;
     if (lastPauseTime) {
         elapsed = now - lastPauseTime;
     }

     if (this.provider instanceof WebSpeechProvider) {
         if (elapsed > 5 * 60 * 1000) {
              const rewindAmount = elapsed > 24 * 60 * 60 * 1000 ? 5 : 2;
              const newIndex = Math.max(0, this.currentIndex - rewindAmount);

              if (newIndex !== this.currentIndex) {
                  this.currentIndex = newIndex;
                  this.setStatus('stopped');
                  return this._play();
              }
         }

         if (this.status === 'paused' && this.provider.resume && this.speed === this.currentSpeechSpeed) {
             this.provider.resume();
             this.setStatus('playing');
         } else {
             this.status = 'stopped';
             return this._play();
         }

     } else if (this.audioPlayer) {
          if (elapsed > 5 * 60 * 1000) {
              const rewindSeconds = elapsed > 24 * 60 * 60 * 1000 ? 60 : 10;
              const currentTime = this.audioPlayer.getCurrentTime();
              const newTime = Math.max(0, currentTime - rewindSeconds);
              this.audioPlayer.seek(newTime);
          }

          if (this.status === 'paused') {
             await this.audioPlayer.resume();
          } else {
              return this._play();
          }
          this.setStatus('playing');
     }
  }

  private async savePlaybackState() {
      if (!this.currentBookId) return;

      const currentItem = this.queue[this.currentIndex];
      const lastPlayedCfi = (currentItem && currentItem.cfi) ? currentItem.cfi : undefined;
      const isPaused = this.status === 'paused';
      const lastPauseTime = isPaused ? Date.now() : null;

      await dbService.updatePlaybackState(this.currentBookId, lastPlayedCfi, lastPauseTime);
  }

  private async _pause() {
    if (this.provider instanceof WebSpeechProvider && this.provider.pause) {
        this.provider.pause();
        this.silentAudio.pause();
    } else if (this.audioPlayer) {
        this.audioPlayer.pause();
    }

    this.setStatus('paused');
    await this.savePlaybackState();
  }

  private async _stop() {
    await this.savePlaybackState();

    this.setStatus('stopped');
    this.silentAudio.pause();
    this.silentAudio.currentTime = 0;
    this.notifyListeners(null);

    if (this.provider instanceof WebSpeechProvider && this.provider.stop) {
        this.provider.stop();
    } else if (this.audioPlayer) {
        this.audioPlayer.stop();
    }
  }

  private async _next() {
      if (this.currentIndex < this.queue.length - 1) {
          this.currentIndex++;
          await this._play();
      } else {
          await this._stop();
      }
  }

  private async _prev() {
      if (this.currentIndex > 0) {
          this.currentIndex--;
          await this._play();
      }
  }

  private async _setSpeed(speed: number) {
      this.speed = speed;
      if (this.status === 'playing') {
          if (this.audioPlayer) {
              this.audioPlayer.setRate(speed);
          } else {
              await this._play();
          }
      }
  }

  private async _seek(offset: number) {
      if (this.audioPlayer && this.status !== 'stopped') {
          const currentTime = this.audioPlayer.getCurrentTime();
          this.audioPlayer.seek(currentTime + offset);
      } else if (this.provider instanceof WebSpeechProvider) {
          if (offset > 0) {
              await this._next();
          } else {
              await this._prev();
          }
      }
  }

  private async _setVoice(voiceId: string) {
      this.voiceId = voiceId;
      if (this.status === 'playing') {
          await this._play();
      }
  }

  private async playNext() {
      return this.mutex.runExclusive(() => this._playNext());
  }

  private async _playNext() {
      if (this.status !== 'stopped') {
          if (this.currentIndex < this.queue.length - 1) {
              this.currentIndex++;
              await this._play();
          } else {
              this.setStatus('completed');
              this.notifyListeners(null);
          }
      }
  }

  private setStatus(status: TTSStatus) {
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
}

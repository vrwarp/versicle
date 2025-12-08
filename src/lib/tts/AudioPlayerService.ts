import type { ITTSProvider, TTSVoice, SpeechSegment } from './providers/types';
import { WebSpeechProvider, type WebSpeechConfig } from './providers/WebSpeechProvider';
import { AudioElementPlayer } from './AudioElementPlayer';
import { SyncEngine, type AlignmentData } from './SyncEngine';
import { TTSCache } from './TTSCache';
import { CostEstimator } from './CostEstimator';
import { LexiconService } from './LexiconService';
import { MediaSessionManager } from './MediaSessionManager';
import { dbService } from '../../db/DBService';

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

  // Settings
  private speed: number = 1.0;
  private currentSpeechSpeed: number = 1.0;
  private voiceId: string | null = null;

  // State for current book context (to filter rules)
  private currentBookId: string | null = null;

  // Track if we have already attempted to restore session state for the current book
  private sessionRestored: boolean = false;

  // Track if we are currently playing a preview (e.g. from Lexicon)
  private isPreviewing: boolean = false;

  // Concurrency Control
  private currentOperation: AbortController | null = null;
  private operationLock: Promise<void> = Promise.resolve();

  private localProviderConfig: WebSpeechConfig = { silentAudioType: 'silence', whiteNoiseVolume: 0.1 };

  private constructor() {
    this.provider = new WebSpeechProvider(this.localProviderConfig);
    this.cache = new TTSCache();

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
                if (this.audioPlayer) {
                    this.audioPlayer.seek(details.seekTime);
                } else {
                    // For WebSpeech, we can't seek to absolute time accurately.
                    // We could try to approximate by sentence index but it's risky.
                    console.warn("SeekTo not supported for local TTS");
                }
            }
        },
    });
    this.setupWebSpeech();
  }

  static getInstance(): AudioPlayerService {
    if (!AudioPlayerService.instance) {
      AudioPlayerService.instance = new AudioPlayerService();
    }
    return AudioPlayerService.instance;
  }

  /**
   * Helper to execute operations with Mutex/Locking and Cancellation.
   * Implements "Last Writer Wins":
   * 1. Aborts the current running operation.
   * 2. Waits for previous operations to clean up (lock).
   * 3. Starts the new operation with a fresh AbortSignal.
   */
  private async executeWithLock(operation: (signal: AbortSignal) => Promise<void>) {
      // 1. Abort current operation
      if (this.currentOperation) {
          this.currentOperation.abort();
          this.currentOperation = null;
      }

      // 2. Create new controller
      const controller = new AbortController();
      this.currentOperation = controller;
      const signal = controller.signal;

      // 3. Acquire lock (wait for previous to finish/cleanup)
      const currentLock = this.operationLock;
      let resolveLock: () => void;
      this.operationLock = new Promise<void>((resolve) => {
          resolveLock = resolve;
      });

      try {
          // Wait for previous operation to release lock
          await currentLock.catch(() => {});

          // Check if we were aborted while waiting
          if (signal.aborted) {
              return;
          }

          // Execute operation
          await operation(signal);
      } finally {
          // Release lock
          resolveLock!();
          // Clear currentOperation if it's still us
          if (this.currentOperation === controller) {
              this.currentOperation = null;
          }
      }
  }

  /**
   * Sets the current book ID to allow loading book-specific lexicon rules and restoring queue.
   */
  setBookId(bookId: string | null) {
      if (this.currentBookId !== bookId) {
          this.currentBookId = bookId;
          this.sessionRestored = false; // Reset restoration flag for new book
          if (bookId) {
              this.restoreQueue(bookId);
          } else {
              this.queue = [];
              this.currentIndex = 0;
              this.setStatus('stopped');
          }
      }
  }

  private async restoreQueue(bookId: string) {
      // Execute with lock to prevent race conditions with setQueue from useTTS
      this.executeWithLock(async (signal) => {
          try {
              const state = await dbService.getTTSState(bookId);
              if (signal.aborted) return;
              // Check if bookId still matches (async race)
              if (this.currentBookId !== bookId) return;

              if (state && state.queue && state.queue.length > 0) {
                  console.log("Restoring TTS queue from persistence", state.queue.length, "items");

                  // Stop any current playback if we are switching queue
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

  private setupWebSpeech() {
    if (this.provider.id === 'local') {
       // @ts-expect-error - WebSpeechProvider specific method
       this.provider.on((event) => {
           if (event.type === 'start') {
               this.setStatus('playing');
           } else if (event.type === 'end') {
               if (this.isPreviewing) {
                   this.isPreviewing = false;
                   this.setStatus('stopped');
                   return;
               }
               // Don't stop silent audio here, wait for playNext or stop
               this.playNext();
           } else if (event.type === 'boundary') {
               // We might use this for word-level sync in future
           } else if (event.type === 'error') {
               // Ignore 'interrupted' or 'canceled' errors as they are expected during navigation
               // eslint-disable-next-line @typescript-eslint/no-explicit-any
               const errorType = (event.error as any)?.error || event.error;
               if (errorType === 'interrupted' || errorType === 'canceled') {
                   // Do not stop, as this likely means we are just starting a new sentence
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
              if (this.isPreviewing) {
                  this.isPreviewing = false;
                  this.setStatus('stopped');
                  return;
              }
              this.playNext();
          });

          this.audioPlayer.setOnError((e) => {
              console.error("Audio Playback Error", e);
              this.setStatus('stopped');
              this.notifyError("Audio Playback Error: " + (e?.message || e || "Unknown error"));
          });

          this.syncEngine?.setOnHighlight(() => {
               // Currently no action needed if we assume sentence-level blobs.
               // We rely on queue index for active CFI.
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

  public setLocalProviderConfig(config: WebSpeechConfig) {
      this.localProviderConfig = config;
      if (this.provider instanceof WebSpeechProvider) {
          this.provider.setConfig(config);
      }
  }

  // Allow switching providers
  public setProvider(provider: ITTSProvider) {
      return this.executeWithLock(async () => {
        // Don't restart if it's the same provider type and instance logic,
        // but here we usually pass a new instance.
        await this.stopInternal();
        this.provider = provider;
        if (this.provider.id === 'local') {
            this.setupWebSpeech();
            // We can keep audioPlayer around or null it.
            // Nulling it saves memory.
            this.audioPlayer = null;
        } else {
            // Cloud provider
            this.setupCloudPlayback();
        }
      });
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
          // CFI Comparison: Allow nulls to match nulls
          if (this.queue[i].cfi !== newItems[i].cfi) return false;
          // Ignore title/author for equality check to prevent reload on minor metadata updates
          // unless we really need it.
      }
      return true;
  }

  setQueue(items: TTSQueueItem[], startIndex: number = 0) {
    return this.executeWithLock(async () => {
        // If the queue is effectively the same, we should update it (to catch metadata changes)
        // but NOT stop playback or reset the index, allowing for seamless continuation.
        if (this.isQueueEqual(items)) {
            // Queue text matches.
            // But maybe metadata (title) changed?
            // We update the queue object but KEEP currentIndex.
            this.queue = items;
            this.updateMediaSessionMetadata();
            this.notifyListeners(this.queue[this.currentIndex]?.cfi || null);
            this.persistQueue(); // Persist update
            return;
        }

        await this.stopInternal();
        this.queue = items;
        this.currentIndex = startIndex;

        this.updateMediaSessionMetadata();
        this.notifyListeners(this.queue[this.currentIndex]?.cfi || null);
        this.persistQueue();
    });
  }

  /**
   * Persists the current queue and playback index to the database.
   * This allows the application to restore the exact playback state (including the full queue)
   * on the next session, enabling "Instant Resume" without waiting for text extraction.
   *
   * This method delegates to DBService which handles debouncing to prevent excessive writes
   * during rapid navigation or playback.
   */
  private persistQueue() {
      if (this.currentBookId) {
          dbService.saveTTSState(this.currentBookId, this.queue, this.currentIndex);
      }
  }

  /**
   * Generates a pre-roll announcement text.
   */
  public generatePreroll(chapterTitle: string, wordCount: number, speed: number = 1.0): string {
      const WORDS_PER_MINUTE = 180; // Average reading speed
      // Adjust WPM by speed
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

  /**
   * Plays a standalone text segment for preview purposes (e.g. Lexicon testing).
   * Stops any current playback.
   */
  async preview(text: string): Promise<void> {
      return this.executeWithLock(async (signal) => {
        await this.stopInternal();
        this.isPreviewing = true;
        this.setStatus('playing');

        try {
            const voiceId = this.voiceId || '';

            if (this.provider.id === 'local') {
                this.currentSpeechSpeed = this.speed;
                await this.provider.synthesize(text, voiceId, this.speed, signal);
            } else {
                // Cloud provider flow (without caching for previews)
                CostEstimator.getInstance().track(text);

                const result = await this.provider.synthesize(text, voiceId, this.speed, signal);

                if (signal.aborted) return;

                if (result.audio && this.audioPlayer) {
                    this.audioPlayer.setRate(this.speed);
                    await this.audioPlayer.playBlob(result.audio);
                } else {
                    this.setStatus('stopped');
                    this.isPreviewing = false;
                }
            }
        } catch (e) {
            // If aborted, we don't need to notify error or change status (executeWithLock handles cleanup)
            if (signal.aborted) return;
            if (e instanceof Error && e.message === 'Aborted') return;

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

    // If stopped, we might want to resume from a saved state (Switch Book case)
    if (this.status === 'stopped' && this.currentBookId && !this.sessionRestored) {
        this.sessionRestored = true;

        try {
            const book = await dbService.getBookMetadata(this.currentBookId);
            if (signal.aborted) return;

            if (book) {
                // Restore Playback Position (lastPlayedCfi)
                if (book.lastPlayedCfi && this.currentIndex === 0) {
                     // If we have a queue, find the index.
                     // Queue should have been restored by now via setBookId -> restoreQueue
                     const index = this.queue.findIndex(item => item.cfi === book.lastPlayedCfi);
                     if (index >= 0) {
                         this.currentIndex = index;
                     }
                }

                if (book.lastPauseTime) {
                     return this.resumeInternal(signal);
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
    this.persistQueue(); // Update index in DB

    try {
        const voiceId = this.voiceId || '';

        const rules = await this.lexiconService.getRules(this.currentBookId || undefined);
        if (signal.aborted) return;

        const processedText = this.lexiconService.applyLexicon(item.text, rules);
        const lexiconHash = await this.lexiconService.getRulesHash(rules);

        if (this.provider.id === 'local') {
             this.currentSpeechSpeed = this.speed;
             await this.provider.synthesize(processedText, voiceId, this.speed, signal);
        } else {
             // Cloud provider flow with Caching
             const cacheKey = await this.cache.generateKey(item.text, voiceId, this.speed, 1.0, lexiconHash);
             const cached = await this.cache.get(cacheKey);
             if (signal.aborted) return;

             let result: SpeechSegment;

             if (cached) {
                 result = {
                     audio: new Blob([cached.audio], { type: 'audio/mp3' }),
                     alignment: cached.alignment,
                     isNative: false
                 };
             } else {
                 CostEstimator.getInstance().track(processedText);

                 result = await this.provider.synthesize(processedText, voiceId, this.speed, signal);
                 if (signal.aborted) return;

                 if (result.audio) {
                     await this.cache.put(
                         cacheKey,
                         await result.audio.arrayBuffer(),
                         result.alignment
                     );
                 }
             }

             if (result && result.audio && this.audioPlayer) {
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
        if (signal.aborted) return;
        if (e instanceof Error && e.message === 'Aborted') return;

        console.error("Play error", e);

        // Error Handling & Fallback logic
        if (this.provider.id !== 'local') {
            const errorMessage = e instanceof Error ? e.message : "Cloud TTS error";
            this.notifyError(`Cloud voice failed (${errorMessage}). Switching to local backup.`);

            console.warn("Falling back to WebSpeechProvider...");
            // We can't call setProvider() because it uses executeWithLock which waits for us!
            // Direct switch internal
            await this.stopInternal();
            this.provider = new WebSpeechProvider(this.localProviderConfig);
            this.setupWebSpeech();
            await this.init();

            // Retry playback
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

     // Smart Resume Logic
     let lastPauseTime: number | null = null;

     if (this.currentBookId) {
         try {
             const book = await dbService.getBookMetadata(this.currentBookId);
             if (signal.aborted) return;
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

     if (this.provider.id === 'local') {
         if (elapsed > 5 * 60 * 1000) { // 5 minutes
              const rewindAmount = elapsed > 24 * 60 * 60 * 1000 ? 5 : 2;
              const newIndex = Math.max(0, this.currentIndex - rewindAmount);

              if (newIndex !== this.currentIndex) {
                  this.currentIndex = newIndex;
                  this.persistQueue();
                  this.setStatus('stopped');
                  return this.playInternal(signal);
              }
         }

         if (this.status === 'paused' && this.provider.resume && this.speed === this.currentSpeechSpeed) {
             this.provider.resume();
             this.setStatus('playing');
         } else {
             this.status = 'stopped';
             return this.playInternal(signal);
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
              return this.playInternal(signal);
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

      try {
        await dbService.updatePlaybackState(this.currentBookId, lastPlayedCfi, lastPauseTime);
      } catch (e) {
          console.warn('Failed to save playback state', e);
      }
  }

  pause() {
    return this.executeWithLock(async () => {
        if (this.provider.id === 'local' && this.provider.pause) {
            this.provider.pause();
        } else if (this.audioPlayer) {
            this.audioPlayer.pause();
        }

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

    this.setStatus('stopped');
    this.notifyListeners(null);

    if (this.provider.id === 'local' && this.provider.stop) {
        this.provider.stop();
    } else if (this.audioPlayer) {
        this.audioPlayer.stop();
    }
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
            if (this.audioPlayer) {
                this.audioPlayer.setRate(speed);
            } else {
                await this.playInternal(signal);
            }
        }
      });
  }

  seek(offset: number) {
      return this.executeWithLock(async (signal) => {
          if (this.audioPlayer && this.status !== 'stopped') {
              const currentTime = this.audioPlayer.getCurrentTime();
              this.audioPlayer.seek(currentTime + offset);
          } else if (this.provider.id === 'local') {
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
          }
      });
  }

  setVoice(voiceId: string) {
      this.voiceId = voiceId;
      return this.executeWithLock(async (signal) => {
        if (this.status === 'playing') {
            await this.playInternal(signal);
        }
      });
  }

  private playNext() {
      // Logic triggers automatically by events.
      // We need to acquire lock for safety.
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
      // Strict State Machine Transitions
      if (this.status === 'stopped' && status === 'playing') {
          // Allowed: Stopped -> Playing
      } else if (this.status === 'stopped' && status === 'loading') {
          // Allowed: Stopped -> Loading
      } else if (this.status === 'loading' && status === 'playing') {
           // Allowed: Loading -> Playing
      } else if (this.status === 'loading' && status === 'stopped') {
           // Allowed: Loading -> Stopped (Cancel)
      } else if (this.status === 'playing' && status === 'paused') {
           // Allowed: Playing -> Paused
      } else if (this.status === 'paused' && status === 'playing') {
           // Allowed: Paused -> Playing
      } else if (this.status === 'paused' && status === 'loading') {
           // Allowed: Paused -> Loading (Resume rewinding)
      } else if (this.status === 'playing' && status === 'stopped') {
           // Allowed
      } else if (this.status === 'paused' && status === 'stopped') {
           // Allowed
      } else if (status === 'completed') {
           // Allowed
      } else if (this.status === status) {
          // No-op
      }

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

import type { ITTSProvider, TTSVoice, SpeechSegment } from './providers/types';
import { WebSpeechProvider } from './providers/WebSpeechProvider';
import { AudioElementPlayer } from './AudioElementPlayer';
import { SyncEngine, type AlignmentData } from './SyncEngine';
import { TTSCache } from './TTSCache';
import { CostEstimator } from './CostEstimator';
import { LexiconService } from './LexiconService';
import { MediaSessionManager } from './MediaSessionManager';
import { useTTSStore } from '../../store/useTTSStore';

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
   * Sets the current book ID to allow loading book-specific lexicon rules.
   */
  setBookId(bookId: string | null) {
      this.currentBookId = bookId;
  }

  private setupWebSpeech() {
    if (this.provider instanceof WebSpeechProvider) {
       this.provider.on((event) => {
           if (event.type === 'start') {
               this.setStatus('playing');
               // Ensure silent audio is playing to keep MediaSession active
               // Only play if not already playing to avoid audio artifacts/interruptions
               if (this.silentAudio.paused) {
                   this.silentAudio.play().catch(e => console.warn("Silent audio play failed", e));
               }
           } else if (event.type === 'end') {
               // Don't stop silent audio here, wait for playNext or stop
               this.playNext();
           } else if (event.type === 'boundary') {
               // We might use this for word-level sync in future
           } else if (event.type === 'error') {
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
               // Currently no action needed if we assume sentence-level blobs.
               // We rely on queue index for active CFI.
          });
      }

      // Note: MediaSession setup is now handled in the constructor via MediaSessionManager
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

  // Allow switching providers
  public setProvider(provider: ITTSProvider) {
      // Don't restart if it's the same provider type and instance logic,
      // but here we usually pass a new instance.
      this.stop();
      this.provider = provider;
      if (provider instanceof WebSpeechProvider) {
          this.setupWebSpeech();
          // We can keep audioPlayer around or null it.
          // Nulling it saves memory.
          this.audioPlayer = null;
      } else {
          // Cloud provider
          this.setupCloudPlayback();
      }
  }

  async init() {
    await this.provider.init();
  }

  async getVoices(): Promise<TTSVoice[]> {
    return this.provider.getVoices();
  }

  setQueue(items: TTSQueueItem[], startIndex: number = 0) {
    this.stop();
    this.queue = items;
    this.currentIndex = startIndex;

    this.updateMediaSessionMetadata();
    this.notifyListeners(this.queue[this.currentIndex]?.cfi || null);
  }

  /**
   * Generates a pre-roll announcement text.
   * "Chapter 5. The Wedding. Estimated reading time: 14 minutes."
   */
  public generatePreroll(chapterTitle: string, wordCount: number, speed: number = 1.0): string {
      const WORDS_PER_MINUTE = 180; // Average reading speed
      // Adjust WPM by speed
      const adjustedWpm = WORDS_PER_MINUTE * speed;
      const minutes = Math.max(1, Math.round(wordCount / adjustedWpm));

      return `${chapterTitle}. Estimated reading time: ${minutes} minute${minutes === 1 ? '' : 's'}.`;
  }

  jumpTo(index: number) {
      if (index >= 0 && index < this.queue.length) {
          this.stop();
          this.currentIndex = index;
          this.play();
      }
  }

  async play(): Promise<void> {
    if (this.status === 'paused') {
        return this.resume();
    }

    if (this.currentIndex >= this.queue.length) {
        this.setStatus('stopped');
        this.notifyListeners(null);
        return;
    }

    const item = this.queue[this.currentIndex];
    this.setStatus('loading');
    this.notifyListeners(item.cfi);
    this.updateMediaSessionMetadata();

    try {
        const voiceId = this.voiceId || '';

        // Retrieve and apply lexicon rules
        const rules = await this.lexiconService.getRules(this.currentBookId || undefined);
        const processedText = this.lexiconService.applyLexicon(item.text, rules);
        const lexiconHash = await this.lexiconService.getRulesHash(rules);

        if (this.provider instanceof WebSpeechProvider) {
             this.currentSpeechSpeed = this.speed;
             await this.provider.synthesize(processedText, voiceId, this.speed);
        } else {
             // Cloud provider flow with Caching
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
                 // Track cost before calling synthesis
                 // We only track when we actually hit the API (cache miss)
                 // Note: We track the ORIGINAL text length, not the processed one,
                 // as that's what the user sees, though technically we send processed text.
                 // Actually, cloud providers charge by input characters.
                 // If replacement is much longer, cost increases.
                 // Let's track processed text to be accurate.
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

        // Error Handling & Fallback logic
        if (!(this.provider instanceof WebSpeechProvider)) {
            const errorMessage = e instanceof Error ? e.message : "Cloud TTS error";
            this.notifyError(`Cloud voice failed (${errorMessage}). Switching to local backup.`);

            console.warn("Falling back to WebSpeechProvider...");
            this.setProvider(new WebSpeechProvider());
            // Retry playback with new provider
            await this.init();
            // Defer play to allow error state to propagate to UI (avoid batching)
            setTimeout(() => {
                this.play();
            }, 500);
            return;
        }

        this.setStatus('stopped');
        this.notifyError(e instanceof Error ? e.message : "Playback error");
    }
  }

  async resume(): Promise<void> {
     if (this.status === 'paused') {
        // Smart Resume Logic
        const ttsStore = useTTSStore.getState();
        const lastPauseTime = ttsStore ? ttsStore.lastPauseTime : null;
        const now = Date.now();
        let elapsed = 0;
        if (lastPauseTime) {
            elapsed = now - lastPauseTime;
        }

        // Reset pause time
        if (ttsStore) {
            ttsStore.setLastPauseTime(null);
        }

        if (this.provider instanceof WebSpeechProvider) {
            // Local provider: rewind by index
            if (elapsed > 5 * 60 * 1000) { // 5 minutes
                 // Rewind 2 sentences, clamp to 0
                 // Note: WebSpeech pause/resume is fragile. Often better to just restart segment if "rewind" needed.
                 // But strictly speaking, if we just call resume(), it continues where it left off.
                 // To rewind, we must modify currentIndex and call play().
                 const rewindAmount = elapsed > 24 * 60 * 60 * 1000 ? 5 : 2; // Rewind more if away for a day
                 const newIndex = Math.max(0, this.currentIndex - rewindAmount);

                 if (newIndex !== this.currentIndex) {
                     this.currentIndex = newIndex;
                     // Set status to stopped so play() starts fresh
                     this.setStatus('stopped');
                     return this.play();
                 }
            }

            if (this.provider.resume && this.speed === this.currentSpeechSpeed) {
                this.provider.resume();
                this.setStatus('playing');
            } else {
                // Force restart if speed changed or resume not supported
                this.status = 'stopped';
                return this.play();
            }

        } else if (this.audioPlayer) {
             // Cloud provider: rewind by time
             if (elapsed > 5 * 60 * 1000) {
                 const rewindSeconds = elapsed > 24 * 60 * 60 * 1000 ? 60 : 10;
                 const currentTime = this.audioPlayer.getCurrentTime();
                 const newTime = Math.max(0, currentTime - rewindSeconds);
                 this.audioPlayer.seek(newTime);
                 // Toast notification could go here if we had a way to trigger it from service
             }

             await this.audioPlayer.resume();
             this.setStatus('playing');
        }
     } else {
         this.play();
     }
  }

  pause() {
    if (this.provider instanceof WebSpeechProvider && this.provider.pause) {
        this.provider.pause();
        this.silentAudio.pause();
    } else if (this.audioPlayer) {
        this.audioPlayer.pause();
    }

    // Record pause time
    const ttsStore = useTTSStore.getState();
    if (ttsStore) {
        ttsStore.setLastPauseTime(Date.now());
    }

    this.setStatus('paused');
  }

  stop() {
    this.setStatus('stopped');
    this.silentAudio.pause();
    this.silentAudio.currentTime = 0;
    this.notifyListeners(null);

    // Clear pause time on stop (we don't smart resume from stop)
    const ttsStore = useTTSStore.getState();
    if (ttsStore) {
        ttsStore.setLastPauseTime(null);
    }

    if (this.provider instanceof WebSpeechProvider && this.provider.stop) {
        this.provider.stop();
    } else if (this.audioPlayer) {
        this.audioPlayer.stop();
    }
  }

  next() {
      if (this.currentIndex < this.queue.length - 1) {
          this.currentIndex++;
          this.play();
      } else {
          this.stop();
      }
  }

  prev() {
      if (this.currentIndex > 0) {
          this.currentIndex--;
          this.play();
      }
  }

  setSpeed(speed: number) {
      this.speed = speed;
      if (this.status === 'playing') {
          // Restart current to apply speed if needed, or update dynamically
          if (this.audioPlayer) {
              this.audioPlayer.setRate(speed);
          } else {
              // WebSpeech needs restart to change speed usually
              this.play();
          }
      }
  }

  seek(offset: number) {
      if (this.audioPlayer && this.status !== 'stopped') {
          const currentTime = this.audioPlayer.getCurrentTime();
          this.audioPlayer.seek(currentTime + offset);
      } else if (this.provider instanceof WebSpeechProvider) {
          if (offset > 0) {
              this.next();
          } else {
              this.prev();
          }
      }
  }

  setVoice(voiceId: string) {
      this.voiceId = voiceId;
      if (this.status === 'playing') {
          this.play();
      }
  }

  private playNext() {
      if (this.status !== 'stopped') {
          if (this.currentIndex < this.queue.length - 1) {
              this.currentIndex++;
              this.play();
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
    // Immediately notify with current state
    const currentCfi = this.queue[this.currentIndex]?.cfi || null;
    // Defer execution to avoid issues if called during store initialization
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

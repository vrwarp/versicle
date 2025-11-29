import type { ITTSProvider, TTSVoice, SpeechSegment } from './providers/types';
import { WebSpeechProvider } from './providers/WebSpeechProvider';
import { AudioElementPlayer } from './AudioElementPlayer';
import { SyncEngine, type AlignmentData } from './SyncEngine';
import { TTSCache } from './TTSCache';
import { CostEstimator } from './CostEstimator';

export type TTSStatus = 'playing' | 'paused' | 'stopped' | 'loading';

export interface TTSQueueItem {
    text: string;
    cfi: string;
    title?: string;
    author?: string;
    bookTitle?: string;
    coverUrl?: string;
}

type PlaybackListener = (status: TTSStatus, activeCfi: string | null, currentIndex: number, queue: TTSQueueItem[], error: string | null) => void;

export class AudioPlayerService {
  private static instance: AudioPlayerService;
  private provider: ITTSProvider;
  private audioPlayer: AudioElementPlayer | null = null;
  private syncEngine: SyncEngine | null = null;
  private cache: TTSCache;
  private queue: TTSQueueItem[] = [];
  private currentIndex: number = 0;
  private status: TTSStatus = 'stopped';
  private listeners: PlaybackListener[] = [];

  // Settings
  private speed: number = 1.0;
  private voiceId: string | null = null;
  // TODO: Add pitch if providers support it

  private constructor() {
    this.provider = new WebSpeechProvider();
    this.cache = new TTSCache();
    this.setupWebSpeech();
  }

  static getInstance(): AudioPlayerService {
    if (!AudioPlayerService.instance) {
      AudioPlayerService.instance = new AudioPlayerService();
    }
    return AudioPlayerService.instance;
  }

  private setupWebSpeech() {
    if (this.provider instanceof WebSpeechProvider) {
       this.provider.on((event) => {
           if (event.type === 'start') {
               this.setStatus('playing');
           } else if (event.type === 'end') {
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

      this.setupMediaSession();
  }

  private setupMediaSession() {
      if ('mediaSession' in navigator) {
          navigator.mediaSession.setActionHandler('play', () => {
              this.resume();
          });
          navigator.mediaSession.setActionHandler('pause', () => {
              this.pause();
          });
          navigator.mediaSession.setActionHandler('previoustrack', () => {
              this.prev();
          });
          navigator.mediaSession.setActionHandler('nexttrack', () => {
              this.next();
          });
          navigator.mediaSession.setActionHandler('stop', () => {
              this.stop();
          });
      }
  }

  private updateMediaSessionMetadata() {
      if ('mediaSession' in navigator && this.queue[this.currentIndex]) {
          const item = this.queue[this.currentIndex];
          navigator.mediaSession.metadata = new MediaMetadata({
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
    this.notifyListeners(this.queue[this.currentIndex]?.cfi || null);
  }

  jumpTo(index: number) {
      if (index >= 0 && index < this.queue.length) {
          this.stop();
          this.currentIndex = index;
          this.play();
      }
  }

  async play() {
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

        if (this.provider instanceof WebSpeechProvider) {
             await this.provider.synthesize(item.text, voiceId, this.speed);
        } else {
             // Cloud provider flow with Caching
             const cacheKey = await this.cache.generateKey(item.text, voiceId, this.speed);
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
                 CostEstimator.getInstance().track(item.text);

                 result = await this.provider.synthesize(item.text, voiceId, this.speed);
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
            // We need to wait a tick or ensure provider is ready?
            // WebSpeechProvider doesn't always need init() for basic usage if voices loaded,
            // but calling init() is safer.
            await this.init();
            // Also might want to unset specific voiceId if it was a cloud voice ID
            // or let the provider handle fallback.
            // For now, let's just retry.
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

  async resume() {
     if (this.status === 'paused') {
        if (this.provider instanceof WebSpeechProvider && this.provider.resume) {
             this.provider.resume();
             this.setStatus('playing');
        } else if (this.audioPlayer) {
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
    } else if (this.audioPlayer) {
        this.audioPlayer.pause();
    }
    this.setStatus('paused');
  }

  stop() {
    this.setStatus('stopped');
    this.notifyListeners(null);

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
              this.setStatus('stopped');
              this.notifyListeners(null);
          }
      }
  }

  private setStatus(status: TTSStatus) {
      this.status = status;
      if ('mediaSession' in navigator) {
         navigator.mediaSession.playbackState = (status === 'playing') ? 'playing' : (status === 'paused' ? 'paused' : 'none');
      }

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

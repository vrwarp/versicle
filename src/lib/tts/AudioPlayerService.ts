import { ITTSProvider, TTSVoice, SpeechSegment } from './providers/types';
import { WebSpeechProvider } from './providers/WebSpeechProvider';
import { AudioElementPlayer } from './AudioElementPlayer';
import { SyncEngine } from './SyncEngine';

export type TTSStatus = 'playing' | 'paused' | 'stopped' | 'loading';

type PlaybackListener = (status: TTSStatus, activeCfi: string | null) => void;

export class AudioPlayerService {
  private static instance: AudioPlayerService;
  private provider: ITTSProvider;
  private audioPlayer: AudioElementPlayer | null = null;
  private syncEngine: SyncEngine | null = null;
  private queue: { text: string; cfi: string; title?: string; author?: string; bookTitle?: string; coverUrl?: string }[] = [];
  private currentIndex: number = 0;
  private status: TTSStatus = 'stopped';
  private listeners: PlaybackListener[] = [];

  // Settings
  private speed: number = 1.0;
  private voiceId: string | null = null;

  private constructor() {
    this.provider = new WebSpeechProvider();
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
          });

          this.syncEngine?.setOnHighlight((index) => {
               // For now, Cloud playback is usually sentence-level blobs,
               // so the whole blob maps to the CFI in queue.
               // However, if we get word alignment, we might want to refine this.
               // But our queue is strictly sentence/paragraph CFIs.
               // So if we are playing queue[i], we are highlighting queue[i].cfi.

               // If the provider returned a LONG audio (like a whole chapter),
               // we would need this sync engine to tell us WHICH sentence we are in.
               // But currently our architecture seems to assume per-queue-item synthesis for now?
               // The design doc says: "Cloud engines return [{time: 0.5s, charIndex: 12}, ...]"
               // And "AudioElem -- 'ontimeupdate' --> SyncEngine -- 'Map to CFI' --> Epub".

               // If we are synthesizing smaller chunks (sentences), the SyncEngine is less critical for CFI switching,
               // unless we want word-level highlighting WITHIN the sentence.

               // Let's assume for now we just keep the current Item CFI active.
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
      this.stop();
      this.provider = provider;
      if (provider instanceof WebSpeechProvider) {
          this.setupWebSpeech();
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

  setQueue(items: { text: string; cfi: string; title?: string; author?: string; bookTitle?: string; coverUrl?: string }[], startIndex: number = 0) {
    this.stop();
    this.queue = items;
    this.currentIndex = startIndex;
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
             // Cloud provider flow
             const result: SpeechSegment = await this.provider.synthesize(item.text, voiceId, this.speed);

             if (result.audio && this.audioPlayer) {
                 if (result.alignment && this.syncEngine) {
                     this.syncEngine.loadAlignment(result.alignment);
                 }

                 this.audioPlayer.setRate(this.speed); // Apply speed to audio element
                 await this.audioPlayer.playBlob(result.audio);
                 this.setStatus('playing');
             }
        }
    } catch (e) {
        console.error("Play error", e);
        this.setStatus('stopped');
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
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(activeCfi: string | null) {
      this.listeners.forEach(l => l(this.status, activeCfi));
  }
}

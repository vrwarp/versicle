import { ITTSProvider, TTSVoice } from './providers/types';
import { WebSpeechProvider } from './providers/WebSpeechProvider';

export type TTSStatus = 'playing' | 'paused' | 'stopped' | 'loading';

type PlaybackListener = (status: TTSStatus, activeCfi: string | null) => void;

export class AudioPlayerService {
  private static instance: AudioPlayerService;
  private provider: ITTSProvider; // Currently only supports one active provider (WebSpeech)
  private queue: { text: string; cfi: string }[] = [];
  private currentIndex: number = 0;
  private status: TTSStatus = 'stopped';
  private listeners: PlaybackListener[] = [];

  // Settings
  private speed: number = 1.0;
  private voiceId: string | null = null;

  private constructor() {
    // Default to WebSpeechProvider
    this.provider = new WebSpeechProvider();

    // Bind provider events if it's WebSpeech
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

  static getInstance(): AudioPlayerService {
    if (!AudioPlayerService.instance) {
      AudioPlayerService.instance = new AudioPlayerService();
    }
    return AudioPlayerService.instance;
  }

  async init() {
    await this.provider.init();
  }

  async getVoices(): Promise<TTSVoice[]> {
    return this.provider.getVoices();
  }

  setQueue(items: { text: string; cfi: string }[], startIndex: number = 0) {
    this.stop(); // Stop current playback to avoid race conditions with onend
    this.queue = items;
    this.currentIndex = startIndex;
  }

  async play() {
    if (this.status === 'paused' && this.provider.resume) {
        this.provider.resume();
        this.setStatus('playing');
        return;
    }

    if (this.currentIndex >= this.queue.length) {
        this.setStatus('stopped');
        this.notifyListeners(null); // Clear highlight
        return;
    }

    const item = this.queue[this.currentIndex];
    this.setStatus('loading');
    this.notifyListeners(item.cfi); // Highlight immediately

    try {
        await this.provider.synthesize(
            item.text,
            this.voiceId || '',
            this.speed
        );
        // Status update to 'playing' handled by provider event 'start'
    } catch (e) {
        console.error("Play error", e);
        this.setStatus('stopped');
    }
  }

  pause() {
    if (this.provider.pause) {
        this.provider.pause();
        this.setStatus('paused');
    }
  }

  stop() {
    this.setStatus('stopped');
    this.notifyListeners(null);
    // Stop provider after setting status to prevent race condition where onEnd triggers playNext
    if (this.provider.stop) {
        this.provider.stop();
    }
  }

  next() {
      if (this.currentIndex < this.queue.length - 1) {
          this.currentIndex++;
          this.play(); // This will trigger synthesize for next item
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
      // If playing, we might need to restart current segment to apply speed?
      // WebSpeech allows dynamic rate change on new utterances only.
      if (this.status === 'playing') {
          // Restart current
          this.play();
      }
  }

  setVoice(voiceId: string) {
      this.voiceId = voiceId;
      if (this.status === 'playing') {
          this.play();
      }
  }

  // Private helpers
  private playNext() {
      // Logic to move to next item
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
      // Notify listeners of status change?
      // Current listeners mainly want Active CFI updates, but store needs status too.
      // We'll overload the listener or add a new one.
      // For now, let's assume the listener handles state sync.

      // Since `notifyListeners` sends CFI, how do we send status?
      // Let's change the listener signature.

      const currentCfi = (this.queue[this.currentIndex] && (status === 'playing' || status === 'loading' || status === 'paused'))
        ? this.queue[this.currentIndex].cfi
        : null;

      this.notifyListeners(currentCfi);
  }

  // Subscription for Store
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

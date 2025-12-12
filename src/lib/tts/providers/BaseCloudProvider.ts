import type { ITTSProvider, TTSOptions, TTSEvent, TTSVoice, Timepoint, SpeechSegment } from './types';
import { AudioElementPlayer } from '../AudioElementPlayer';
import { TTSCache } from '../TTSCache';
import { CostEstimator } from '../CostEstimator';

export abstract class BaseCloudProvider implements ITTSProvider {
  abstract id: string;
  protected voices: TTSVoice[] = [];
  protected audioPlayer: AudioElementPlayer;
  protected cache: TTSCache;
  protected eventListeners: ((event: TTSEvent) => void)[] = [];

  constructor() {
    this.audioPlayer = new AudioElementPlayer();
    this.cache = new TTSCache();
    this.setupAudioPlayer();
  }

  protected setupAudioPlayer() {
    this.audioPlayer.setOnTimeUpdate((time) => {
        this.emit({ type: 'timeupdate', currentTime: time, duration: this.audioPlayer.getDuration() });
    });
    this.audioPlayer.setOnEnded(() => {
        this.emit({ type: 'end' });
    });
    this.audioPlayer.setOnError((e) => {
        this.emit({ type: 'error', error: e });
    });
  }

  abstract init(): Promise<void>;

  async getVoices(): Promise<TTSVoice[]> {
    return this.voices;
  }

  async play(text: string, options: TTSOptions): Promise<void> {
    try {
        // 1. Check Cache
        // We use default pitch 1.0 and empty lexiconHash for now (assuming text is already processed)
        const cacheKey = await this.cache.generateKey(text, options.voiceId, options.speed, 1.0, '');
        const cached = await this.cache.get(cacheKey);

        let audioBlob: Blob;
        let alignment: Timepoint[] | undefined;

        if (cached) {
            audioBlob = new Blob([cached.audio], { type: 'audio/mp3' }); // Assuming mp3 or standard
            alignment = cached.alignment;
        } else {
            // 2. Cache Miss - Fetch
            CostEstimator.getInstance().track(text);
            const result = await this.fetchAudioData(text, options);
            if (!result.audio) {
                throw new Error("No audio returned from provider");
            }
            audioBlob = result.audio;
            alignment = result.alignment;

            // 3. Save to Cache
            await this.cache.put(cacheKey, await audioBlob.arrayBuffer(), alignment);
        }

        // 4. Emit Meta
        if (alignment) {
            this.emit({ type: 'meta', alignment });
        }

        // 5. Play
        this.audioPlayer.setRate(options.speed);
        // We need to wait for playback to START. playBlob returns a promise that resolves when it starts.
        await this.audioPlayer.playBlob(audioBlob);
        this.emit({ type: 'start' });

    } catch (e) {
        this.emit({ type: 'error', error: e });
        throw e;
    }
  }

  async preload(text: string, options: TTSOptions): Promise<void> {
      try {
          const cacheKey = await this.cache.generateKey(text, options.voiceId, options.speed, 1.0, '');
          const cached = await this.cache.get(cacheKey);
          if (!cached) {
             CostEstimator.getInstance().track(text);
             const result = await this.fetchAudioData(text, options);
             if (result.audio) {
                 await this.cache.put(cacheKey, await result.audio.arrayBuffer(), result.alignment);
             }
          }
      } catch (e) {
          console.warn("Preload failed", e);
      }
  }

  pause(): void {
      this.audioPlayer.pause();
  }

  resume(): void {
      this.audioPlayer.resume();
  }

  stop(): void {
      this.audioPlayer.stop();
  }

  on(callback: (event: TTSEvent) => void): void {
      this.eventListeners.push(callback);
  }

  protected emit(event: TTSEvent) {
      this.eventListeners.forEach(l => l(event));
  }

  /**
   * Abstract method for subclasses to implement the API call.
   */
  protected abstract fetchAudioData(text: string, options: TTSOptions): Promise<SpeechSegment>;

  /**
   * Helper method to perform a POST request and return the response as a Blob.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async fetchAudio(url: string, body: any, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<Blob> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(body),
      signal
    });

    if (!response.ok) {
      throw new Error(`TTS API Error: ${response.status} ${response.statusText}`);
    }

    return await response.blob();
  }
}

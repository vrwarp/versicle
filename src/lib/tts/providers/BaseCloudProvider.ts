import type { ITTSProvider, TTSOptions, TTSEvent, TTSVoice, SpeechSegment } from './types';
import type { IAudioPlayer } from '../IAudioPlayer';
import { TTSCache } from '../TTSCache';
import { CostEstimator } from '../CostEstimator';

export abstract class BaseCloudProvider implements ITTSProvider {
  abstract id: string;
  protected voices: TTSVoice[] = [];
  protected audioPlayer: IAudioPlayer;
  protected cache: TTSCache;
  protected eventListeners: ((event: TTSEvent) => void)[] = [];
  protected requestRegistry: Map<string, Promise<SpeechSegment>> = new Map();

  constructor(audioPlayer: IAudioPlayer) {
    this.audioPlayer = audioPlayer;
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
      const { audio, alignment } = await this.getOrFetch(text, options);

      // 4. Emit Meta
      if (alignment) {
        this.emit({ type: 'meta', alignment });
      }

      // 5. Play
      this.audioPlayer.setRate(options.speed);
      // We need to wait for playback to START. playBlob returns a promise that resolves when it starts.
      if (audio) {
        await this.audioPlayer.playBlob(audio);
      }
      this.emit({ type: 'start' });

    } catch (e) {
      this.emit({ type: 'error', error: e });
      throw e;
    }
  }

  async preload(text: string, options: TTSOptions): Promise<void> {
    try {
      await this.getOrFetch(text, options);
    } catch (e) {
      console.warn("Preload failed", e);
    }
  }

  protected async getOrFetch(text: string, options: TTSOptions): Promise<SpeechSegment> {
    const cacheKey = await this.cache.generateKey(text, options.voiceId, options.speed, 1.0, '');

    // 1. Permanent Cache Check
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return {
        audio: new Blob([cached.audio], { type: 'audio/mp3' }),
        alignment: cached.alignment,
        isNative: false
      };
    }

    // 2. Active Registry Check
    const existingPromise = this.requestRegistry.get(cacheKey);
    if (existingPromise) {
      return await existingPromise;
    }

    // 3. Initiate Fetch (Owner)
    // Only the owner tracks cost
    CostEstimator.getInstance().track(text);

    const fetchPromise = (async () => {
      try {
        const result = await this.fetchAudioData(text, options);
        if (!result.audio) {
          throw new Error("No audio returned from provider");
        }

        // Write to permanent cache
        await this.cache.put(cacheKey, await result.audio.arrayBuffer(), result.alignment);

        return result;
      } finally {
        // Cleanup registry
        this.requestRegistry.delete(cacheKey);
      }
    })();

    this.requestRegistry.set(cacheKey, fetchPromise);
    return await fetchPromise;
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

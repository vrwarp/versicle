import { toTTSErrorPayload } from './types';
import type { ITTSProvider, TTSOptions, TTSEvent, TTSVoice, SpeechSegment, Unsubscribe } from './types';
import { AudioElementPlayer } from '../AudioElementPlayer';
import type { AudioSink } from '../engine/AudioSink';
import { TTSCache } from '../TTSCache';

export abstract class BaseCloudProvider implements ITTSProvider {
  abstract id: string;
  protected voices: TTSVoice[] = [];
  protected audioPlayer: AudioSink;
  protected cache: TTSCache;
  protected eventListeners: ((event: TTSEvent) => void)[] = [];
  protected requestRegistry: Map<string, Promise<SpeechSegment>> = new Map();
  /** Whether the sink was injected (shared, manager-owned) or self-constructed. */
  private readonly ownsSink: boolean;
  private disposed = false;

  /**
   * @param audioSink The audio-output device. The manager injects ONE shared
   *   {@link AudioElementPlayer} so provider swaps reuse the same element; tests inject
   *   a `FakeAudioSink`. When absent (direct construction) the provider creates its own.
   * @param cache The synthesized-audio cache. Injectable so provider unit tests can use
   *   an in-memory fake instead of mocking the module (vi.mock is banned in providers/).
   */
  constructor(audioSink?: AudioSink, cache: TTSCache = new TTSCache()) {
    this.ownsSink = !audioSink;
    this.audioPlayer = audioSink ?? new AudioElementPlayer();
    this.cache = cache;
    this.setupAudioPlayer();
  }

  protected setupAudioPlayer() {
    this.audioPlayer.setOnTimeUpdate((time) => {
        this.emit({ type: 'timeupdate', currentTime: time, duration: this.audioPlayer.getDuration() });
    });
    this.audioPlayer.setOnEnded(() => {
        this.emit({ type: 'end' });
    });
    // Mid-playback sink errors (after play() resolved) — the one legitimate use of the
    // 'error' EVENT under the single-shot contract (failures to start reject instead).
    this.audioPlayer.setOnError((e) => {
        this.emit({
            type: 'error',
            error: { message: e ? `Media error ${e.code}${e.message ? `: ${e.message}` : ''}` : 'Media playback error' },
        });
    });
  }

  abstract init(): Promise<void>;

  async getVoices(): Promise<TTSVoice[]> {
    return this.voices;
  }

  async play(text: string, options: TTSOptions): Promise<void> {
    try {
      const { audio } = await this.getOrFetch(text, options);

      // We need to wait for playback to START. playBlob resolves when it starts.
      if (audio) {
        await this.audioPlayer.playBlob(audio);
      }
      // Speed policy: audio is always synthesized at 1.0; `options.speed` is a
      // playback-time rate applied at the sink AFTER the source is loaded, because the
      // media load algorithm resets `playbackRate` whenever a new src is assigned
      // (the sink also pins `defaultPlaybackRate` so later loads inherit the rate).
      this.audioPlayer.setRate(options.speed);
      this.emit({ type: 'start' });

    } catch (e) {
      // KNOWN double-signal (S2): emits AND rethrows for the same failure. Dies at
      // 5a-PR2 (single-shot contract: reject only) together with the manager's
      // event-path fallback — kept verbatim here so the registry PR stays
      // behavior-preserving.
      this.emit({ type: 'error', error: toTTSErrorPayload(e) });
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
    // The cache key is speed-independent: synthesis always happens at 1.0 and the
    // playback rate is applied at the sink, so one cached blob serves every speed.
    const cacheKey = await this.cache.generateKey(text, options.voiceId);

    // 1. Permanent Cache Check
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return {
        audio: new Blob([cached.audio], { type: 'audio/mp3' }),
        alignment: cached.alignment
      };
    }

    // 2. Active Registry Check
    const existingPromise = this.requestRegistry.get(cacheKey);
    if (existingPromise) {
      return await existingPromise;
    }

    // 3. Initiate Fetch (Owner)
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

  stop(): void {
      this.audioPlayer.stop();
  }

  on(callback: (event: TTSEvent) => void): Unsubscribe {
      this.eventListeners.push(callback);
      return () => {
          this.eventListeners = this.eventListeners.filter(l => l !== callback);
      };
  }

  /**
   * Detach listeners and stop playback. The shared sink is NOT destroyed unless this
   * provider constructed it for itself — sink lifecycle belongs to whoever injected it
   * (the manager). After dispose the provider emits nothing.
   */
  dispose(): void {
      if (this.disposed) return;
      this.disposed = true;
      this.audioPlayer.stop();
      this.eventListeners = [];
      this.requestRegistry.clear();
      if (this.ownsSink) {
          this.audioPlayer.destroy();
      }
  }

  protected emit(event: TTSEvent) {
      if (this.disposed) return;
      this.eventListeners.forEach(l => l(event));
  }

    public playEarcon(type: 'bookmark_captured' | 'bookmark_failed'): void {
        this.audioPlayer.playEarcon(type);
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

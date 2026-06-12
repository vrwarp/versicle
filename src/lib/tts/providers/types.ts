import type { Timepoint } from '~types/tts';

/**
 * Canonical home of {@link Timepoint} is src/types/tts.ts (Phase 1a type
 * split, layering-deps.md LD-1): types/db.ts (CacheAudioBlob.alignment)
 * needs it and the types layer may not import lib/tts. Re-exported here
 * (type-only, zero runtime change) so existing consumers keep compiling.
 */
export type { Timepoint } from '~types/tts';

/**
 * Represents a Text-to-Speech voice option.
 */
export interface TTSVoice {
  /** Unique identifier for the voice. */
  id: string;
  /** Display name of the voice. */
  name: string;
  /** Language code (e.g., 'en-US'). */
  lang: string;
  /** The provider that owns this voice ('local', 'google', 'openai', 'lemonfox', 'piper'). */
  provider: 'local' | 'google' | 'openai' | 'lemonfox' | 'piper';
}

/**
 * Represents the result of a synthesis operation.
 * @deprecated Used internally by cloud providers for fetchAudioData return.
 */
export interface SpeechSegment {
  /** The generated audio data (for cloud providers). */
  audio?: Blob;
  /** Alignment/timing data for synchronization (for cloud providers). */
  alignment?: Timepoint[];
}

export interface TTSOptions {
  voiceId: string;
  /**
   * Playback rate (1.0 = normal). This is strictly a *playback-time* parameter:
   * cloud providers always synthesize at 1.0 (it never appears in a synthesis
   * request body or the audio cache key) and the rate is applied at the audio sink.
   * Local providers (Web Speech / Capacitor) have no synthesized artifact, so they
   * pass it as the live speech rate at speak time — same semantics, no artifact.
   */
  speed: number;
}

/**
 * The typed error payload carried by `TTSEvent` 'error' events. Either a real
 * `Error` or a plain `{ message }` record (worker/Comlink-safe). Providers
 * normalize foreign rejection values through {@link toTTSErrorPayload}.
 */
export type TTSErrorPayload = Error | {
  message: string;
  /** Raw engine error code where one exists (e.g. SpeechSynthesis 'interrupted'). */
  error?: string;
  type?: string;
};

/** Normalize an unknown thrown/rejected value into a {@link TTSErrorPayload}. */
export function toTTSErrorPayload(e: unknown): TTSErrorPayload {
  if (e instanceof Error) return e;
  if (typeof e === 'object' && e !== null && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return e as { message: string };
  }
  return { message: String(e) };
}

export type TTSEvent =
  | { type: 'start' }
  | { type: 'end' }
  | { type: 'error'; error: TTSErrorPayload }
  | { type: 'timeupdate'; currentTime: number; duration: number }
  | { type: 'boundary'; charIndex: number }
  | { type: 'download-progress'; percent: number; status: string; voiceId: string };

/** Detach a listener registered with {@link ITTSProvider.on}. */
export type Unsubscribe = () => void;

/**
 * Interface that all TTS providers must implement.
 *
 * Narrowed at Phase 5a (phase5-tts-strangler.md §5a.1): dead `resume()`,
 * `SpeechSegment.isNative` and `TTSOptions.volume` are gone; `dispose()` and
 * unsubscribable `on()` are required (the manager detaches + disposes outgoing
 * providers on swap). Capability surfaces (voice download, locale) live in
 * `registry.ts` as descriptor-driven type guards, not optional methods here.
 */
export interface ITTSProvider {
  /** Unique identifier for the provider. */
  id: string;

  /**
   * Initializes the provider.
   * Loads available voices and performs any necessary setup (e.g., API key checks).
   *
   * @returns A Promise that resolves when initialization is complete.
   */
  init(): Promise<void>;

  /**
   * Retrieves the list of available voices.
   *
   * @returns A Promise resolving to an array of TTSVoice objects.
   */
  getVoices(): Promise<TTSVoice[]>;

  /**
   * Requests the provider to speak the given text.
   *
   * **Contract (single-shot failure signaling, pinned by `describeProviderContract`):**
   * - Resolves when audible playback has *started*.
   * - Rejects exactly once if playback fails to start.
   * - NEVER emits an `error` event for a failure it rejects — a failure surfaces
   *   through exactly one channel. `error` events are reserved for failures after
   *   playback started (mid-playback sink/engine errors).
   *
   * @param text The text to speak.
   * @param options Playback options (speed, voice).
   */
  play(text: string, options: TTSOptions): Promise<void>;

  /**
   * Hints to the provider that this text will be needed soon.
   * Must not start audible playback and must not emit lifecycle events.
   */
  preload(text: string, options: TTSOptions): Promise<void>;

  pause(): void;
  stop(): void;

  /**
   * Releases everything the provider holds: event listeners detach, in-flight work
   * is dropped, engine resources (workers, native listeners) are torn down. The
   * provider must not emit events after dispose. The shared {@link AudioSink} is
   * NOT destroyed — its lifecycle belongs to the manager that injected it.
   */
  dispose(): void;

  /** Register an event listener. Returns the unsubscribe function. */
  on(callback: (event: TTSEvent) => void): Unsubscribe;

  /**
   * Plays an earcon, automatically ducking the main audio if playing.
   */
  playEarcon?(type: 'bookmark_captured' | 'bookmark_failed'): void;
}

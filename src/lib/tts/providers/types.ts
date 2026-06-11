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
  /** Indicates if the provider handles playback natively (e.g., Web Speech API). */
  isNative: boolean;
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
  volume?: number;
}

export type TTSEvent =
  | { type: 'start' }
  | { type: 'end' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { type: 'error'; error: any }
  | { type: 'timeupdate'; currentTime: number; duration: number }
  | { type: 'boundary'; charIndex: number }
  | { type: 'download-progress'; percent: number; status: string; voiceId: string };

/**
 * Interface that all TTS providers must implement.
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
   * **Behavior:**
   * - **Cloud:** Checks cache, downloads if needed, then plays the audio blob.
   * - **Local:** Immediately triggers the native TTS engine.
   *
   * **Blocking:**
   * - Returns a Promise that resolves when playback *starts*.
   *
   * @param text The text to speak.
   * @param options Playback options (speed, voice).
   */
  play(text: string, options: TTSOptions): Promise<void>;

  /**
   * Hints to the provider that this text will be needed soon.
   */
  preload(text: string, options: TTSOptions): Promise<void>;

  pause(): void;
  resume(): void;
  stop(): void;

  on(callback: (event: TTSEvent) => void): void;

  /**
   * Plays an earcon, automatically ducking the main audio if playing.
   */
  playEarcon?(type: 'bookmark_captured' | 'bookmark_failed'): void;

  /**
   * Sets the locale for text segmentation and voice selection.
   */
  setLocale?(locale: string): void;
}

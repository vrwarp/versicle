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
  /** Optional reference to the original SpeechSynthesisVoice object (for local provider). */
  originalVoice?: SpeechSynthesisVoice;
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

/**
 * Represents a specific point in time within the synthesized audio.
 */
export interface Timepoint {
  /** Time in seconds from the start of the audio. */
  timeSeconds: number;
  /** Index of the character in the text corresponding to this time. */
  charIndex: number;
  /** The type of timepoint ('word', 'sentence', or 'mark'). */
  type?: string;
}

export interface TTSOptions {
  voiceId: string;
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
  | { type: 'meta'; alignment: Timepoint[] };

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
}

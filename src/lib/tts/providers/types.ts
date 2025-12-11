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
  /** The provider that owns this voice ('local', 'google', 'openai', 'lemonfox'). */
  provider: 'local' | 'google' | 'openai' | 'lemonfox';
  /** Optional reference to the original SpeechSynthesisVoice object (for local provider). */
  originalVoice?: SpeechSynthesisVoice;
}

/**
 * Represents the result of a synthesis operation.
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
   * Synthesizes text into speech.
   *
   * @param text - The text to synthesize.
   * @param voiceId - The ID of the voice to use.
   * @param speed - The playback speed (rate).
   * @param signal - Optional AbortSignal to cancel the operation.
   * @returns A Promise resolving to a SpeechSegment.
   */
  synthesize(text: string, voiceId: string, speed: number, signal?: AbortSignal): Promise<SpeechSegment>;

  /**
   * Optional: Cancels current synthesis or playback if handled natively.
   */
  stop?(): void;

  /**
   * Optional: Pauses playback if handled natively.
   */
  pause?(): void;

  /**
   * Optional: Resumes playback if handled natively.
   */
  resume?(): void;
}

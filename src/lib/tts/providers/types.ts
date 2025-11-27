export interface TTSVoice {
  id: string;
  name: string;
  lang: string;
  provider: 'local' | 'google' | 'openai';
  // Additional metadata specific to providers can go here
  originalVoice?: SpeechSynthesisVoice; // For local provider to keep reference
}

export interface SpeechSegment {
  // For cloud providers: the audio blob
  audio?: Blob;
  // For cloud providers: timestamp alignment data
  alignment?: Timepoint[];
  // If true, the provider handles playback internally (like Web Speech API)
  isNative: boolean;
}

export interface Timepoint {
  timeSeconds: number;
  charIndex: number;
  // 'word' or 'sentence'
  type?: string;
}

export interface ITTSProvider {
  /** Unique identifier for the provider */
  id: string;

  /** Initialize the provider (load voices, check API keys) */
  init(): Promise<void>;

  /** Get available voices */
  getVoices(): Promise<TTSVoice[]>;

  /**
   * Synthesize text.
   * - Cloud providers return a Blob and Alignment data.
   * - Local providers return a specialized flag or stream.
   */
  synthesize(text: string, voiceId: string, speed: number): Promise<SpeechSegment>;

  /**
   * Optional: Cancel current synthesis/playback if handled natively
   */
  stop?(): void;

  /**
   * Optional: Pause/Resume if handled natively
   */
  pause?(): void;
  resume?(): void;
}

import { BaseCloudProvider } from './BaseCloudProvider';
import type { SpeechSegment } from './types';

/**
 * TTS Provider for LemonFox.ai API.
 * Compatible with OpenAI API structure.
 */
export class LemonFoxProvider extends BaseCloudProvider {
  id = 'lemonfox';
  private apiKey: string | null = null;

  constructor(apiKey?: string) {
    super();
    if (apiKey) this.apiKey = apiKey;
    this.voices = [
      // English (US)
      { id: 'heart', name: 'Heart (US)', lang: 'en-US', provider: 'lemonfox' },
      { id: 'bella', name: 'Bella (US)', lang: 'en-US', provider: 'lemonfox' },
      { id: 'michael', name: 'Michael (US)', lang: 'en-US', provider: 'lemonfox' },
      { id: 'alloy', name: 'Alloy (US)', lang: 'en-US', provider: 'lemonfox' },
      { id: 'aoede', name: 'Aoede (US)', lang: 'en-US', provider: 'lemonfox' },
      { id: 'kore', name: 'Kore (US)', lang: 'en-US', provider: 'lemonfox' },
      { id: 'jessica', name: 'Jessica (US)', lang: 'en-US', provider: 'lemonfox' },
      { id: 'nicole', name: 'Nicole (US)', lang: 'en-US', provider: 'lemonfox' },
      { id: 'nova', name: 'Nova (US)', lang: 'en-US', provider: 'lemonfox' },
      { id: 'river', name: 'River (US)', lang: 'en-US', provider: 'lemonfox' },
      { id: 'sarah', name: 'Sarah (US)', lang: 'en-US', provider: 'lemonfox' },
      { id: 'sky', name: 'Sky (US)', lang: 'en-US', provider: 'lemonfox' },
      { id: 'echo', name: 'Echo (US)', lang: 'en-US', provider: 'lemonfox' },
      { id: 'eric', name: 'Eric (US)', lang: 'en-US', provider: 'lemonfox' },
      { id: 'fenrir', name: 'Fenrir (US)', lang: 'en-US', provider: 'lemonfox' },
      { id: 'liam', name: 'Liam (US)', lang: 'en-US', provider: 'lemonfox' },
      { id: 'onyx', name: 'Onyx (US)', lang: 'en-US', provider: 'lemonfox' },
      { id: 'puck', name: 'Puck (US)', lang: 'en-US', provider: 'lemonfox' },
      { id: 'adam', name: 'Adam (US)', lang: 'en-US', provider: 'lemonfox' },
      { id: 'santa', name: 'Santa (US)', lang: 'en-US', provider: 'lemonfox' },
      // English (UK)
      { id: 'alice', name: 'Alice (UK)', lang: 'en-GB', provider: 'lemonfox' },
      { id: 'emma', name: 'Emma (UK)', lang: 'en-GB', provider: 'lemonfox' },
      { id: 'isabella', name: 'Isabella (UK)', lang: 'en-GB', provider: 'lemonfox' },
      { id: 'lily', name: 'Lily (UK)', lang: 'en-GB', provider: 'lemonfox' },
      { id: 'daniel', name: 'Daniel (UK)', lang: 'en-GB', provider: 'lemonfox' },
      { id: 'fable', name: 'Fable (UK)', lang: 'en-GB', provider: 'lemonfox' },
      { id: 'george', name: 'George (UK)', lang: 'en-GB', provider: 'lemonfox' },
      { id: 'lewis', name: 'Lewis (UK)', lang: 'en-GB', provider: 'lemonfox' },
    ];
  }

  /**
   * Sets the API Key for LemonFox.
   *
   * @param key - The API Key.
   */
  setApiKey(key: string) {
    this.apiKey = key;
  }

  /**
   * Initializes the provider.
   * Voices are static, so this is effectively a no-op.
   */
  async init(): Promise<void> {
    // No init needed really, voices are static
  }

  /**
   * Synthesizes text using LemonFox API.
   *
   * @param text - The text to synthesize.
   * @param voiceId - The voice model name (e.g., 'heart').
   * @param speed - Speaking speed.
   * @param signal - Optional AbortSignal.
   */
  async synthesize(text: string, voiceId: string, speed: number, signal?: AbortSignal): Promise<SpeechSegment> {
    if (!this.apiKey) {
      throw new Error("LemonFox API Key missing");
    }

    const url = 'https://api.lemonfox.ai/v1/audio/speech';
    const body = {
      input: text,
      voice: voiceId,
      speed: speed,
      response_format: 'mp3'
    };

    const blob = await this.fetchAudio(url, body, {
      'Authorization': `Bearer ${this.apiKey}`
    }, signal);

    return {
      audio: blob,
      isNative: false,
      alignment: undefined
    };
  }
}

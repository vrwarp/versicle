import type { ITTSProvider, TTSVoice, SpeechSegment } from './types';

/**
 * TTS Provider for OpenAI's Audio API.
 * Uses models like 'tts-1' or 'tts-1-hd'.
 */
export class OpenAIProvider implements ITTSProvider {
  id = 'openai';
  private apiKey: string | null = null;
  private voices: TTSVoice[] = [
      { id: 'alloy', name: 'Alloy', lang: 'en', provider: 'openai' },
      { id: 'echo', name: 'Echo', lang: 'en', provider: 'openai' },
      { id: 'fable', name: 'Fable', lang: 'en', provider: 'openai' },
      { id: 'onyx', name: 'Onyx', lang: 'en', provider: 'openai' },
      { id: 'nova', name: 'Nova', lang: 'en', provider: 'openai' },
      { id: 'shimmer', name: 'Shimmer', lang: 'en', provider: 'openai' },
  ];

  constructor(apiKey?: string) {
      if (apiKey) this.apiKey = apiKey;
  }

  /**
   * Sets the API Key for OpenAI.
   *
   * @param key - The API Key.
   */
  setApiKey(key: string) {
      this.apiKey = key;
  }

  /**
   * Initializes the provider.
   * OpenAI voices are static, so this is effectively a no-op.
   */
  async init(): Promise<void> {
      // No init needed really, voices are static
  }

  /**
   * Returns the static list of OpenAI voices.
   */
  async getVoices(): Promise<TTSVoice[]> {
      return this.voices;
  }

  /**
   * Synthesizes text using OpenAI's API.
   * Note: OpenAI does not currently return alignment timestamps.
   *
   * @param text - The text to synthesize.
   * @param voiceId - The voice model name (e.g., 'alloy').
   * @param speed - Speaking speed.
   * @param signal - Optional AbortSignal.
   */
  async synthesize(text: string, voiceId: string, speed: number, signal?: AbortSignal): Promise<SpeechSegment> {
      if (!this.apiKey) {
          throw new Error("OpenAI API Key missing");
      }

      const url = `https://api.openai.com/v1/audio/speech`;
      const response = await fetch(url, {
          method: 'POST',
          headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json'
          },
          body: JSON.stringify({
              model: 'tts-1',
              input: text,
              voice: voiceId,
              speed: speed,
              response_format: 'mp3'
          }),
          signal
      });

      if (!response.ok) {
           const err = await response.text();
           throw new Error(`OpenAI TTS Error: ${response.status} ${err}`);
      }

      const blob = await response.blob();

      // OpenAI does not return timestamps
      return {
          audio: blob,
          isNative: false,
          alignment: undefined
      };
  }
}

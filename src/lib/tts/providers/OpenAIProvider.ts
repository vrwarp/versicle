import { BaseCloudProvider } from './BaseCloudProvider';
import type { TTSOptions, SpeechSegment } from './types';
import type { AudioSink } from '../engine/AudioSink';
import type { TTSCache } from '../TTSCache';

/**
 * TTS Provider for OpenAI's Audio API.
 * Uses models like 'tts-1' or 'tts-1-hd'.
 */
export class OpenAIProvider extends BaseCloudProvider {
  id = 'openai';
  private apiKey: string | null = null;

  constructor(apiKey?: string, audioSink?: AudioSink, cache?: TTSCache) {
      super(audioSink, cache);
      if (apiKey) this.apiKey = apiKey;
      this.voices = [
          { id: 'alloy', name: 'Alloy', lang: 'en', provider: 'openai' },
          { id: 'echo', name: 'Echo', lang: 'en', provider: 'openai' },
          { id: 'fable', name: 'Fable', lang: 'en', provider: 'openai' },
          { id: 'onyx', name: 'Onyx', lang: 'en', provider: 'openai' },
          { id: 'nova', name: 'Nova', lang: 'en', provider: 'openai' },
          { id: 'shimmer', name: 'Shimmer', lang: 'en', provider: 'openai' },
      ];
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
   * Synthesizes text using OpenAI's API.
   * Note: OpenAI does not currently return alignment timestamps.
   */
  protected async fetchAudioData(text: string, options: TTSOptions, signal?: AbortSignal): Promise<SpeechSegment> {
      if (!this.apiKey) {
          throw new Error("OpenAI API Key missing");
      }

      const url = `https://api.openai.com/v1/audio/speech`;

      // Speed policy: always synthesize at the provider default rate (1.0). The user's
      // playback speed is applied at the audio sink (see BaseCloudProvider.play), so
      // cached audio is speed-independent and never re-synthesized on a rate change.
      const blob = await this.fetchAudio(url, {
          model: 'tts-1',
          input: text,
          voice: options.voiceId,
          response_format: 'mp3'
      }, {
          'Authorization': `Bearer ${this.apiKey}`
      }, signal);

      // OpenAI does not return timestamps
      return {
          audio: blob,
          alignment: undefined
      };
  }
}

import type { ITTSProvider, TTSVoice, SpeechSegment } from './types';

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

  setApiKey(key: string) {
      this.apiKey = key;
  }

  async init(): Promise<void> {
      // No init needed really, voices are static
  }

  async getVoices(): Promise<TTSVoice[]> {
      return this.voices;
  }

  async synthesize(text: string, voiceId: string, speed: number): Promise<SpeechSegment> {
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
          })
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

import type { TTSVoice, SpeechSegment } from './types';
import { BaseCloudProvider } from './BaseCloudProvider';

export class OpenAIProvider extends BaseCloudProvider {
  id = 'openai';
  apiKey: string;

  constructor(apiKey: string) {
    super();
    this.apiKey = apiKey;
  }

  async init(): Promise<void> {
    // OpenAI doesn't need explicit init, but we could validate key
    if (!this.apiKey) throw new Error("OpenAI API Key missing");
  }

  async getVoices(): Promise<TTSVoice[]> {
    return [
      { id: 'alloy', name: 'Alloy', lang: 'en-US', provider: 'openai' },
      { id: 'echo', name: 'Echo', lang: 'en-US', provider: 'openai' },
      { id: 'fable', name: 'Fable', lang: 'en-US', provider: 'openai' },
      { id: 'onyx', name: 'Onyx', lang: 'en-US', provider: 'openai' },
      { id: 'nova', name: 'Nova', lang: 'en-US', provider: 'openai' },
      { id: 'shimmer', name: 'Shimmer', lang: 'en-US', provider: 'openai' },
    ];
  }

  async synthesize(text: string, voiceId: string, speed: number, signal?: AbortSignal): Promise<SpeechSegment> {
    const url = 'https://api.openai.com/v1/audio/speech';

    // OpenAI supports 0.25 to 4.0 speed
    const clampedSpeed = Math.max(0.25, Math.min(4.0, speed));

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
        speed: clampedSpeed,
        response_format: 'mp3'
      }),
      signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI TTS Error: ${response.status} ${errorText}`);
    }

    const blob = await response.blob();

    return {
      audio: blob,
      isNative: false,
      // OpenAI doesn't provide alignment data yet
      alignment: undefined
    };
  }
}

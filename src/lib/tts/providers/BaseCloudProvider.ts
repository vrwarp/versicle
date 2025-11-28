import { ITTSProvider, SpeechSegment, TTSVoice } from './types';

export abstract class BaseCloudProvider implements ITTSProvider {
  abstract id: string;
  protected voices: TTSVoice[] = [];

  abstract init(): Promise<void>;

  async getVoices(): Promise<TTSVoice[]> {
    return this.voices;
  }

  abstract synthesize(text: string, voiceId: string, speed: number): Promise<SpeechSegment>;

  protected async fetchAudio(url: string, body: any, headers: Record<string, string> = {}): Promise<Blob> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`TTS API Error: ${response.status} ${response.statusText}`);
    }

    return await response.blob();
  }
}

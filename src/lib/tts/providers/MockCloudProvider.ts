import type { ITTSProvider, TTSVoice, SpeechSegment } from './types';

export class MockCloudProvider implements ITTSProvider {
  id = 'mock-cloud';

  async init(): Promise<void> {
    return Promise.resolve();
  }

  async getVoices(): Promise<TTSVoice[]> {
    return [
      { id: 'mock-1', name: 'Mock Voice 1', lang: 'en-US', provider: 'google' },
      { id: 'mock-2', name: 'Mock Voice 2', lang: 'en-GB', provider: 'openai' }
    ];
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async synthesize(_text: string, _voiceId: string, _speed: number, _signal?: AbortSignal): Promise<SpeechSegment> {
    // Create a simple silent blob or a sine wave
    const blob = new Blob(['mock audio data'], { type: 'audio/mp3' });

    return {
      audio: blob,
      isNative: false,
      alignment: [
        { timeSeconds: 0, charIndex: 0, type: 'sentence' },
        { timeSeconds: 1, charIndex: 5, type: 'word' }
      ]
    };
  }
}

import { BaseCloudProvider } from './BaseCloudProvider';
import type { TTSOptions, SpeechSegment } from './types';

/**
 * A mock cloud provider for testing purposes.
 * Simulates cloud TTS behavior without making actual network requests.
 */
export class MockCloudProvider extends BaseCloudProvider {
  id = 'mock-cloud';

  constructor() {
    super();
    this.voices = [
      { id: 'mock-male', name: 'Mock Male (Cloud)', lang: 'en-US', provider: 'google' },
      { id: 'mock-female', name: 'Mock Female (Cloud)', lang: 'en-US', provider: 'openai' }
    ];
  }

  async init(): Promise<void> {
    // No-op
  }

  /**
   * Simulates synthesis by returning a dummy WAV blob and sentence alignment.
   */
  protected async fetchAudioData(_text: string, _options: TTSOptions): Promise<SpeechSegment> {
    // Dummy WAV blob
    const wavHeader = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00,
      0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20,
      0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
      0x44, 0xac, 0x00, 0x00, 0x88, 0x58, 0x01, 0x00,
      0x02, 0x00, 0x10, 0x00, 0x64, 0x61, 0x74, 0x61,
      0x00, 0x00, 0x00, 0x00
    ]);

    return {
      isNative: false,
      audio: new Blob([wavHeader], { type: 'audio/wav' }),
      alignment: [
        { timeSeconds: 0, charIndex: 0, type: 'sentence' }
      ]
    };
  }
}

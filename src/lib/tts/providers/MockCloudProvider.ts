import { BaseCloudProvider } from './BaseCloudProvider';
import { SpeechSegment } from './types';

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

  async synthesize(text: string, voiceId: string, speed: number): Promise<SpeechSegment> {
    // Create a dummy audio blob (1 second of silence or just valid header)
    // For testing without actual audio files, we can try to fetch a known small file
    // or construct a minimal WAV.
    // Constructing a minimal WAV blob:
    const wavHeader = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x24, 0x00, 0x00, 0x00, // ChunkSize
      0x57, 0x41, 0x56, 0x45, // WAVE
      0x66, 0x6d, 0x74, 0x20, // fmt
      0x10, 0x00, 0x00, 0x00, // Subchunk1Size (16)
      0x01, 0x00,             // AudioFormat (1 = PCM)
      0x01, 0x00,             // NumChannels (1)
      0x44, 0xac, 0x00, 0x00, // SampleRate (44100)
      0x88, 0x58, 0x01, 0x00, // ByteRate
      0x02, 0x00,             // BlockAlign
      0x10, 0x00,             // BitsPerSample (16)
      0x64, 0x61, 0x74, 0x61, // data
      0x00, 0x00, 0x00, 0x00  // Subchunk2Size (0 data)
    ]);

    // In a real mock we might want some duration.
    // But this is enough to verify the pipeline doesn't crash on "play".
    // Actually, browsers might reject 0-length audio.
    // Let's rely on a fetch to a dummy public file if possible, or just this.

    return {
      isNative: false,
      audio: new Blob([wavHeader], { type: 'audio/wav' }),
      alignment: [
        { timeSeconds: 0, charIndex: 0, type: 'sentence' }
      ]
    };
  }
}

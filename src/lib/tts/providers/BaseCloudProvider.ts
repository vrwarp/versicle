import type { ITTSProvider, TTSVoice, SpeechSegment } from './types';

export abstract class BaseCloudProvider implements ITTSProvider {
  abstract id: string;
  abstract apiKey: string;

  abstract init(): Promise<void>;
  abstract getVoices(): Promise<TTSVoice[]>;
  abstract synthesize(text: string, voiceId: string, speed: number, signal?: AbortSignal): Promise<SpeechSegment>;
}

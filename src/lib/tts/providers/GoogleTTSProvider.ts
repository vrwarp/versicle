import type { TTSVoice, SpeechSegment, Timepoint } from './types';
import { BaseCloudProvider } from './BaseCloudProvider';

interface GoogleTimepoint {
  markName: string;
  timeSeconds: number;
}

export class GoogleTTSProvider extends BaseCloudProvider {
  id = 'google';
  apiKey: string;

  constructor(apiKey: string) {
    super();
    this.apiKey = apiKey;
  }

  async init(): Promise<void> {
    if (!this.apiKey) throw new Error("Google API Key missing");
  }

  async getVoices(): Promise<TTSVoice[]> {
    // In a real app, we would fetch from https://texttospeech.googleapis.com/v1/voices
    // For now, hardcoding common ones to save API calls/startup time
    return [
      { id: 'en-US-Journey-F', name: 'Journey (F)', lang: 'en-US', provider: 'google' },
      { id: 'en-US-Journey-D', name: 'Journey (M)', lang: 'en-US', provider: 'google' },
      { id: 'en-US-Neural2-C', name: 'Neural2 (F)', lang: 'en-US', provider: 'google' },
      { id: 'en-US-Neural2-D', name: 'Neural2 (M)', lang: 'en-US', provider: 'google' },
      { id: 'en-US-Studio-O', name: 'Studio (F)', lang: 'en-US', provider: 'google' },
      { id: 'en-US-Studio-M', name: 'Studio (M)', lang: 'en-US', provider: 'google' },
      // Added some GB voices to demonstrate multi-lang support
      { id: 'en-GB-Neural2-A', name: 'UK Neural (F)', lang: 'en-GB', provider: 'google' },
      { id: 'en-GB-Neural2-B', name: 'UK Neural (M)', lang: 'en-GB', provider: 'google' },
    ];
  }

  private getLanguageCode(voiceId: string): string {
    // Basic heuristic: Extract lang code from voice ID (e.g., 'en-US-Journey-F' -> 'en-US')
    const parts = voiceId.split('-');
    if (parts.length >= 2) {
      return `${parts[0]}-${parts[1]}`;
    }
    return 'en-US';
  }

  async synthesize(text: string, voiceId: string, speed: number, signal?: AbortSignal): Promise<SpeechSegment> {
    const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${this.apiKey}`;
    const languageCode = this.getLanguageCode(voiceId);

    // Google TTS SSML logic for marks could go here if we used SSML input
    // But for plain text, we rely on enableTimepointing.

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input: { text }, // Plain text input
        voice: { name: voiceId, languageCode },
        audioConfig: {
            audioEncoding: 'MP3',
            speakingRate: speed
        },
        // Enable timepoints for word highlighting
        enableTimepointing: ["SSML_MARK"]
      }),
      signal
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google TTS Error: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    // Decode Audio
    const binaryString = atob(data.audioContent);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'audio/mp3' });

    // Parse Alignment (Timepoints)
    // Google returns "timepoints" array in the response if enabled
    let alignment: Timepoint[] | undefined = undefined;

    // Note: timepoints for plain text input usually correspond to SSML marks which we aren't injecting yet.
    // However, Neural voices often support automatic word timings if requested properly via SSML.
    // For now, we restore the structure to receive them if they exist.
    if (data.timepoints) {
        alignment = data.timepoints.map((tp: GoogleTimepoint) => ({
            timeSeconds: tp.timeSeconds,
            charIndex: 0, // Google marks don't always give char index for plain text easily without SSML
            type: 'mark'
        }));
    }

    return {
        audio: blob,
        isNative: false,
        alignment
    };
  }
}

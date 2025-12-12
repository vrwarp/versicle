import { BaseCloudProvider } from './BaseCloudProvider';
import type { TTSOptions, SpeechSegment, Timepoint } from './types';

/**
 * TTS Provider for Google Cloud Text-to-Speech API.
 * Requires a valid API Key.
 */
export class GoogleTTSProvider extends BaseCloudProvider {
  id = 'google';
  private apiKey: string | null = null;

  constructor(apiKey?: string) {
    super();
    if (apiKey) {
      this.apiKey = apiKey;
    }
  }

  /**
   * Sets the API Key for Google Cloud.
   *
   * @param key - The API Key.
   */
  setApiKey(key: string) {
      this.apiKey = key;
  }

  /**
   * Initializes the provider by fetching available voices.
   */
  async init(): Promise<void> {
    if (!this.apiKey) return;
    try {
      await this.fetchVoices();
    } catch (e) {
      console.error('Failed to init Google TTS:', e);
    }
  }

  /**
   * Returns the list of available Google TTS voices.
   */
  async getVoices() {
    if (this.voices.length === 0 && this.apiKey) {
      await this.fetchVoices();
    }
    return this.voices;
  }

  /**
   * Fetches voices from the Google Cloud API.
   */
  private async fetchVoices() {
      if (!this.apiKey) return;

      const response = await fetch(`https://texttospeech.googleapis.com/v1/voices`, {
          headers: {
              'X-Goog-Api-Key': this.apiKey
          }
      });
      if (!response.ok) {
          throw new Error(`Google TTS List Voices Error: ${response.statusText}`);
      }
      const data = await response.json();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.voices = (data.voices || []).map((v: any) => ({
          id: v.name, // Use name directly as ID (e.g., "en-US-Standard-A")
          name: `${v.name} (${v.ssmlGender})`,
          lang: v.languageCodes[0],
          provider: 'google',
          originalVoice: v
      }));
  }

  protected async fetchAudioData(text: string, options: TTSOptions): Promise<SpeechSegment> {
    if (!this.apiKey) {
      throw new Error('Google Cloud API Key is missing');
    }

    const url = `https://texttospeech.googleapis.com/v1/text:synthesize`;

    const requestBody = {
      input: { text },
      voice: { name: options.voiceId, languageCode: options.voiceId.split('-').slice(0, 2).join('-') },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: options.speed,
      },
      enableTimepointing: ["SSML_MARK"]
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Google TTS Synthesis Error: ${response.status} ${err}`);
    }

    const data = await response.json();

    // Decode base64 audio
    const audioContent = data.audioContent;
    const binaryString = window.atob(audioContent);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'audio/mp3' });

    // Parse timepoints if any
    let alignment: Timepoint[] | undefined = undefined;
    if (data.timepoints) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        alignment = data.timepoints.map((tp: any) => ({
            timeSeconds: tp.timeSeconds,
            charIndex: 0,
            type: 'mark'
        }));
    }

    return {
      audio: blob,
      alignment,
      isNative: false
    };
  }
}

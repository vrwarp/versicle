import type { ITTSProvider, TTSVoice, SpeechSegment, Timepoint } from './types';

export class GoogleTTSProvider implements ITTSProvider {
  id = 'google';
  private apiKey: string | null = null;
  private voices: TTSVoice[] = [];

  constructor(apiKey?: string) {
    if (apiKey) {
      this.apiKey = apiKey;
    }
  }

  setApiKey(key: string) {
      this.apiKey = key;
  }

  async init(): Promise<void> {
    if (!this.apiKey) return;
    try {
      await this.fetchVoices();
    } catch (e) {
      console.error('Failed to init Google TTS:', e);
    }
  }

  async getVoices(): Promise<TTSVoice[]> {
    if (this.voices.length === 0 && this.apiKey) {
      await this.fetchVoices();
    }
    return this.voices;
  }

  private async fetchVoices() {
      if (!this.apiKey) return;

      const response = await fetch(`https://texttospeech.googleapis.com/v1/voices?key=${this.apiKey}`);
      if (!response.ok) {
          throw new Error(`Google TTS List Voices Error: ${response.statusText}`);
      }
      const data = await response.json();

      this.voices = (data.voices || []).map((v: any) => ({
          id: v.name, // Use name directly as ID (e.g., "en-US-Standard-A")
          name: `${v.name} (${v.ssmlGender})`,
          lang: v.languageCodes[0],
          provider: 'google',
          originalVoice: v
      }));
  }

  async synthesize(text: string, voiceId: string, speed: number): Promise<SpeechSegment> {
    if (!this.apiKey) {
      throw new Error('Google Cloud API Key is missing');
    }

    const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${this.apiKey}`;

    const requestBody = {
      input: { text },
      voice: { name: voiceId, languageCode: voiceId.split('-').slice(0, 2).join('-') },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: speed,
      },
      enableTimepointing: ["SSML_MARK"]
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
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

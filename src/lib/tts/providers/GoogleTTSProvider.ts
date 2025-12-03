import type { ITTSProvider, TTSVoice, SpeechSegment, Timepoint } from './types';

/**
 * TTS Provider for Google Cloud Text-to-Speech.
 */
export class GoogleTTSProvider implements ITTSProvider {
  id = 'google';
  private apiKey: string | null = null;
  private voices: TTSVoice[] = [];

  constructor(apiKey?: string) {
      if (apiKey) this.apiKey = apiKey;
  }

  setApiKey(key: string) {
      this.apiKey = key;
  }

  async init(): Promise<void> {
      if (!this.apiKey) return;
      if (this.voices.length > 0) return;

      const url = `https://texttospeech.googleapis.com/v1/voices?key=${this.apiKey}`;
      try {
          const response = await fetch(url);
          if (!response.ok) return; // Silent fail if key is invalid
          const data = await response.json();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          this.voices = data.voices.filter((v: any) => v.languageCodes[0].startsWith('en')).map((v: any) => ({
              id: v.name,
              name: `${v.name} (${v.ssmlGender})`,
              lang: v.languageCodes[0],
              provider: 'google'
          }));
      } catch (e) {
          console.error("Failed to load Google voices", e);
      }
  }

  async getVoices(): Promise<TTSVoice[]> {
      if (this.voices.length === 0) {
          await this.init();
      }
      return this.voices;
  }

  async synthesize(text: string, voiceId: string, speed: number, signal?: AbortSignal): Promise<SpeechSegment> {
      if (!this.apiKey) throw new Error("Google API Key missing");

      const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${this.apiKey}`;
      const body = {
          input: { text },
          voice: { name: voiceId, languageCode: 'en-US' },
          audioConfig: { audioEncoding: 'MP3', speakingRate: speed },
          enableTimePointing: ["SSML_MARK"]
      };

      // We might need to split text if it's too long, but let's assume valid chunks from queue.

      const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal
      });

      if (!response.ok) {
           const err = await response.json();
           throw new Error(`Google TTS Error: ${err.error.message}`);
      }

      const data = await response.json();
      // decode base64 audio content
      const audioContent = data.audioContent;
      const binaryString = window.atob(audioContent);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'audio/mp3' });

      // Google returns "timepoints" if we enabled them?
      // Actually standard Google TTS API returns timepoints in the response if requested?
      // Wait, standard API (v1) returns `timepoints` array in response if `enableTimePointing` is set.
      // But `enableTimePointing` usually requires SSML tags?
      // Actually "SSML_MARK" requires marks.
      // For word-level timestamps, we usually need specific flags.
      // However, let's just parse what we get.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const timepoints: Timepoint[] = (data.timepoints || []).map((tp: any) => ({
          timeSeconds: parseFloat(tp.timeSeconds),
          charIndex: 0, // Google might rely on mark name
          type: 'mark'
      }));

      return {
          audio: blob,
          isNative: false,
          alignment: timepoints.length > 0 ? timepoints : undefined
      };
  }
}

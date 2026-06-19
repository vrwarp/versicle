import { egress, retryAfterMs } from '@kernel/net';
import { BaseCloudProvider, estTtsTokens, ttsGovernor } from './BaseCloudProvider';
import type { TTSOptions, SpeechSegment, Timepoint } from './types';
import type { AudioSink } from '../engine/AudioSink';
import type { TTSCache } from '../TTSCache';

function getGoogleTtsPool(voiceId: string): string {
  const lower = voiceId.toLowerCase();
  if (lower.includes('chirp3-hd') || lower.includes('chirp-hd') || lower.includes('chirp3')) {
    return 'google-tts-chirp3-hd';
  }
  if (lower.includes('studio')) {
    return 'google-tts-studio';
  }
  if (lower.includes('wavenet')) {
    return 'google-tts-wavenet';
  }
  if (lower.includes('neural2') || lower.includes('neural-2')) {
    return 'google-tts-neural2';
  }
  if (lower.includes('polyglot')) {
    return 'google-tts-polyglot';
  }
  if (lower.includes('standard')) {
    return 'google-tts-standard';
  }
  if (lower.includes('custom')) {
    return 'google-tts-custom';
  }
  return 'google-tts';
}

/**
 * TTS Provider for Google Cloud Text-to-Speech API.
 * Requires a valid API Key.
 */
export class GoogleTTSProvider extends BaseCloudProvider {
  id = 'google';
  private apiKey: string | null = null;

  constructor(apiKey?: string, audioSink?: AudioSink, cache?: TTSCache) {
    super(audioSink, cache);
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

      const response = await egress('google-tts', `https://texttospeech.googleapis.com/v1/voices`, {
          headers: {
              'X-Goog-Api-Key': this.apiKey
          }
      });
      if (!response.ok) {
          throw new Error(`Google TTS List Voices Error: ${response.statusText}`);
      }
      const data = await response.json();

      this.voices = (data.voices || []).map((v: { name: string; ssmlGender: string; languageCodes: string[] }) => ({
          id: v.name, // Use name directly as ID (e.g., "en-US-Standard-A")
          name: `${v.name} (${v.ssmlGender})`,
          lang: v.languageCodes[0],
          provider: 'google'
      }));
  }

  protected async fetchAudioData(text: string, options: TTSOptions, signal?: AbortSignal): Promise<SpeechSegment> {
    if (!this.apiKey) {
      throw new Error('Google Cloud API Key is missing');
    }

    const url = `https://texttospeech.googleapis.com/v1beta1/text:synthesize`;

    // Speed policy: always synthesize at the provider default rate (1.0). The user's
    // playback speed is applied at the audio sink (see BaseCloudProvider.play), so
    // cached audio is speed-independent and never re-synthesized on a rate change.
    const requestBody = {
      input: { text },
      voice: { name: options.voiceId, languageCode: options.voiceId.split('-').slice(0, 2).join('-') },
      audioConfig: {
        audioEncoding: 'MP3',
      },
      enableTimePointing: ["SSML_MARK"]
    };

    const payload = JSON.stringify(requestBody);
    const estimate = estTtsTokens(payload);
    const ratePool = getGoogleTtsPool(options.voiceId);

    const response = await egress(
      'google-tts',
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey
        },
        body: payload,
        signal
      },
      { lane: 'fg', estTokens: estimate, ratePool }
    );

    if (!response.ok) {
      if (response.status === 429) {
        ttsGovernor?.recordCooldown(retryAfterMs(response, 30_000), ratePool);
      }
      const err = await response.text();
      throw new Error(`Google TTS Synthesis Error: ${response.status} ${err}`);
    }

    ttsGovernor?.commit('fg', estimate, ratePool);
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
        alignment = data.timepoints.map((tp: { timeSeconds: number }) => ({
            timeSeconds: tp.timeSeconds,
            charIndex: 0,
            type: 'mark'
        }));
    }

    return {
      audio: blob,
      alignment
    };
  }
}

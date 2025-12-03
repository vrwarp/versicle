import type { ITTSProvider, SpeechSegment, TTSVoice } from './types';

/**
 * Abstract base class for Cloud TTS providers.
 * Handles common logic like fetching audio blobs from a URL.
 */
export abstract class BaseCloudProvider implements ITTSProvider {
  abstract id: string;
  protected voices: TTSVoice[] = [];

  abstract init(): Promise<void>;

  /**
   * Returns the cached list of voices for this provider.
   */
  async getVoices(): Promise<TTSVoice[]> {
    return this.voices;
  }

  abstract synthesize(text: string, voiceId: string, speed: number, signal?: AbortSignal): Promise<SpeechSegment>;

  /**
   * Helper method to perform a POST request and return the response as a Blob.
   *
   * @param url - The API endpoint URL.
   * @param body - The JSON body of the request.
   * @param headers - Optional additional headers.
   * @param signal - Optional AbortSignal.
   * @returns A Promise resolving to the audio Blob.
   * @throws Error if the fetch request fails.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async fetchAudio(url: string, body: any, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<Blob> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(body),
      signal
    });

    if (!response.ok) {
      throw new Error(`TTS API Error: ${response.status} ${response.statusText}`);
    }

    return await response.blob();
  }
}

import { TextToSpeech } from '@capacitor-community/text-to-speech';
import type { ITTSProvider, SpeechSegment, TTSVoice } from './types';

// Callback type matching WebSpeechProvider's expected signature
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TTSCallback = (event: { type: 'start' | 'end' | 'boundary' | 'error', charIndex?: number, error?: any }) => void;

export class CapacitorTTSProvider implements ITTSProvider {
  // We use the ID 'local' so this provider naturally replaces the WebSpeechProvider
  // in the selection logic when running on a device.
  id = 'local';
  private voiceMap = new Map<string, TTSVoice>();
  private callback: TTSCallback | null = null;

  async init(): Promise<void> {
    // Native plugins generally initialize lazily, but we could check
    // for specific engine availability here if needed.
    // We can pre-fetch voices here to populate the map early
    await this.getVoices();
  }

  async getVoices(): Promise<TTSVoice[]> {
    try {
      const { voices } = await TextToSpeech.getSupportedVoices();
      // Map the native voice objects to our internal TTSVoice interface
      const voiceList = voices || [];
      const mappedVoices: TTSVoice[] = voiceList.map(v => ({
        id: v.voiceURI, // Native URI is robust for ID
        name: v.name,
        lang: v.lang,
        provider: 'local'
      }));

      // Cache for lookup in synthesize
      this.voiceMap.clear();
      mappedVoices.forEach(v => this.voiceMap.set(v.id, v));

      return mappedVoices;
    } catch (e) {
      console.warn('Failed to load native voices', e);
      return [];
    }
  }

  async synthesize(text: string, voiceId: string, speed: number, signal?: AbortSignal): Promise<SpeechSegment> {
    // Native operations can't easily be aborted mid-flight by a signal,
    // but we can check before we start.
    if (signal?.aborted) throw new Error('Aborted');

    let lang = 'en-US';
    const voice = this.voiceMap.get(voiceId);
    if (voice) {
      lang = voice.lang;
    } else {
       console.warn(`Voice ${voiceId} not found in cache, using default lang ${lang}`);
    }

    this.emit('start');

    const onAbort = () => {
      TextToSpeech.stop().catch(e => console.warn('Failed to stop TTS on abort', e));
    };

    if (signal) {
      signal.addEventListener('abort', onAbort);
    }

    try {
      // The plugin handles the audio output directly.
      // This Promise resolves only when the speech finishes (onEnd event).
      await TextToSpeech.speak({
        text,
        lang,
        rate: speed,
        category: 'playback', // Important iOS hint, good practice for Android
        queueStrategy: 0 // 0 = Flush (interrupt). Necessary for responsive controls (Next/Prev/Seek).
      });

      if (!signal?.aborted) {
        this.emit('end');
      }
    } catch (e) {
      if (!signal?.aborted) {
        this.emit('error', { error: e });
      }
      // We consume the error to prevent double-reporting if the caller handles promise rejection.
      // AudioPlayerService logic assumes events drive the state when using 'local' provider.
    } finally {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    }

    // We return a marker indicating native playback occurred.
    // This tells the Service NOT to try and play an audio blob.
    return { isNative: true };
  }

  async stop(): Promise<void> {
    await TextToSpeech.stop();
  }

  async pause(): Promise<void> {
    // Native TTS pause support varies wildly by Android version and Engine.
    // A hard stop is the safest way to ensure silence.
    await TextToSpeech.stop();
  }

  // NOTE: resume() is intentionally omitted.
  // Native Android TTS does not reliably support resuming from the middle of a sentence.
  // By omitting this method, AudioPlayerService will fall back to restarting the current sentence
  // (via playInternal) which is the correct behavior for this provider.

  on(callback: TTSCallback) {
    this.callback = callback;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private emit(type: 'start' | 'end' | 'boundary' | 'error', data: any = {}) {
    if (this.callback) {
      this.callback({ type, ...data });
    }
  }
}

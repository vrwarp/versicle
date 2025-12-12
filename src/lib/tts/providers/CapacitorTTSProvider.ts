import { TextToSpeech } from '@capacitor-community/text-to-speech';
import type { ITTSProvider, TTSOptions, TTSEvent, TTSVoice } from './types';

export class CapacitorTTSProvider implements ITTSProvider {
  id = 'local';
  private voiceMap = new Map<string, TTSVoice>();
  private eventListeners: ((event: TTSEvent) => void)[] = [];
  private activeUtteranceId = 0;

  private lastText: string | null = null;
  private lastOptions: TTSOptions | null = null;

  async init(): Promise<void> {
    await this.getVoices();
    try {
        await TextToSpeech.addListener('onRangeStart', (info) => {
             this.emit({ type: 'boundary', charIndex: info.start });
        });
    } catch (e) {
        console.warn('Failed to add listener for TTS', e);
    }
  }

  async getVoices(): Promise<TTSVoice[]> {
    try {
      const { voices } = await TextToSpeech.getSupportedVoices();
      const mappedVoices: TTSVoice[] = (voices || []).map(v => ({
        id: v.voiceURI,
        name: v.name,
        lang: v.lang,
        provider: 'local'
      }));

      this.voiceMap.clear();
      mappedVoices.forEach(v => this.voiceMap.set(v.id, v));

      return mappedVoices;
    } catch (e) {
      console.warn('Failed to load native voices', e);
      return [];
    }
  }

  async play(text: string, options: TTSOptions): Promise<void> {
    this.lastText = text;
    this.lastOptions = options;

    const myId = ++this.activeUtteranceId;

    let lang = 'en-US';
    const voice = this.voiceMap.get(options.voiceId);
    if (voice) {
      lang = voice.lang;
    }

    // Call speak but don't await completion for the promise return.
    // However, we want to know if it STARTED.
    // The plugin doesn't give a "started" promise.
    // We'll emit start immediately.
    this.emit({ type: 'start' });

    TextToSpeech.speak({
        text,
        lang,
        rate: options.speed,
        category: 'playback',
        queueStrategy: 0 // Flush
    }).then(() => {
        if (this.activeUtteranceId === myId) {
            this.emit({ type: 'end' });
        }
    }).catch((e) => {
        if (this.activeUtteranceId === myId) {
            this.emit({ type: 'error', error: e });
        }
    });
  }

  async preload(_text: string, _options: TTSOptions): Promise<void> {
      // No-op
  }

  stop(): void {
    this.activeUtteranceId++;
    TextToSpeech.stop().catch(e => console.warn('Failed to stop TTS', e));
  }

  pause(): void {
    // Native pause not reliable, so we stop.
    this.stop();
  }

  resume(): void {
      // Native resume not reliable. We restart the current sentence.
      if (this.lastText && this.lastOptions) {
          this.play(this.lastText, this.lastOptions);
      }
  }

  on(callback: (event: TTSEvent) => void): void {
      this.eventListeners.push(callback);
  }

  private emit(event: TTSEvent) {
      this.eventListeners.forEach(l => l(event));
  }
}

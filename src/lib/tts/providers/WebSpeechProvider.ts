import type { ITTSProvider, TTSOptions, TTSEvent, TTSVoice } from './types';

/**
 * TTS Provider implementation using the browser's native Web Speech API.
 */
export class WebSpeechProvider implements ITTSProvider {
  id = 'local';
  private synth: SpeechSynthesis;
  private voices: SpeechSynthesisVoice[] = [];
  private eventListeners: ((event: TTSEvent) => void)[] = [];
  private voicesLoaded = false;
  private lastText: string | null = null;
  private lastOptions: TTSOptions | null = null;

  constructor() {
    this.synth = window.speechSynthesis;
    if (!this.synth) {
      console.warn("WebSpeechProvider: window.speechSynthesis is not available");
    }
  }

  async init(): Promise<void> {
    if (!this.synth) return;
    if (this.voicesLoaded && this.voices.length > 0) return;

    return new Promise((resolve) => {
      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        this.voices = this.synth.getVoices();
        if (this.voices.length > 0) this.voicesLoaded = true;
        resolve();
      };
      const currentVoices = this.synth.getVoices();
      if (currentVoices.length > 0) {
        finish();
        return;
      }
      const onVoicesChanged = () => {
        finish();
        this.synth.removeEventListener('voiceschanged', onVoicesChanged);
      };
      if (this.synth.addEventListener) {
          this.synth.addEventListener('voiceschanged', onVoicesChanged);
      } else {
          const original = this.synth.onvoiceschanged;
          this.synth.onvoiceschanged = (e) => {
              if (original) original.call(this.synth, e);
              onVoicesChanged();
          };
      }
      setTimeout(() => {
          if (!resolved) {
              console.warn('WebSpeechProvider: Voice loading timed out or no voices available.');
              finish();
          }
      }, 1000);
    });
  }

  async getVoices(): Promise<TTSVoice[]> {
    if (!this.synth) return [];
    if (!this.voicesLoaded || this.voices.length === 0) {
        const current = this.synth.getVoices();
        if (current.length > 0) {
            this.voices = current;
            this.voicesLoaded = true;
        } else {
            await this.init();
        }
    }
    if (this.voices.length === 0) {
        this.voices = this.synth.getVoices();
        if (this.voices.length > 0) this.voicesLoaded = true;
    }
    return this.voices.map(v => ({
      id: v.name,
      name: v.name,
      lang: v.lang,
      provider: 'local',
      originalVoice: v
    }));
  }

  async play(text: string, options: TTSOptions): Promise<void> {
    if (!this.synth) throw new Error("SpeechSynthesis API not available");

    this.lastText = text;
    this.lastOptions = options;

    this.cancel();

    if (this.voices.length === 0) await this.init();

    return new Promise((resolve, reject) => {
        const utterance = new SpeechSynthesisUtterance(text);
        const voice = this.voices.find(v => v.name === options.voiceId);
        if (voice) utterance.voice = voice;
        utterance.rate = options.speed;

        utterance.onstart = () => {
            this.emit({ type: 'start' });
            resolve();
        };
        utterance.onend = () => this.emit({ type: 'end' });
        utterance.onerror = (e) => {
            this.emit({ type: 'error', error: e });
            reject(e);
        };
        utterance.onboundary = (e) => this.emit({ type: 'boundary', charIndex: e.charIndex });

        this.synth.speak(utterance);
    });
  }

  async preload(_text: string, _options: TTSOptions): Promise<void> {
      void _text;
      void _options;
      // No-op
  }

  stop(): void {
    this.cancel();
  }

  pause(): void {
    if (this.synth && this.synth.speaking) {
      this.synth.pause();
    }
  }

  resume(): void {
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

  private cancel() {
    if (this.synth) {
      this.synth.cancel();
    }
  }
}

import type { ITTSProvider, SpeechSegment, TTSVoice } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TTSCallback = (event: { type: 'start' | 'end' | 'boundary' | 'error', charIndex?: number, error?: any }) => void;

export class WebSpeechProvider implements ITTSProvider {
  id = 'local';
  private synth: SpeechSynthesis;
  private voices: SpeechSynthesisVoice[] = [];
  private callback: TTSCallback | null = null;

  constructor() {
    this.synth = window.speechSynthesis;
  }

  async init(): Promise<void> {
    if (this.voices.length > 0) return;

    return new Promise((resolve) => {
      const load = () => {
        this.voices = this.synth.getVoices();
        if (this.voices.length > 0) {
           resolve();
        }
      };

      this.voices = this.synth.getVoices();
      if (this.voices.length > 0) {
        resolve();
      } else {
        // Some browsers load voices asynchronously
        if (this.synth.onvoiceschanged !== undefined) {
             this.synth.onvoiceschanged = load;
        } else {
            // Fallback for browsers that might not trigger event reliably if already loaded?
            // Or just resolve.
            setTimeout(load, 100);
        }
      }
    });
  }

  async getVoices(): Promise<TTSVoice[]> {
    if (this.voices.length === 0) {
      await this.init();
    }
    return this.voices.map(v => ({
      id: v.name, // Using name as ID for local voices as it's usually unique enough or URI
      name: v.name,
      lang: v.lang,
      provider: 'local',
      originalVoice: v
    }));
  }

  async synthesize(text: string, voiceId: string, speed: number): Promise<SpeechSegment> {
    this.cancel(); // specific method to stop previous

    const utterance = new SpeechSynthesisUtterance(text);
    const voice = this.voices.find(v => v.name === voiceId);
    if (voice) utterance.voice = voice;
    utterance.rate = speed;

    utterance.onstart = () => this.emit('start');
    utterance.onend = () => this.emit('end');
    utterance.onerror = (e) => this.emit('error', { error: e });
    utterance.onboundary = (e) => this.emit('boundary', { charIndex: e.charIndex });

    this.synth.speak(utterance);

    return { isNative: true };
  }

  stop(): void {
    this.cancel();
  }

  pause(): void {
    if (this.synth.speaking) {
      this.synth.pause();
    }
  }

  resume(): void {
    if (this.synth.paused) {
      this.synth.resume();
    }
  }

  private cancel() {
    this.synth.cancel();
  }

  // Event handling registration
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

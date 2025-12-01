import type { ITTSProvider, SpeechSegment, TTSVoice } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TTSCallback = (event: { type: 'start' | 'end' | 'boundary' | 'error', charIndex?: number, error?: any }) => void;

export class WebSpeechProvider implements ITTSProvider {
  id = 'local';
  private synth: SpeechSynthesis;
  private voices: SpeechSynthesisVoice[] = [];
  private callback: TTSCallback | null = null;
  private voicesLoaded = false;

  constructor() {
    this.synth = window.speechSynthesis;
  }

  async init(): Promise<void> {
    // If we have voices, we are good.
    if (this.voicesLoaded && this.voices.length > 0) return;

    return new Promise((resolve) => {
      let resolved = false;

      const finish = () => {
        if (resolved) return;
        resolved = true;
        this.voices = this.synth.getVoices();
        // Only mark as loaded if we actually got voices.
        // If we timed out with 0 voices, we leave voicesLoaded as false
        // so that getVoices() will try again next time.
        if (this.voices.length > 0) {
            this.voicesLoaded = true;
        }
        resolve();
      };

      // Try immediately
      const currentVoices = this.synth.getVoices();
      if (currentVoices.length > 0) {
        finish();
        return;
      }

      // Wait for event
      const onVoicesChanged = () => {
        finish();
        // Remove listener to clean up
        this.synth.removeEventListener('voiceschanged', onVoicesChanged);
      };

      if (this.synth.addEventListener) {
          this.synth.addEventListener('voiceschanged', onVoicesChanged);
      } else {
          // Fallback
          const original = this.synth.onvoiceschanged;
          this.synth.onvoiceschanged = (e) => {
              if (original) original.call(this.synth, e);
              onVoicesChanged();
          };
      }

      // Safety timeout
      setTimeout(() => {
          if (!resolved) {
              console.warn('WebSpeechProvider: Voice loading timed out or no voices available.');
              finish();
          }
      }, 1000);
    });
  }

  async getVoices(): Promise<TTSVoice[]> {
    // If we don't have voices, try init again.
    // Also, even if voicesLoaded is false, we might have voices now available in the browser
    // that were loaded after the timeout.
    if (!this.voicesLoaded || this.voices.length === 0) {
        // Double check directly before awaiting init (optimization)
        const current = this.synth.getVoices();
        if (current.length > 0) {
            this.voices = current;
            this.voicesLoaded = true;
        } else {
            await this.init();
        }
    }

    // Final check after init
    if (this.voices.length === 0) {
        this.voices = this.synth.getVoices();
        if (this.voices.length > 0) this.voicesLoaded = true;
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

    // Ensure voices are loaded before speaking
    if (this.voices.length === 0) {
        await this.init();
    }

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

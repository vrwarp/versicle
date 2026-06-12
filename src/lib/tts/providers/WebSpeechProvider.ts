import type { ITTSProvider, TTSOptions, TTSEvent, TTSVoice, Unsubscribe } from './types';
import { playEarconOscillators } from '../earcons';

/**
 * TTS Provider implementation using the browser's native Web Speech API.
 */
export class WebSpeechProvider implements ITTSProvider {
  id = 'local';
  private synth: SpeechSynthesis;
  private voices: SpeechSynthesisVoice[] = [];
  private eventListeners: ((event: TTSEvent) => void)[] = [];
  private voicesLoaded = false;
  private audioContext: AudioContext | null = null;
  private disposed = false;

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
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const finish = () => {
        if (resolved) return;
        resolved = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
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
      timeoutId = setTimeout(() => {
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
    // Plain serializable voice metadata; the live SpeechSynthesisVoice stays internal
    // (resolved from `this.voices` by id at play time).
    return this.voices.map(v => ({
      id: v.name,
      name: v.name,
      lang: v.lang,
      provider: 'local'
    }));
  }

  async play(text: string, options: TTSOptions): Promise<void> {
    if (!this.synth) throw new Error("SpeechSynthesis API not available");

    this.cancel();

    if (this.voices.length === 0) await this.init();

    return new Promise((resolve, reject) => {
        const utterance = new SpeechSynthesisUtterance(text);
        const voice = this.voices.find(v => v.name === options.voiceId);
        if (voice) utterance.voice = voice;
        // Playback-time rate: local speech has no synthesized artifact (and thus no
        // cache), so the engine legitimately speaks live at the requested rate here.
        utterance.rate = options.speed;

        let started = false;
        utterance.onstart = () => {
            started = true;
            this.emit({ type: 'start' });
            resolve();
        };
        utterance.onend = () => this.emit({ type: 'end' });
        utterance.onerror = (e) => {
            const errorMsg = `SpeechSynthesisError: ${e.error}`;
            if (!started) {
                // Single-shot contract: a failure to START surfaces through the
                // rejection ONLY — never additionally as an 'error' event (the
                // pre-5a emit+reject double-signal fed the S2 fallback double-fire).
                reject(new Error(errorMsg));
                return;
            }
            // Mid-playback failure (after play() resolved): the event channel is
            // the only one left; the engine normalizes interruptions upstream.
            this.emit({
                type: 'error',
                error: {
                    error: e.error,
                    message: errorMsg,
                    type: e.type,
                }
            });
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

  on(callback: (event: TTSEvent) => void): Unsubscribe {
      this.eventListeners.push(callback);
      return () => {
          this.eventListeners = this.eventListeners.filter(l => l !== callback);
      };
  }

  /** Cancel speech, detach all listeners, release the earcon AudioContext. */
  dispose(): void {
      if (this.disposed) return;
      this.disposed = true;
      this.cancel();
      this.eventListeners = [];
      if (this.audioContext) {
          void this.audioContext.close().catch(() => {});
          this.audioContext = null;
      }
  }

  playEarcon(type: 'bookmark_captured' | 'bookmark_failed'): void {
      // Fallback for WebSpeechProvider (which doesn't use AudioElementPlayer)
      // This will just play the earcon without ducking the native Web Speech API volume
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      if (!this.audioContext) {
          this.audioContext = new AudioContextClass();
      }
      const ctx = this.audioContext;
      if (ctx.state === 'suspended') {
          ctx.resume();
      }
      playEarconOscillators(ctx, type);
  }

  private emit(event: TTSEvent) {
      if (this.disposed) return;
      this.eventListeners.forEach(l => l(event));
  }

  private cancel() {
    if (this.synth) {
      this.synth.cancel();
    }
  }
}

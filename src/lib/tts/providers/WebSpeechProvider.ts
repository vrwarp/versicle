import type { ITTSProvider, SpeechSegment, TTSVoice } from './types';
import silenceUrl from '../../../assets/silence.ogg';
import whiteNoiseUrl from '../../../assets/white-noise.ogg';

export interface WebSpeechConfig {
    silentAudioType: 'silence' | 'white-noise';
    whiteNoiseVolume: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TTSCallback = (event: { type: 'start' | 'end' | 'boundary' | 'error', charIndex?: number, error?: any }) => void;

/**
 * TTS Provider implementation using the browser's native Web Speech API.
 * This provider works offline and costs nothing, but voice quality varies by browser/OS.
 */
export class WebSpeechProvider implements ITTSProvider {
  id = 'local';
  private synth: SpeechSynthesis;
  private voices: SpeechSynthesisVoice[] = [];
  private callback: TTSCallback | null = null;
  private voicesLoaded = false;
  private silentAudio: HTMLAudioElement;
  private config: WebSpeechConfig;

  constructor(config: WebSpeechConfig = { silentAudioType: 'silence', whiteNoiseVolume: 0.1 }) {
    this.config = config;
    this.synth = window.speechSynthesis;
    // Initialize silent audio loop to keep MediaSession active
    this.silentAudio = new Audio();
    this.silentAudio.loop = true;
    this.updateSilentAudio();
  }

  setConfig(config: WebSpeechConfig) {
      this.config = config;
      this.updateSilentAudio();
  }

  private updateSilentAudio() {
      // Logic to set src and volume
      const src = this.config.silentAudioType === 'white-noise' ? whiteNoiseUrl : silenceUrl;

      // Check if src changed to avoid reloading if not necessary
      const currentSrc = this.silentAudio.getAttribute('src');
      if (currentSrc !== src) {
          const wasPlaying = !this.silentAudio.paused;
          // Only pause if we are changing source
          if (wasPlaying) this.silentAudio.pause();

          this.silentAudio.src = src;

          if (wasPlaying) {
              this.silentAudio.play().catch(e => console.warn("Silent audio switch failed", e));
          }
      }

      if (this.config.silentAudioType === 'white-noise') {
          this.silentAudio.volume = Math.min(Math.max(this.config.whiteNoiseVolume, 0), 1);
      } else {
          this.silentAudio.volume = 1.0;
      }
  }

  /**
   * Initializes the Web Speech provider by loading available voices.
   * Handles the asynchronous nature of `speechSynthesis.getVoices()`.
   */
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

  /**
   * Returns the list of available local voices.
   *
   * @returns A promise resolving to the list of voices.
   */
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

  /**
   * Synthesizes speech using `SpeechSynthesisUtterance`.
   * Note: This method does not return audio data; it triggers native playback.
   *
   * @param text - The text to speak.
   * @param voiceId - The name of the voice to use.
   * @param speed - The playback rate.
   * @param signal - Optional AbortSignal to cancel the operation.
   * @returns A Promise resolving to a SpeechSegment (with isNative: true).
   */
  async synthesize(text: string, voiceId: string, speed: number, signal?: AbortSignal): Promise<SpeechSegment> {
    this.cancel(); // specific method to stop previous

    if (signal?.aborted) {
      throw new Error('Aborted');
    }

    // Listen for abort event
    signal?.addEventListener('abort', () => {
      this.cancel();
    });

    // Ensure voices are loaded before speaking
    if (this.voices.length === 0) {
        await this.init();
    }

    // Check again after init
    if (signal?.aborted) {
        throw new Error('Aborted');
    }

    // Start silent audio loop to keep MediaSession active
    if (this.silentAudio.paused) {
        this.silentAudio.play().catch(e => console.warn("Silent audio play failed", e));
    }

    const utterance = new SpeechSynthesisUtterance(text);
    const voice = this.voices.find(v => v.name === voiceId);
    if (voice) utterance.voice = voice;
    utterance.rate = speed;

    utterance.onstart = () => this.emit('start');
    utterance.onend = () => {
        // We do NOT pause silent audio here, because the service might play the next sentence immediately.
        // The Service is responsible for calling stop() if playback is truly finished.
        this.emit('end');
    };
    utterance.onerror = (e) => {
        // We pause silent audio on error, as it might stop playback
        this.pauseSilentAudio();
        this.emit('error', { error: e });
    };
    utterance.onboundary = (e) => this.emit('boundary', { charIndex: e.charIndex });

    this.synth.speak(utterance);

    return { isNative: true };
  }

  /**
   * Stops playback.
   */
  stop(): void {
    this.cancel();
    this.pauseSilentAudio();
  }

  /**
   * Pauses playback.
   */
  pause(): void {
    if (this.synth.speaking) {
      this.synth.pause();
    }
    this.pauseSilentAudio();
  }

  /**
   * Resumes playback.
   */
  resume(): void {
    if (this.synth.paused) {
      this.synth.resume();
      if (this.silentAudio.paused) {
          this.silentAudio.play().catch(e => console.warn("Silent audio resume failed", e));
      }
    }
  }

  /**
   * Cancels the current utterance.
   */
  private cancel() {
    this.synth.cancel();
    // note: we don't automatically pause silent audio here because synthesize() calls cancel() before starting new one
  }

  private pauseSilentAudio() {
      this.silentAudio.pause();
      this.silentAudio.currentTime = 0;
  }

  /**
   * Registers a callback for TTS events (start, end, boundary, error).
   *
   * @param callback - The event handler.
   */
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

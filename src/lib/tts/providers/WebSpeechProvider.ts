import type { ITTSProvider, SpeechSegment, TTSVoice } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TTSCallback = (event: { type: 'start' | 'end' | 'boundary' | 'error', charIndex?: number, error?: any }) => void;

const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
// 0.5s of 8000Hz 8-bit mono white noise
const WHITE_NOISE_WAV = 'data:audio/wav;base64,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';

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

  private silentAudioMode: 'silent' | 'white_noise' = 'silent';
  private silentAudioVolume: number = 0.2;

  constructor() {
    this.synth = window.speechSynthesis;
    // Initialize silent audio loop to keep MediaSession active
    // Default to silent WAV
    this.silentAudio = new Audio(SILENT_WAV);
    this.silentAudio.loop = true;
  }

  /**
   * Configure the silent/background audio settings.
   * @param mode 'silent' for silent WAV, 'white_noise' for white noise
   * @param volume Volume for white noise (0-1). Silent WAV ignores this.
   */
  configureSilentAudio(mode: 'silent' | 'white_noise', volume: number) {
      this.silentAudioMode = mode;
      this.silentAudioVolume = volume;
      this.updateSilentAudioSource();
  }

  private updateSilentAudioSource() {
      const wasPlaying = !this.silentAudio.paused;
      const newSrc = this.silentAudioMode === 'white_noise' ? WHITE_NOISE_WAV : SILENT_WAV;

      // Update volume
      this.silentAudio.volume = this.silentAudioMode === 'white_noise' ? this.silentAudioVolume : 1.0;

      if (this.silentAudio.getAttribute('src') !== newSrc) {
          this.silentAudio.src = newSrc;
          this.silentAudio.load(); // Reload audio with new source
          if (wasPlaying) {
              this.silentAudio.play().catch(console.warn);
          }
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

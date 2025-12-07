import type { ITTSProvider, SpeechSegment, TTSVoice } from './types';

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
  private silentAudioMode: 'silent' | 'white_noise' = 'silent';
  private silentAudioVolume: number = 0.1;

  // 1 second of silence
  private static readonly SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
  // 1 second of white noise
  private static readonly WHITE_NOISE_WAV = 'data:audio/wav;base64,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';

  constructor() {
    this.synth = window.speechSynthesis;
    // Initialize silent audio loop to keep MediaSession active
    this.silentAudio = new Audio(WebSpeechProvider.SILENT_WAV);
    this.silentAudio.loop = true;
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

  /**
   * Configures the background audio track.
   *
   * @param mode - 'silent' or 'white_noise'
   * @param volume - Volume level (0.0 to 1.0)
   */
  configureSilentAudio(mode: 'silent' | 'white_noise', volume: number): void {
    const changed = this.silentAudioMode !== mode;
    this.silentAudioMode = mode;
    this.silentAudioVolume = Math.max(0, Math.min(1, volume)); // clamp

    if (changed) {
        // Stop current audio if playing to switch source
        const wasPlaying = !this.silentAudio.paused;
        this.silentAudio.pause();

        const src = mode === 'white_noise' ? WebSpeechProvider.WHITE_NOISE_WAV : WebSpeechProvider.SILENT_WAV;
        this.silentAudio = new Audio(src);
        this.silentAudio.loop = true;

        if (wasPlaying) {
             this.silentAudio.play().catch(e => console.warn("Background audio play failed on config change", e));
        }
    }

    this.silentAudio.volume = this.silentAudioVolume;
  }
}

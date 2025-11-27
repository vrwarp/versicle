import { ITTSProvider, SpeechSegment, TTSVoice } from './types';

type TTSCallback = (event: { type: 'start' | 'end' | 'boundary' | 'error', charIndex?: number, error?: any }) => void;

export class WebSpeechProvider implements ITTSProvider {
  id = 'local';
  private synth: SpeechSynthesis;
  private voices: SpeechSynthesisVoice[] = [];
  private currentUtterance: SpeechSynthesisUtterance | null = null;
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
    // For WebSpeech, we don't return audio, we prepare execution.
    // However, the interface says synthesize returns a Promise<SpeechSegment>.
    // Since isNative is true, we might not need to do much here,
    // but we should probably prepare the utterance.

    // In this architecture, synthesize might be called just before play?
    // Or does AudioPlayerService call synthesize then play?
    // For local, we "play" immediately usually.
    // But to adhere to the pattern, let's just return isNative: true
    // and let the `play` method (or implicit action) handle the actual speech.

    // Actually, to make it controllable, we should probably set up the utterance here
    // but not speak it until 'play' or just speak it immediately?
    // The interface implies `synthesize` does the heavy lifting.
    // For native, we'll store the parameters and `play` will use them.

    // Wait, the interface has `stop`, `pause`, `resume`. But no `play(segment)`.
    // The AudioPlayerService will likely handle the flow.
    // If isNative is true, AudioPlayerService might expect the provider to handle playback
    // OR it might assume `synthesize` starts playback?
    // Let's assume `synthesize` prepares it.

    // But `speechSynthesis` is imperative. `speak(utterance)`.
    // Let's implement a custom method `speak` or handle it within synthesize?
    // The plan says: "Since Web Speech API plays audio directly, this method will return { isNative: true }."
    // It also says: "Event Handling: The provider will need to expose an event emitter..."

    // So let's add `speak` method to the provider or make `synthesize` start it?
    // If `synthesize` starts it, then AudioPlayerService has less control over EXACT start time
    // if it wants to buffer first. But local can't buffer.

    // Let's add a `speak` method to the class (not in interface yet, or maybe modify interface?)
    // Or just make `synthesize` start speaking for Native?
    // "synthesize: Cloud providers return a Blob... Local providers return a specialized flag..."

    // I will start speaking in `synthesize` for now, as that's how `speechSynthesis` works best.
    // The AudioPlayerService calls synthesize when it wants to play a segment.

    this.cancel(); // specific method to stop previous

    const utterance = new SpeechSynthesisUtterance(text);
    const voice = this.voices.find(v => v.name === voiceId);
    if (voice) utterance.voice = voice;
    utterance.rate = speed;

    utterance.onstart = () => this.emit('start');
    utterance.onend = () => this.emit('end');
    utterance.onerror = (e) => this.emit('error', { error: e });
    utterance.onboundary = (e) => this.emit('boundary', { charIndex: e.charIndex });

    this.currentUtterance = utterance;
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
    this.currentUtterance = null;
  }

  // Event handling registration
  on(callback: TTSCallback) {
    this.callback = callback;
  }

  private emit(type: 'start' | 'end' | 'boundary' | 'error', data: any = {}) {
    if (this.callback) {
      this.callback({ type, ...data });
    }
  }
}

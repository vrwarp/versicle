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

  // State for tracking active utterance
  private activeUtteranceId = 0;
  private lastRangeEnd = 0;

  async init(): Promise<void> {
    // Native plugins generally initialize lazily, but we could check
    // for specific engine availability here if needed.
    // We can pre-fetch voices here to populate the map early
    await this.getVoices();

    // Register global listener for onRangeStart
    try {
        await TextToSpeech.addListener('onRangeStart', (info) => {
             this.lastRangeEnd = info.end;
             this.emit('boundary', { charIndex: info.start });
        });
    } catch (e) {
        console.warn('Failed to add listener for TTS', e);
    }
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

    const myId = ++this.activeUtteranceId;
    this.lastRangeEnd = 0;

    let lang = 'en-US';
    const voice = this.voiceMap.get(voiceId);
    if (voice) {
      lang = voice.lang;
    } else {
       console.warn(`Voice ${voiceId} not found in cache, using default lang ${lang}`);
    }

    this.emit('start');

    const onAbort = () => {
       if (this.activeUtteranceId === myId) {
           this.activeUtteranceId++; // Invalidate current
           TextToSpeech.stop().catch(e => console.warn('Failed to stop TTS on abort', e));
       }
    };

    if (signal) {
      signal.addEventListener('abort', onAbort);
    }

    // Monitor Playback (Async)
    // We rely on this monitor to emit 'end' if the native plugin behaves asynchronously (doesn't block)
    // or if we need to detect end via range events.
    const estimatedDurationMs = Math.max(1000, (text.length * 60) / speed); // min 1s, approx 60ms/char
    this.monitorPlayback(myId, text.length, estimatedDurationMs);

    try {
      const start = Date.now();

      // The plugin handles the audio output directly.
      await TextToSpeech.speak({
        text,
        lang,
        rate: speed,
        category: 'playback', // Important iOS hint, good practice for Android
        queueStrategy: 0 // 0 = Flush (interrupt). Necessary for responsive controls (Next/Prev/Seek).
      });

      const elapsed = Date.now() - start;

      // Heuristic: If speak() took a significant amount of time (relative to estimated duration),
      // we assume it blocked until completion (iOS behavior or working Android).
      // If it returned instantly, we assume it's the broken Android behavior where it returns immediately.
      // We use a threshold of 50% of estimated duration or 500ms, whichever is larger.

      // If elapsed > 500ms, it probably did something blocking.
      if (elapsed > 500 && elapsed > estimatedDurationMs * 0.5) {
           if (this.activeUtteranceId === myId) {
               this.emit('end');
               this.activeUtteranceId++; // Stop monitor
           }
      }
      // Else: let the monitor finish the job (waiting for events or timeout)

    } catch (e) {
      if (!signal?.aborted) {
        this.emit('error', { error: e });
      }
      this.activeUtteranceId++; // Stop monitor
    } finally {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    }

    // We return a marker indicating native playback occurred.
    // This tells the Service NOT to try and play an audio blob.
    return { isNative: true };
  }

  private async monitorPlayback(id: number, textLength: number, durationMs: number) {
      const startTime = Date.now();
      const maxDuration = durationMs * 1.5 + 2000; // +50% + 2s padding

      const poll = () => {
          if (this.activeUtteranceId !== id) return; // Cancelled or finished

          // Check if done via range events
          if (this.lastRangeEnd > 0 && this.lastRangeEnd >= textLength - 5) {
              // We are at the end. Wait a small buffer and finish.
              setTimeout(() => {
                  if (this.activeUtteranceId === id) {
                      this.emit('end');
                      this.activeUtteranceId++; // Invalidate to stop this poll loop
                  }
              }, 500);
              return;
          }

          const elapsed = Date.now() - startTime;
          if (elapsed > maxDuration) {
              // Timeout - assume finished
               if (this.activeUtteranceId === id) {
                  this.emit('end');
                  this.activeUtteranceId++;
               }
               return;
          }

          setTimeout(poll, 200);
      };

      // Delay start of polling to avoid race with immediate return
      setTimeout(poll, 100);
  }

  async stop(): Promise<void> {
    this.activeUtteranceId++; // Cancel any active monitor
    await TextToSpeech.stop();
  }

  async pause(): Promise<void> {
    // Native TTS pause support varies wildly by Android version and Engine.
    // A hard stop is the safest way to ensure silence.
    this.activeUtteranceId++;
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

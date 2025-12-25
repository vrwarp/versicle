import { TextToSpeech } from '@capacitor-community/text-to-speech';
import type { PluginListenerHandle } from '@capacitor/core';
import type { ITTSProvider, TTSOptions, TTSEvent, TTSVoice } from './types';

export class CapacitorTTSProvider implements ITTSProvider {
  id = 'local';
  private voiceMap = new Map<string, TTSVoice>();
  private eventListeners: ((event: TTSEvent) => void)[] = [];
  private activeUtteranceId = 0;

  private lastText: string | null = null;
  private lastOptions: TTSOptions | null = null;
  private rangeStartListener: PluginListenerHandle | null = null;

  // Smart Handoff State
  private nextText: string | null = null;
  private nextUtterancePromise: Promise<void> | null = null;
  // We don't strictly need nextUtteranceId if we check equality of the text and promise existence,
  // but let's stick to the design doc if possible.
  // Actually, the design says `nextUtteranceId` to ensure we don't resolve the wrong one.
  // But since we create a new closure for the promise handler in play(), we might not need it there
  // if we attach handlers in play().
  // However, the design doc says: "Attach completion handlers to the EXISTING promise".
  // The promise returned by TextToSpeech.speak() resolves when speech finishes.

  async init(): Promise<void> {
    await this.getVoices();
    try {
        if (this.rangeStartListener) {
            await this.rangeStartListener.remove();
        }

        this.rangeStartListener = await TextToSpeech.addListener('onRangeStart', (info) => {
             if (!this.lastText) return;

             // If the index is outside the bounds of the current text,
             // it belongs to a previous, longer utterance.
             if (info.start >= this.lastText.length) return;

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
    // Check if this request matches the preloaded text
    const isHandoff = (text === this.nextText && this.nextUtterancePromise);

    // Increment ID for the new active utterance
    this.activeUtteranceId++;
    const myId = this.activeUtteranceId;

    this.lastText = text;
    this.lastOptions = options;

    if (isHandoff) {
        // --- SMART HANDOFF PATH ---
        // 1. Do NOT stop. The native engine is already playing or queuing this.

        // 2. Emit start immediately to satisfy AudioPlayerService state
        this.emit({ type: 'start' });

        // 3. Attach completion handlers to the EXISTING promise
        this.nextUtterancePromise!
            .then(() => {
                if (this.activeUtteranceId === myId) {
                    this.emit({ type: 'end' });
                }
            })
            .catch((e) => {
                if (this.activeUtteranceId === myId) {
                    this.emit({ type: 'error', error: e });
                }
            });

        // 4. Cleanup Preload State
        this.nextText = null;
        this.nextUtterancePromise = null;

    } else {
        // --- STANDARD PATH (Seek/Jump/First Play) ---

        // 1. Cleanup any stale preload state
        this.nextText = null;
        this.nextUtterancePromise = null;

        // 2. Stop previous audio
        try {
            await TextToSpeech.stop();
        } catch (e) { /* ignore */ }

        // 3. Emit start
        this.emit({ type: 'start' });

        // 4. Speak with Flush (Strategy 0)
        let lang = 'en-US';
        const voice = this.voiceMap.get(options.voiceId);
        if (voice) {
          lang = voice.lang;
        }

        TextToSpeech.speak({
            text,
            lang,
            rate: options.speed,
            category: 'playback',
            queueStrategy: 0 // QueueStrategy.Flush
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
  }

  async preload(text: string, options: TTSOptions): Promise<void> {
    // 1. Sanity Check: Only preload if we are currently playing.
    if (!this.lastText) return;

    this.nextText = text;

    // 2. Prepare Options
    const voice = this.voiceMap.get(options.voiceId);
    const lang = voice ? voice.lang : 'en-US';

    // 3. Queue Strategy: 1 = Add (Append)
    // We store the promise, but we do NOT attach .then() handlers yet.
    this.nextUtterancePromise = TextToSpeech.speak({
        text,
        lang,
        rate: options.speed,
        category: 'playback',
        queueStrategy: 1 // QueueStrategy.Add
    });
  }

  stop(): void {
    this.activeUtteranceId++; // Invalidate current
    this.lastText = null;

    // Clear preload state so we don't accidentally "handoff" to stale content
    this.nextText = null;
    this.nextUtterancePromise = null;

    // Native Stop clears the entire queue (current + buffered)
    TextToSpeech.stop().catch(e => console.warn('Failed to stop TTS', e));
  }

  pause(): void {
    // Native pause not reliable, so we stop.
    // We increment activeUtteranceId so that any pending 'end' events from the stopped utterance are ignored.
    this.activeUtteranceId++;

    // Also clear preload state on pause?
    // The design doc says for stop: "If the user stops playback while a preload is pending, we must ensure the preloaded item is also cancelled and the state cleared."
    // Pause should probably behave similarly regarding the native queue - if we pause, we usually stop the native engine.
    this.nextText = null;
    this.nextUtterancePromise = null;

    // However, we do NOT clear this.lastText, so resume() can restart the utterance.
    TextToSpeech.stop().catch(e => console.warn('Failed to stop TTS', e));
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

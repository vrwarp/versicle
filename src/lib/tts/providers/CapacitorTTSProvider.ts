import { TextToSpeech } from '@capacitor-community/text-to-speech';
import type { ITTSProvider, TTSOptions, TTSEvent, TTSVoice } from './types';
import type { PluginListenerHandle } from '@capacitor/core';
import { playEarconOscillators } from '../earcons';
import { flightRecorder } from '../TTSFlightRecorder';

export class CapacitorTTSProvider implements ITTSProvider {
  id = 'local';
  private voiceMap = new Map<string, TTSVoice>();
  private eventListeners: ((event: TTSEvent) => void)[] = [];
  private activeUtteranceId = 0;
  private listenerHandle: PluginListenerHandle | null = null;

  // State for Smart Handoff
  private nextText: string | null = null;
  private nextUtterancePromise: Promise<void> | null = null;
  private currentUtteranceFinished = false;

  private lastText: string | null = null;
  private lastOptions: TTSOptions | null = null;
  private audioContext: AudioContext | null = null;

  async init(): Promise<void> {
    await this.getVoices();
    try {
        if (this.listenerHandle) {
            await this.listenerHandle.remove();
            this.listenerHandle = null;
        }

        this.listenerHandle = await TextToSpeech.addListener('onRangeStart', (info) => {
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
    // Check for Smart Handoff eligibility
    const isContentMatch = text === this.nextText;
    const isNaturalFlow = this.currentUtteranceFinished;

    this.lastText = text;
    this.lastOptions = options;
    const myId = ++this.activeUtteranceId;

    // Reset flags for the NEW utterance (it hasn't finished yet)
    this.currentUtteranceFinished = false;

    if (isContentMatch && isNaturalFlow && this.nextUtterancePromise) {
        // --- SMART HANDOFF ---
        const promiseToTrack = this.nextUtterancePromise;
        const wasFinished = this.currentUtteranceFinished;

        flightRecorder.record('CAP', 'play.handoff', {
            uttId: myId,
            textLen: text.length,
            promiseSettled: wasFinished
        });

        // Native audio is already queued/playing. We just adopt the promise.
        this.emit({ type: 'start' });

        // Clear preload state so we don't re-use it
        this.nextText = null;
        this.nextUtterancePromise = null;

        promiseToTrack
            .then(() => {
                if (this.activeUtteranceId === myId) {
                    this.currentUtteranceFinished = true;
                    this.emit({ type: 'end' });
                }
            })
            .catch((e) => {
                if (this.activeUtteranceId === myId) {
                    this.emit({ type: 'error', error: e });
                }
            });

        return;
    }

    // --- STANDARD FLUSH ---
    // If we are here, we are NOT handing off.
    // Clean up any pending preload state because it's invalid now.
    this.nextText = null;
    this.nextUtterancePromise = null;

    try {
        await TextToSpeech.stop();
    } catch {
        // Ignore errors if nothing was playing
    }

    let lang = 'en-US';
    const voice = this.voiceMap.get(options.voiceId);
    if (voice) {
      lang = voice.lang;
    }

    flightRecorder.record('CAP', 'play.flush', {
        uttId: myId,
        textLen: text.length
    });

    this.emit({ type: 'start' });

    const speakPromise = TextToSpeech.speak({
        text,
        lang,
        rate: options.speed,
        category: 'playback',
        queueStrategy: 0 // Flush
    });

    speakPromise.then(() => {
        if (this.activeUtteranceId === myId) {
            this.currentUtteranceFinished = true;
            this.emit({ type: 'end' });
        }
    }).catch((e) => {
        if (this.activeUtteranceId === myId) {
            this.emit({ type: 'error', error: e });
        }
    });
  }

  async preload(text: string, options: TTSOptions): Promise<void> {
      // Preload the next utterance to achieve gapless playback (Smart Handoff).
      // We use QueueStrategy 1 (Add) to append this to the native Android buffer
      // immediately after the current utterance. The `play` method will later
      // check if `nextText` matches and adopt the running promise instead of restarting.

      this.nextText = text;

      flightRecorder.record('CAP', 'preload', {
          uttId: this.activeUtteranceId + 1,
          textLen: text.length
      });

      let lang = 'en-US';
      const voice = this.voiceMap.get(options.voiceId);
      if (voice) {
        lang = voice.lang;
      }

      // Fire and forget native call, but store the promise
      this.nextUtterancePromise = TextToSpeech.speak({
          text,
          lang,
          rate: options.speed,
          category: 'playback',
          queueStrategy: 1 // Add (Queue)
      });

      // We do NOT await it here.
  }

  stop(): void {
    flightRecorder.record('CAP', 'stop');
    this.activeUtteranceId++;
    this.lastText = null;

    // Clear preload state
    this.nextText = null;
    this.nextUtterancePromise = null;
    this.currentUtteranceFinished = false;

    TextToSpeech.stop().catch(e => console.warn('Failed to stop TTS', e));
  }

  pause(): void {
    flightRecorder.record('CAP', 'pause');
    // Native pause not reliable, so we stop.
    this.activeUtteranceId++;

    // Clear preload state
    this.nextText = null;
    this.nextUtterancePromise = null;
    this.currentUtteranceFinished = false;

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

  playEarcon(type: 'bookmark_captured' | 'bookmark_failed'): void {
      // Fallback for CapacitorTTSProvider
      // Similar to WebSpeechProvider, ducks other audio if we have an AudioContext, but native TTS volume cannot be easily ducked this way
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
      flightRecorder.record('CAP', event.type, {
          uttId: this.activeUtteranceId,
          ...(event.type === 'error' ? { error: String(event.error) } : {}),
          ...(event.type === 'boundary' ? { charIndex: event.charIndex } : {})
      });
      this.eventListeners.forEach(l => l(event));
  }
}

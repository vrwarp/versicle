/**
 * Typed TTS provider double implementing the real `ITTSProvider` plugin
 * interface (`src/lib/tts/providers/types.ts`).
 *
 * All methods are `vi.fn()` spies, so call assertions work out of the box;
 * provider events are driven explicitly from the test via `emit(...)` —
 * the same way the engine parity scenarios inject deterministic
 * start/end/boundary events.
 */
import { vi } from 'vitest';
import type { ITTSProvider, TTSEvent, TTSVoice, Unsubscribe } from '@lib/tts/providers/types';

export interface FakeTTSProviderOptions {
  id?: string;
  voices?: TTSVoice[];
}

export function makeTTSVoice(overrides: Partial<TTSVoice> = {}): TTSVoice {
  return {
    id: 'fake-voice-1',
    name: 'Fake Voice 1',
    lang: 'en-US',
    provider: 'local',
    ...overrides,
  };
}

export class FakeTTSProvider implements ITTSProvider {
  readonly id: string;
  voices: TTSVoice[];

  private listeners = new Set<(event: TTSEvent) => void>();

  init = vi.fn(async (): Promise<void> => {});
  getVoices = vi.fn(async (): Promise<TTSVoice[]> => this.voices);
  play: ITTSProvider['play'] = vi.fn(async (): Promise<void> => {});
  preload: ITTSProvider['preload'] = vi.fn(async (): Promise<void> => {});
  pause = vi.fn((): void => {});
  stop = vi.fn((): void => {});
  dispose = vi.fn((): void => {
    this.listeners.clear();
  });
  /** Locale capability spy (LocaleAware — see providers/registry.ts). */
  setLocale = vi.fn((): void => {});
  /** Voice-download capability spies (VoiceDownloadable — descriptor-gated). */
  downloadVoice: (voiceId: string) => Promise<void> = vi.fn(async (): Promise<void> => {});
  deleteVoice: (voiceId: string) => Promise<void> = vi.fn(async (): Promise<void> => {});
  isVoiceDownloaded: (voiceId: string) => Promise<boolean> = vi.fn(async (): Promise<boolean> => true);

  constructor(options: FakeTTSProviderOptions = {}) {
    this.id = options.id ?? 'fake';
    this.voices = options.voices ?? [makeTTSVoice()];
  }

  on(callback: (event: TTSEvent) => void): Unsubscribe {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  /** Drive a provider event into every registered listener. */
  emit(event: TTSEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /** Convenience: the start/end pair every play cycle produces. */
  emitPlaybackCycle(): void {
    this.emit({ type: 'start' });
    this.emit({ type: 'end' });
  }
}

export function makeTTSProviderDouble(options: FakeTTSProviderOptions = {}): FakeTTSProvider {
  return new FakeTTSProvider(options);
}

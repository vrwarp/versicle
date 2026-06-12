import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTTSStore } from './useTTSStore';

// Since Phase 5b-PR1 the store is PURE STATE: engine commands and the
// engine→store mirror live on the TtsController facade (src/app/tts/
// TtsController.ts — see TtsController.test.ts). These tests pin the pure
// state transitions only; no engine mock is needed because the store no
// longer imports the engine composition root.

describe('useTTSStore', () => {
  beforeEach(() => {
    useTTSStore.setState({
      isPlaying: false,
      status: 'stopped',
      activeLanguage: 'en',
      profiles: {
          en: { voiceId: null, rate: 1, pitch: 1, volume: 1 }
      },
      rate: 1,
      pitch: 1,
      voice: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      voices: [{ id: 'test-en', name: 'Test English', lang: 'en-US', provider: 'local' } as any]
    });
  });

  afterEach(() => {
      // Cleanup if needed
      vi.clearAllMocks();
  });

  it('should have initial state', () => {
    const state = useTTSStore.getState();
    expect(state.isPlaying).toBe(false);
    expect(state.rate).toBe(1);
    expect(state.pitch).toBe(1);
    expect(state.voice).toBeNull();
  });

  it('exposes no engine command actions (they live on TtsController)', () => {
    const state = useTTSStore.getState() as unknown as Record<string, unknown>;
    for (const legacyAction of ['play', 'pause', 'stop', 'jumpTo', 'seek', 'loadVoices', 'downloadVoice', 'deleteVoice', 'checkVoiceDownloaded', 'initialize']) {
      expect(state[legacyAction], `store must not own engine command '${legacyAction}'`).toBeUndefined();
    }
  });

  it('should set rate', () => {
    useTTSStore.getState().setRate(1.5);
    expect(useTTSStore.getState().rate).toBe(1.5);
    expect(useTTSStore.getState().profiles['en'].rate).toBe(1.5);
  });

  it('should set pitch', () => {
    useTTSStore.getState().setPitch(1.2);
    expect(useTTSStore.getState().pitch).toBe(1.2);
  });

  it('should set voice', () => {
    // Mock voice object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const voice = { id: 'test', name: 'Test Voice', lang: 'en-US', provider: 'local' } as any;
    useTTSStore.getState().setVoice(voice);
    expect(useTTSStore.getState().voice).toBe(voice);
    expect(useTTSStore.getState().profiles['en'].voiceId).toBe('test');
  });

  it('should set active language and switch profile', () => {
    useTTSStore.setState({
        profiles: {
            en: { voiceId: 'test-en', rate: 1.0, pitch: 1.0, volume: 1.0 },
            zh: { voiceId: 'test-zh', rate: 1.5, pitch: 1.2, volume: 1.0 }
        },
        voices: [
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { id: 'test-en', name: 'Test English', lang: 'en-US', provider: 'local' } as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { id: 'test-zh', name: 'Test Chinese', lang: 'zh-CN', provider: 'local' } as any
        ]
    });

    useTTSStore.getState().setActiveLanguage('zh');

    const state = useTTSStore.getState();
    expect(state.activeLanguage).toBe('zh');
    expect(state.rate).toBe(1.5);
    expect(state.pitch).toBe(1.2);
    expect(state.voice?.id).toBe('test-zh');
  });

  it('setProviderId and setApiKey are pure writes (no engine chain)', () => {
    useTTSStore.getState().setProviderId('google');
    expect(useTTSStore.getState().providerId).toBe('google');

    useTTSStore.getState().setApiKey('google', 'key-123');
    expect(useTTSStore.getState().apiKeys.google).toBe('key-123');
  });
});

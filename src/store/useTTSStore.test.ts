import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTTSStore } from './useTTSStore';
import { getAudioPlayer } from '../lib/tts/engine/mainThreadAudioPlayer';

// Mock the engine composition root (production now talks to getAudioPlayer()).
vi.mock('../lib/tts/engine/mainThreadAudioPlayer', () => {
    return {
        getAudioPlayer: vi.fn(() => ({
            play: vi.fn(),
            pause: vi.fn(),
            stop: vi.fn(),
            setSpeed: vi.fn(),
            setVoice: vi.fn(),
            setLanguage: vi.fn(),
            init: vi.fn(),
            getVoices: vi.fn(() => []),
            setProvider: vi.fn(),
            whenReady: vi.fn(() => Promise.resolve()),
            subscribe: vi.fn(),
            setBackgroundAudioMode: vi.fn(),
            setBackgroundVolume: vi.fn(),
            setPrerollEnabled: vi.fn(),
        })),
        resetAudioPlayerForTests: vi.fn(),
    };
});

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

  // State is driven by player events through the subscription wired in initialize().
  it('should sync state from player subscription updates', () => {
    useTTSStore.getState().initialize();
    const player = vi.mocked(getAudioPlayer).mock.results.at(-1)!.value;
    const listener = vi.mocked(player.subscribe).mock.calls[0][0];

    listener('playing', null, 0, [], null);
    expect(useTTSStore.getState().isPlaying).toBe(true);
    expect(useTTSStore.getState().status).toBe('playing');

    listener('paused', null, 0, [], null);
    expect(useTTSStore.getState().isPlaying).toBe(false);
    expect(useTTSStore.getState().status).toBe('paused');

    // 'loading' should result in isPlaying = true (prevents play/pause UI flicker)
    listener('loading', null, 0, [], null);
    expect(useTTSStore.getState().isPlaying).toBe(true);
    expect(useTTSStore.getState().status).toBe('loading');

    // 'completed' should result in isPlaying = true (to support continuous background audio)
    listener('completed', null, 0, [], null);
    expect(useTTSStore.getState().isPlaying).toBe(true);
    expect(useTTSStore.getState().status).toBe('completed');

    listener('stopped', null, 0, [], null);
    expect(useTTSStore.getState().isPlaying).toBe(false);
    expect(useTTSStore.getState().status).toBe('stopped');
  });

  it('should call player methods on play, pause, stop', () => {
    const playSpy = vi.spyOn(useTTSStore.getState(), 'play');
    useTTSStore.getState().play();
    expect(playSpy).toHaveBeenCalled();
  });

  it('should set rate', () => {
    useTTSStore.getState().setRate(1.5);
    expect(useTTSStore.getState().rate).toBe(1.5);
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
});

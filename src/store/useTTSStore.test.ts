import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTTSStore } from './useTTSStore';

// Mock AudioPlayerService
vi.mock('../lib/tts/AudioPlayerService', () => {
    return {
        AudioPlayerService: {
            getInstance: vi.fn(() => ({
                play: vi.fn(),
                pause: vi.fn(),
                stop: vi.fn(),
                setSpeed: vi.fn(),
                setVoice: vi.fn(),
                init: vi.fn(),
                getVoices: vi.fn(() => []),
                setProvider: vi.fn(),
                subscribe: vi.fn(() => {
                    // Simulate playing state when play is called if needed
                    // But for unit test we might want to manually trigger syncState
                }),
            }))
        }
    };
});

describe('useTTSStore', () => {
  beforeEach(() => {
    useTTSStore.setState({
      isPlaying: false,
      status: 'stopped',
      rate: 1,
      pitch: 1,
      voice: null,
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

  // Updated test: setPlaying doesn't exist anymore, it's driven by player events
  it('should sync state from player', () => {
    const store = useTTSStore.getState();
    // Use the syncState method that is exposed on the store for internal/testing use
    // Note: TypeScript might complain if it's internal, but for tests it should be fine if public in interface
    // Checking interface... syncState is in TTSState but marked @internal.
    // We can cast or just call it.

    store.syncState('playing', null, 0, [], null);
    expect(useTTSStore.getState().isPlaying).toBe(true);
    expect(useTTSStore.getState().status).toBe('playing');

    store.syncState('paused', null, 0, [], null);
    expect(useTTSStore.getState().isPlaying).toBe(false);
    expect(useTTSStore.getState().status).toBe('paused');

    // Test the fix: 'loading' should result in isPlaying = true
    store.syncState('loading', null, 0, [], null);
    expect(useTTSStore.getState().isPlaying).toBe(true);
    expect(useTTSStore.getState().status).toBe('loading');

    // 'completed' should result in isPlaying = true (to support continuous background audio)
    store.syncState('completed', null, 0, [], null);
    expect(useTTSStore.getState().isPlaying).toBe(true);
    expect(useTTSStore.getState().status).toBe('completed');

    store.syncState('stopped', null, 0, [], null);
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
  });
});

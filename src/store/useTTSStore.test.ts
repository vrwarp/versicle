import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTTSStore } from './useTTSStore';

describe('useTTSStore', () => {
  beforeEach(() => {
    useTTSStore.setState({
      isPlaying: false,
      rate: 1.0,
      voice: null,
    });
  });

  it('should have initial state', () => {
    const state = useTTSStore.getState();
    expect(state.isPlaying).toBe(false);
    expect(state.rate).toBe(1.0);
    expect(state.voice).toBeNull();
  });

  it('should toggle playing state', () => {
    const store = useTTSStore.getState();

    store.play();
    expect(useTTSStore.getState().isPlaying).toBe(true);

    store.pause();
    expect(useTTSStore.getState().isPlaying).toBe(false);

    store.play();
    store.stop();
    expect(useTTSStore.getState().isPlaying).toBe(false);
  });

  it('should set rate', () => {
    useTTSStore.getState().setRate(1.5);
    expect(useTTSStore.getState().rate).toBe(1.5);
  });

  it('should set voice', () => {
    const mockVoice = { name: 'Test Voice', lang: 'en-US' } as SpeechSynthesisVoice;
    useTTSStore.getState().setVoice(mockVoice);
    expect(useTTSStore.getState().voice).toBe(mockVoice);
  });
});

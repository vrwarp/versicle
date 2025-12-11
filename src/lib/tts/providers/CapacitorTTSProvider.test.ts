import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CapacitorTTSProvider } from './CapacitorTTSProvider';
import { TextToSpeech } from '@capacitor-community/text-to-speech';

// Mock the module
vi.mock('@capacitor-community/text-to-speech', () => ({
  TextToSpeech: {
    getSupportedVoices: vi.fn(),
    speak: vi.fn(),
    stop: vi.fn(),
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
  }
}));

describe('CapacitorTTSProvider', () => {
  let provider: CapacitorTTSProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new CapacitorTTSProvider();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should have id "local"', () => {
    expect(provider.id).toBe('local');
  });

  it('should support .on() method', () => {
    expect(typeof provider.on).toBe('function');
  });

  it('should use queueStrategy 0 (Flush) for synthesize', async () => {
    // Setup voices
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.getSupportedVoices as any).mockResolvedValue({
      voices: [{ voiceURI: 'voice1', name: 'Voice 1', lang: 'en-US' }]
    });
    // Setup speak success
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.speak as any).mockResolvedValue(undefined);

    await provider.init();

    await provider.synthesize('hello', 'voice1', 1.0);

    expect(TextToSpeech.speak).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello',
      lang: 'en-US',
      rate: 1.0,
      queueStrategy: 0 // Assert interruption strategy
    }));
  });

  it('should not support resume method', () => {
    // Resume is removed to force AudioPlayerService to restart playback
    // @ts-expect-error - Accessing property that should not exist
    expect(provider.resume).toBeUndefined();
  });

  it('should emit start and end events via monitor if speak returns immediately', async () => {
    vi.useFakeTimers();
    // Setup voices
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.getSupportedVoices as any).mockResolvedValue({
      voices: [{ voiceURI: 'voice1', name: 'Voice 1', lang: 'en-US' }]
    });
    // Setup speak success
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.speak as any).mockResolvedValue(undefined);

    await provider.init();

    const callback = vi.fn();
    provider.on(callback);

    // Call synthesize - it will start monitor
    await provider.synthesize('hello', 'voice1', 1.0);

    expect(callback).toHaveBeenCalledWith({ type: 'start' });
    // Should NOT emit end immediately
    expect(callback).not.toHaveBeenCalledWith({ type: 'end' });

    // Advance time to trigger monitor timeout
    // Estimated for 'hello' (5 chars) is 1000ms. Max duration ~3.5s.
    await vi.advanceTimersByTimeAsync(4000);

    expect(callback).toHaveBeenCalledWith({ type: 'end' });
  });

  it('should emit error event if speak fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
     (TextToSpeech.getSupportedVoices as any).mockResolvedValue({
      voices: [{ voiceURI: 'voice1', name: 'Voice 1', lang: 'en-US' }]
    });
    const error = new Error('Speak failed');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.speak as any).mockRejectedValue(error);

    await provider.init();

    const callback = vi.fn();
    provider.on(callback);

    await provider.synthesize('hello', 'voice1', 1.0);

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
        type: 'start'
    }));

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
        error: error
    }));
  });

  it('should handle AbortSignal by calling stop and NOT emitting end', async () => {
    // Mock speak to hang until stopped
    let resolveSpeak: (() => void) | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.speak as any).mockImplementation(() => {
        return new Promise<void>(resolve => {
            resolveSpeak = resolve;
        });
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.stop as any).mockImplementation(async () => {
        if (resolveSpeak) resolveSpeak();
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.getSupportedVoices as any).mockResolvedValue({
      voices: [{ voiceURI: 'voice1', name: 'Voice 1', lang: 'en-US' }]
    });

    await provider.init();

    const callback = vi.fn();
    provider.on(callback);

    const controller = new AbortController();
    const synthesizePromise = provider.synthesize('hello', 'voice1', 1.0, controller.signal);

    // Wait a bit to ensure speak is called
    await new Promise(r => setTimeout(r, 10));

    expect(TextToSpeech.speak).toHaveBeenCalled();

    // Abort
    controller.abort();

    // Wait for synthesize to return
    await synthesizePromise;

    expect(TextToSpeech.stop).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith({ type: 'start' });
    expect(callback).not.toHaveBeenCalledWith({ type: 'end' });
  });
});

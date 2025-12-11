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

  it('should emit end event asynchronously when speak promise resolves', async () => {
    // Setup voices
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.getSupportedVoices as any).mockResolvedValue({
      voices: [{ voiceURI: 'voice1', name: 'Voice 1', lang: 'en-US' }]
    });

    // Setup speak to resolve later
    let resolveSpeak: ((value: void | PromiseLike<void>) => void) | undefined;
    (TextToSpeech.speak as any).mockReturnValue(new Promise<void>(resolve => {
        resolveSpeak = resolve;
    }));

    await provider.init();

    const callback = vi.fn();
    provider.on(callback);

    // Call synthesize - returns immediately
    const result = await provider.synthesize('hello', 'voice1', 1.0);

    expect(result.isNative).toBe(true);
    expect(TextToSpeech.speak).toHaveBeenCalled();

    expect(callback).toHaveBeenCalledWith({ type: 'start' });
    expect(callback).not.toHaveBeenCalledWith({ type: 'end' });

    // Resolve speak
    resolveSpeak!();

    // Wait for promise chain
    await new Promise(r => setTimeout(r, 0));

    expect(callback).toHaveBeenCalledWith({ type: 'end' });
  });

  it('should emit error event if speak fails asynchronously', async () => {
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

    // Wait for promise chain
    await new Promise(r => setTimeout(r, 0));

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
    (TextToSpeech.speak as any).mockReturnValue(new Promise<void>(resolve => {
        resolveSpeak = resolve;
    }));
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

    // synthesizePromise resolves immediately now
    await synthesizePromise;
    expect(TextToSpeech.speak).toHaveBeenCalled();

    // Abort
    controller.abort();

    expect(TextToSpeech.stop).toHaveBeenCalled();

    // Even if speak resolves (due to stop), end should not be emitted because ID changed
    await new Promise(r => setTimeout(r, 0));

    expect(callback).toHaveBeenCalledWith({ type: 'start' });
    expect(callback).not.toHaveBeenCalledWith({ type: 'end' });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapacitorTTSProvider } from './CapacitorTTSProvider';
import { TextToSpeech } from '@capacitor-community/text-to-speech';

// Mock the module
vi.mock('@capacitor-community/text-to-speech', () => ({
  TextToSpeech: {
    getSupportedVoices: vi.fn(),
    speak: vi.fn(),
    stop: vi.fn(),
  }
}));

describe('CapacitorTTSProvider', () => {
  let provider: CapacitorTTSProvider;

  beforeEach(() => {
    provider = new CapacitorTTSProvider();
    vi.clearAllMocks();
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

  it('should emit start and end events during synthesis', async () => {
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

    await provider.synthesize('hello', 'voice1', 1.0);

    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenNthCalledWith(1, { type: 'start' });
    expect(callback).toHaveBeenNthCalledWith(2, { type: 'end' });
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

  it('should NOT emit end event if stopped manually', async () => {
    // Mock voices
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.getSupportedVoices as any).mockResolvedValue({
      voices: [{ voiceURI: 'voice1', name: 'Voice 1', lang: 'en-US' }]
    });

    let stopNativeSpeech: () => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.speak as any).mockImplementation(() => {
        return new Promise<void>(resolve => {
            stopNativeSpeech = resolve;
        });
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.stop as any).mockImplementation(() => {
        if (stopNativeSpeech) stopNativeSpeech();
    });

    await provider.init();
    const callback = vi.fn();
    provider.on(callback);

    // Start synthesis (it will block)
    const synthPromise = provider.synthesize('hello', 'voice1', 1.0);

    // Wait for start event
    await new Promise(resolve => setTimeout(resolve, 0));

    // Call stop
    await provider.stop();

    // Wait for synthesis to return
    await synthPromise;

    // Check events
    expect(callback).toHaveBeenCalledWith({ type: 'start' });
    expect(callback).not.toHaveBeenCalledWith({ type: 'end' });
  });

    it('should NOT emit end event if paused manually', async () => {
    // Mock voices
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.getSupportedVoices as any).mockResolvedValue({
      voices: [{ voiceURI: 'voice1', name: 'Voice 1', lang: 'en-US' }]
    });

    let stopNativeSpeech: () => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.speak as any).mockImplementation(() => {
        return new Promise<void>(resolve => {
            stopNativeSpeech = resolve;
        });
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.stop as any).mockImplementation(() => {
        if (stopNativeSpeech) stopNativeSpeech();
    });

    await provider.init();
    const callback = vi.fn();
    provider.on(callback);

    // Start synthesis
    const synthPromise = provider.synthesize('hello', 'voice1', 1.0);
    await new Promise(resolve => setTimeout(resolve, 0));

    // Call pause
    await provider.pause();

    await synthPromise;

    expect(callback).toHaveBeenCalledWith({ type: 'start' });
    expect(callback).not.toHaveBeenCalledWith({ type: 'end' });
  });
});

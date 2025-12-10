import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapacitorTTSProvider } from './CapacitorTTSProvider';
import { TextToSpeech } from '@capacitor-community/text-to-speech';

// Mock the module
vi.mock('@capacitor-community/text-to-speech', () => ({
  TextToSpeech: {
    getSupportedVoices: vi.fn(),
    speak: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
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

  it('should abort synthesis when signal is aborted', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.getSupportedVoices as any).mockResolvedValue({
      voices: [{ voiceURI: 'voice1', name: 'Voice 1', lang: 'en-US' }]
    });

    // Mock speak to take some time
    let finishSpeak: () => void;
    const speakPromise = new Promise<void>((resolve) => {
        finishSpeak = resolve;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.speak as any).mockImplementation(() => speakPromise);

    await provider.init();

    const callback = vi.fn();
    provider.on(callback);

    const controller = new AbortController();
    const synthesizePromise = provider.synthesize('hello', 'voice1', 1.0, controller.signal);

    // Verify start emitted
    expect(callback).toHaveBeenCalledWith({ type: 'start' });

    // Abort
    controller.abort();

    // Expect stop to be called
    expect(TextToSpeech.stop).toHaveBeenCalled();

    // Finish the speak promise (simulate native end)
    finishSpeak!();

    await synthesizePromise;

    // Expect 'interrupted' error, NOT 'end'
    expect(callback).not.toHaveBeenCalledWith({ type: 'end' });
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
        error: 'interrupted'
    }));
  });
});

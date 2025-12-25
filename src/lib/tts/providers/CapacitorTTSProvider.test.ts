import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CapacitorTTSProvider } from './CapacitorTTSProvider';
import { TextToSpeech } from '@capacitor-community/text-to-speech';

// Mock the module
vi.mock('@capacitor-community/text-to-speech', () => ({
  TextToSpeech: {
    getSupportedVoices: vi.fn(),
    speak: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
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

  it('should use queueStrategy 0 (Flush) for play without preload', async () => {
    // Setup voices
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.getSupportedVoices as any).mockResolvedValue({
      voices: [{ voiceURI: 'voice1', name: 'Voice 1', lang: 'en-US' }]
    });
    // Setup speak success
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.speak as any).mockResolvedValue(undefined);

    await provider.init();

    await provider.play('hello', { voiceId: 'voice1', speed: 1.0 });

    expect(TextToSpeech.speak).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello',
      lang: 'en-US',
      rate: 1.0,
      queueStrategy: 0 // Assert interruption strategy
    }));
  });

  it('should use queueStrategy 1 (Add) for preload', async () => {
     // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.getSupportedVoices as any).mockResolvedValue({
      voices: [{ voiceURI: 'voice1', name: 'Voice 1', lang: 'en-US' }]
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.speak as any).mockResolvedValue(undefined);

    await provider.init();
    await provider.preload('next sentence', { voiceId: 'voice1', speed: 1.0 });

    expect(TextToSpeech.speak).toHaveBeenCalledWith(expect.objectContaining({
        text: 'next sentence',
        queueStrategy: 1
    }));
  });

  it('should perform Smart Handoff when eligible', async () => {
     // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.getSupportedVoices as any).mockResolvedValue({
      voices: [{ voiceURI: 'voice1', name: 'Voice 1', lang: 'en-US' }]
    });

    let resolveSentence1: () => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.speak as any).mockImplementation((options: any) => {
        if (options.text === 'Sentence 1') {
            return new Promise<void>(r => resolveSentence1 = r);
        }
        if (options.text === 'Sentence 2') {
             return Promise.resolve(); // Resolves immediately for test simplicity
        }
        return Promise.resolve();
    });

    await provider.init();
    const eventSpy = vi.fn();
    provider.on(eventSpy);

    // 1. Play Sentence 1
    await provider.play('Sentence 1', { voiceId: 'voice1', speed: 1.0 });

    // 2. Preload Sentence 2
    await provider.preload('Sentence 2', { voiceId: 'voice1', speed: 1.0 });

    // Check that preload called speak with Add
    expect(TextToSpeech.speak).toHaveBeenLastCalledWith(expect.objectContaining({
        text: 'Sentence 2',
        queueStrategy: 1
    }));

    // 3. Finish Sentence 1
    resolveSentence1!();
    await new Promise(r => setTimeout(r, 0)); // Allow promise chain to settle

    // Assert Sentence 1 finished naturally (end event)
    expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'end' }));

    // Reset spy to track Sentence 2 events clearly
    eventSpy.mockClear();

    // 4. Play Sentence 2
    // Clear speak mock to ensure it's NOT called again
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.speak as any).mockClear();

    await provider.play('Sentence 2', { voiceId: 'voice1', speed: 1.0 });

    // Assert: NO new speak call
    expect(TextToSpeech.speak).not.toHaveBeenCalled();

    // Assert: Immediate start event
    expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'start' }));

    // Wait for the preloaded promise to resolve
    await new Promise(r => setTimeout(r, 0));
    expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'end' }));
  });

  it('should fallback to Flush if content does not match preload', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.getSupportedVoices as any).mockResolvedValue({
      voices: [{ voiceURI: 'voice1', name: 'Voice 1', lang: 'en-US' }]
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.speak as any).mockResolvedValue(undefined);

    await provider.init();

    // 1. Play Sentence 1 (Finish it so natural flow is true)
    await provider.play('Sentence 1', { voiceId: 'voice1', speed: 1.0 });
    await new Promise(r => setTimeout(r, 0)); // finish it

    // 2. Preload Sentence 2
    await provider.preload('Sentence 2', { voiceId: 'voice1', speed: 1.0 });

    // 3. Play DIFFERENT sentence (Seek/Jump)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.speak as any).mockClear();

    await provider.play('Sentence 3', { voiceId: 'voice1', speed: 1.0 });

    // Assert: Stop called, Speak called with Flush
    expect(TextToSpeech.stop).toHaveBeenCalled();
    expect(TextToSpeech.speak).toHaveBeenCalledWith(expect.objectContaining({
        text: 'Sentence 3',
        queueStrategy: 0
    }));
  });

  it('should fallback to Flush if previous sentence interrupted (not natural flow)', async () => {
     // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.getSupportedVoices as any).mockResolvedValue({
      voices: [{ voiceURI: 'voice1', name: 'Voice 1', lang: 'en-US' }]
    });

    // Mock speak to NOT resolve immediately (simulating playing)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.speak as any).mockReturnValue(new Promise(() => {}));

    await provider.init();

    // 1. Play Sentence 1 (It stays playing)
    await provider.play('Sentence 1', { voiceId: 'voice1', speed: 1.0 });

    // 2. Preload Sentence 2
    await provider.preload('Sentence 2', { voiceId: 'voice1', speed: 1.0 });

    // 3. Play Sentence 2 (User skipped Sentence 1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.speak as any).mockClear();

    await provider.play('Sentence 2', { voiceId: 'voice1', speed: 1.0 });

    // Assert: Stop called (to kill S1 and the queued S2), then Speak S2 with Flush
    expect(TextToSpeech.stop).toHaveBeenCalled();
    expect(TextToSpeech.speak).toHaveBeenCalledWith(expect.objectContaining({
        text: 'Sentence 2',
        queueStrategy: 0
    }));
  });

  it('should support resume method (by restarting)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.getSupportedVoices as any).mockResolvedValue({
      voices: [{ voiceURI: 'voice1', name: 'Voice 1', lang: 'en-US' }]
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.speak as any).mockResolvedValue(undefined);

    await provider.init();
    await provider.play('hello', { voiceId: 'voice1', speed: 1.0 });

    // Clear speak mock
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.speak as any).mockClear();

    provider.resume();

    // Since play is async and awaited inside resume (but resume is void),
    // we need to wait a bit for the async operations to complete.
    await new Promise(r => setTimeout(r, 10));

    expect(TextToSpeech.speak).toHaveBeenCalledWith(expect.objectContaining({
        text: 'hello'
    }));
  });

  it('should resume the same text after pause', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.getSupportedVoices as any).mockResolvedValue({
      voices: [{ voiceURI: 'voice1', name: 'Voice 1', lang: 'en-US' }]
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.speak as any).mockResolvedValue(undefined);

    await provider.init();
    await provider.play('hello', { voiceId: 'voice1', speed: 1.0 });

    provider.pause();

    // Clear speak mock
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.speak as any).mockClear();

    provider.resume();

    // Wait for async operations
    await new Promise(r => setTimeout(r, 10));

    expect(TextToSpeech.speak).toHaveBeenCalledWith(expect.objectContaining({
        text: 'hello'
    }));
  });

  it('should emit end event asynchronously when speak promise resolves', async () => {
    // Setup voices
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.getSupportedVoices as any).mockResolvedValue({
      voices: [{ voiceURI: 'voice1', name: 'Voice 1', lang: 'en-US' }]
    });

    // Setup speak to resolve later
    let resolveSpeak: ((value: void | PromiseLike<void>) => void) | undefined;

    // Use mockImplementation to create a fresh promise on call
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.speak as any).mockImplementation(() => {
        return new Promise<void>(resolve => {
            resolveSpeak = resolve;
        });
    });

    await provider.init();

    const callback = vi.fn();
    provider.on(callback);

    // Call play - returns immediately (resolves on start)
    const playPromise = provider.play('hello', { voiceId: 'voice1', speed: 1.0 });

    await playPromise;

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

    await provider.play('hello', { voiceId: 'voice1', speed: 1.0 });

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

  it('should ignore callback if stopped before speak finishes', async () => {
    // Mock speak to hang until stopped
    let resolveSpeak: (() => void) | null = null;

    // Use mockImplementation so promise is created when speak is called
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

    await provider.play('hello', { voiceId: 'voice1', speed: 1.0 });

    expect(TextToSpeech.speak).toHaveBeenCalled();

    // Stop
    provider.stop();

    expect(TextToSpeech.stop).toHaveBeenCalled();

    // Even if speak resolves (due to stop), end should not be emitted because ID changed
    await new Promise(r => setTimeout(r, 0));

    expect(callback).toHaveBeenCalledWith({ type: 'start' });
    expect(callback).not.toHaveBeenCalledWith({ type: 'end' });
  });

  it('should ignore stray events from previous utterance (race condition)', async () => {
    let onRangeStartCallback: (info: { start: number; end: number; word: string }) => void;

    // Capture the listener
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.addListener as any).mockImplementation((event: string, callback: any) => {
      if (event === 'onRangeStart') {
        onRangeStartCallback = callback;
      }
      return Promise.resolve({ remove: vi.fn() });
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.speak as any).mockResolvedValue(undefined);

    await provider.init();
    const eventSpy = vi.fn();
    provider.on(eventSpy);

    // 1. Play Chapter 1 (Long)
    await provider.play('A long chapter one text...', { voiceId: 'v1', speed: 1 });

    // 2. Play Chapter 2 (Short)
    await provider.play('Short', { voiceId: 'v1', speed: 1 });

    // 3. Simulate stray event from Chapter 1 (index 10, which is > length of "Short")
    if (onRangeStartCallback!) {
      onRangeStartCallback({ start: 10, end: 15, word: 'chapter' });
    }

    // 4. Assert that no boundary event was emitted for index 10
    expect(eventSpy).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'boundary',
      charIndex: 10
    }));
  });

  it('should remove existing listener on init to prevent leaks', async () => {
     const removeSpy = vi.fn();
     // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.addListener as any).mockResolvedValue({ remove: removeSpy });

    await provider.init();

    // Call init again
    await provider.init();

    expect(removeSpy).toHaveBeenCalled();
  });
});

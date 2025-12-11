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

describe('CapacitorTTSProvider Race Condition', () => {
  let provider: CapacitorTTSProvider;

  beforeEach(() => {
    provider = new CapacitorTTSProvider();
    vi.clearAllMocks();
  });

  it('synthesize should wait for stop() to complete when aborted', async () => {
    // Setup voices
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.getSupportedVoices as any).mockResolvedValue({
      voices: [{ voiceURI: 'voice1', name: 'Voice 1', lang: 'en-US' }]
    });

    let resolveStop: (() => void) | null = null;
    let resolveSpeak: (() => void) | null = null;

    // Mock speak to block until stopped
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.speak as any).mockImplementation(() => {
        return new Promise<void>(resolve => {
           resolveSpeak = resolve;
        });
    });

    // Mock stop to be slow and also trigger speak completion
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (TextToSpeech.stop as any).mockImplementation(() => {
        // When stop is called, we assume it triggers the end of speech on the native side
        if (resolveSpeak) resolveSpeak();

        return new Promise<void>(resolve => {
            resolveStop = resolve;
        });
    });

    await provider.init();

    const controller = new AbortController();

    // Start synthesize
    const synthPromise = provider.synthesize('hello', 'voice1', 1.0, controller.signal);

    // Give it a tick to start
    await new Promise(r => setTimeout(r, 0));

    // Abort
    controller.abort();

    // Check resolution status
    let resolved = false;
    synthPromise.then(() => { resolved = true; });

    // Wait a small amount of time.
    // Since stop() promise (resolveStop) is still pending, synthPromise should be pending.
    await new Promise(r => setTimeout(r, 10));

    expect(resolved).toBe(false);

    // Now finish stop
    if (resolveStop) resolveStop();

    // Wait for synth to finish
    await synthPromise;
    expect(resolved).toBe(true);
  });
});

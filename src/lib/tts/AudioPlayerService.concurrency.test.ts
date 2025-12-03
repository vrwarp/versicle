import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';

// Mock Dependencies using hoisted implementation
const mockSynthesize = vi.fn().mockImplementation(async (text, voice, speed, signal) => {
    // Simulate some async work
    await new Promise(resolve => setTimeout(resolve, 50));
    if (signal?.aborted) return { isNative: true };
    return { isNative: true };
});

vi.mock('./providers/WebSpeechProvider', () => {
  return {
    WebSpeechProvider: class {
      id = 'local';
      init = vi.fn().mockResolvedValue(undefined);
      getVoices = vi.fn().mockResolvedValue([]);
      stop = vi.fn();
      pause = vi.fn();
      resume = vi.fn();
      on = vi.fn();
      synthesize = mockSynthesize;
    }
  };
});

vi.mock('./TTSCache', () => {
  return {
    TTSCache: class {
      generateKey = vi.fn().mockResolvedValue('key');
      get = vi.fn().mockImplementation(async () => {
           await new Promise(resolve => setTimeout(resolve, 10));
           return null;
      });
      put = vi.fn().mockResolvedValue(undefined);
    }
  };
});

vi.mock('../../db/DBService', () => ({
    dbService: {
        getBookMetadata: vi.fn().mockResolvedValue(null),
        updatePlaybackState: vi.fn().mockResolvedValue(undefined),
    }
}));

vi.mock('./LexiconService', () => ({
    LexiconService: {
        getInstance: () => ({
            getRules: vi.fn().mockResolvedValue([]),
            applyLexicon: vi.fn((text) => text),
            getRulesHash: vi.fn().mockResolvedValue('hash')
        })
    }
}));

describe('AudioPlayerService Concurrency', () => {
    let service: AudioPlayerService;

    beforeEach(() => {
        vi.useFakeTimers();
        // Reset singleton
        // @ts-expect-error Resetting singleton
        AudioPlayerService.instance = undefined;
        service = AudioPlayerService.getInstance();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('should implement "Last Writer Wins" on rapid play() calls', async () => {
        // Since we are reusing the mocked function across instances, we can spy on it directly?
        // No, mockSynthesize is already a spy.

        service.setQueue([
            { text: "Sentence 1", cfi: "cfi1" },
            { text: "Sentence 2", cfi: "cfi2" }
        ]);

        // Trigger 3 rapid play calls
        const p1 = service.play();
        const p2 = service.play();
        const p3 = service.play();

        // Fast-forward time to allow promises to settle
        await vi.advanceTimersByTimeAsync(100);

        await Promise.allSettled([p1, p2, p3]);

        // Only the last call should succeed in calling synthesize
        expect(mockSynthesize).toHaveBeenCalledTimes(1);
        expect(mockSynthesize).toHaveBeenCalledWith("Sentence 1", expect.any(String), expect.any(Number), expect.any(AbortSignal));
    });

    it('should abort playback if stopped while loading', async () => {
        service.setQueue([{ text: "Test", cfi: "1" }]);

        const playPromise = service.play();

        // Immediately stop
        service.stop();

        await vi.advanceTimersByTimeAsync(100);
        await playPromise;

        // Should not have called synthesize because stop() cancels current operation
        expect(mockSynthesize).not.toHaveBeenCalled();
        // @ts-expect-error Access private
        expect(service.status).toBe('stopped');
    });

    it('should abort playback if paused while loading', async () => {
        service.setQueue([{ text: "Test", cfi: "1" }]);

        const playPromise = service.play();

        // Immediately pause
        service.pause();

        await vi.advanceTimersByTimeAsync(100);
        await playPromise;

        expect(mockSynthesize).not.toHaveBeenCalled();
        // @ts-expect-error Access private
        expect(service.status).toBe('paused');
    });

    it('should pass abort signal to provider', async () => {
        service.setQueue([{ text: "Long text", cfi: "1" }]);

        const p1 = service.play();

        // Wait for getRules to finish but before synthesize completes
        await vi.advanceTimersByTimeAsync(1);

        // Synthesize called for p1
        expect(mockSynthesize).toHaveBeenCalledTimes(1);

        // Trigger p2, which aborts p1
        const p2 = service.play();

        // Inspect the signal passed to p1
        const callArgs = mockSynthesize.mock.calls[0];
        const signal = callArgs[3] as AbortSignal;
        expect(signal).toBeDefined();
        expect(signal.aborted).toBe(true);

        await vi.advanceTimersByTimeAsync(100);
        await Promise.all([p1, p2]);
    });
});

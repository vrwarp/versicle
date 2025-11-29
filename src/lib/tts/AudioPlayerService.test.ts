import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';

// Mock WebSpeechProvider class
vi.mock('./providers/WebSpeechProvider', () => {
  return {
    WebSpeechProvider: class {
      init = vi.fn().mockResolvedValue(undefined);
      getVoices = vi.fn().mockResolvedValue([]);
      synthesize = vi.fn();
      stop = vi.fn();
      on = vi.fn();
    }
  };
});

// Mock TTSCache class
vi.mock('./TTSCache', () => {
  return {
    TTSCache: class {
      generateKey = vi.fn().mockResolvedValue('key');
      get = vi.fn().mockResolvedValue(null);
      put = vi.fn().mockResolvedValue(undefined);
    }
  };
});

// Mock CostEstimator
vi.mock('./CostEstimator', () => {
    return {
        CostEstimator: {
            getInstance: vi.fn(() => ({
                track: vi.fn()
            }))
        }
    }
});


describe('AudioPlayerService', () => {
    let service: AudioPlayerService;

    beforeEach(() => {
        // Reset singleton
        // @ts-expect-error Resetting singleton for testing
        AudioPlayerService.instance = undefined;
        service = AudioPlayerService.getInstance();
    });

    it('should be a singleton', () => {
        const s2 = AudioPlayerService.getInstance();
        expect(s2).toBe(service);
    });

    it('should notify listeners on subscribe', () => {
        return new Promise<void>((resolve) => {
            service.subscribe((status, activeCfi, currentIndex, queue, error) => {
                expect(status).toBe('stopped');
                expect(error).toBeNull();
                resolve();
            });
        });
    });

    it('should handle fallback from cloud to local on error', async () => {
        // Setup a mock cloud provider that fails
        const mockCloudProvider = {
            id: 'cloud',
            init: vi.fn().mockResolvedValue(undefined),
            getVoices: vi.fn().mockResolvedValue([]),
            synthesize: vi.fn().mockRejectedValue(new Error("API Quota Exceeded")),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;

        // Force provider to be cloud
        service.setProvider(mockCloudProvider);

        // Setup queue
        service.setQueue([{ text: "Hello", cfi: "cfi1" }]);

        // Listener to catch error notification
        const listener = vi.fn();
        service.subscribe(listener);

        // Spy on setProvider to verify fallback
        const setProviderSpy = vi.spyOn(service, 'setProvider');
        // Spy on play to verify retry (recursive call)
        vi.spyOn(service, 'play');
        // Use real console.warn to avoid clutter but let's spy it to ensure it logs
        const consoleSpy = vi.spyOn(console, 'warn');

        await service.play();

        // Check if fallback happened
        expect(setProviderSpy).toHaveBeenCalled();
        // The last call to setProvider should be with WebSpeechProvider (or we verify instance type if we could)
        // Since we mock WebSpeechProvider class, we can check if it was instantiated?
        // But verifying setProvider called is good enough.

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Falling back"));

        // Verify listener got error
        // The listener is called multiple times:
        // 1. Initial subscribe (stopped, null)
        // 2. play start (loading, null)
        // 3. fallback error (loading, "Cloud voice failed...")
        // 4. retry play (loading, null) or whatever next state

        // Just check if any call had the error message
        const errorCalls = listener.mock.calls.filter(args => args[4] && args[4].includes("Cloud voice failed"));
        expect(errorCalls.length).toBeGreaterThan(0);
        expect(errorCalls[0][4]).toContain("API Quota Exceeded");
    });
});

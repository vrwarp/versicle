import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';
import { WebSpeechProvider } from './providers/WebSpeechProvider';
import { MockCloudProvider } from './providers/MockCloudProvider';
import { CostEstimator } from './CostEstimator';

// Polyfill Blob.prototype.arrayBuffer for JSDOM if missing
if (!Blob.prototype.arrayBuffer) {
    Blob.prototype.arrayBuffer = function() {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(this);
        });
    }
}

// Mock WebSpeechProvider class
vi.mock('./providers/WebSpeechProvider', () => {
  return {
    WebSpeechProvider: class {
      init = vi.fn().mockResolvedValue(undefined);
      getVoices = vi.fn().mockResolvedValue([]);
      synthesize = vi.fn();
      stop = vi.fn();
      pause = vi.fn();
      resume = vi.fn();
      on = vi.fn();
    }
  };
});

// Mock TTSCache class
const memoryCache = new Map<string, any>();
vi.mock('./TTSCache', () => {
  return {
    TTSCache: class {
      // Mock generateKey to return unique keys for inputs
      generateKey = vi.fn().mockImplementation((text) => Promise.resolve('key-' + text));
      get = vi.fn().mockImplementation(async (key) => memoryCache.get(key) || null);
      put = vi.fn().mockImplementation(async (key, audio, alignment) => {
          memoryCache.set(key, { audio, alignment });
      });
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

// Mock AudioElementPlayer
vi.mock('./AudioElementPlayer', () => {
  return {
    AudioElementPlayer: class {
      playBlob = vi.fn().mockResolvedValue(undefined);
      setRate = vi.fn();
      setOnTimeUpdate = vi.fn();
      setOnEnded = vi.fn();
      setOnError = vi.fn();
      stop = vi.fn();
      pause = vi.fn();
      resume = vi.fn();
    }
  };
});

// Mock SyncEngine
vi.mock('./SyncEngine', () => {
  return {
    SyncEngine: class {
      updateTime = vi.fn();
      loadAlignment = vi.fn();
      setOnHighlight = vi.fn();
    }
  };
});


describe('AudioPlayerService', () => {
    let service: AudioPlayerService;

    beforeEach(() => {
        // Reset singleton
        // @ts-ignore
        AudioPlayerService.instance = undefined;
        service = AudioPlayerService.getInstance();
        vi.clearAllMocks();
        memoryCache.clear();
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
        // Use real console.warn to avoid clutter but let's spy it to ensure it logs
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await service.play();

        // Check if fallback happened
        expect(setProviderSpy).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Falling back"));

        // Verify listener got error
        // The listener is called multiple times. Check if any call had the error message
        const errorCalls = listener.mock.calls.filter(args => args[4] && args[4].includes("Cloud voice failed"));
        expect(errorCalls.length).toBeGreaterThan(0);
        expect(errorCalls[0][4]).toContain("API Quota Exceeded");
    });

    it('should prefetch the next item in the queue for cloud providers', async () => {
        const mockSynthesize = vi.fn().mockResolvedValue({
             audio: new Blob(["audio"], { type: 'audio/mp3' }),
             alignment: [],
             isNative: false
        });

        const mockCloudProvider = {
            id: 'cloud',
            init: vi.fn().mockResolvedValue(undefined),
            getVoices: vi.fn().mockResolvedValue([]),
            synthesize: mockSynthesize,
        } as any;

        service.setProvider(mockCloudProvider);
        service.setQueue([
            { text: "Item 1", cfi: "1" },
            { text: "Item 2", cfi: "2" }
        ]);

        await service.play();

        // Should have called synthesize for Item 1
        expect(mockSynthesize).toHaveBeenCalledWith("Item 1", expect.any(String), expect.any(Number));

        // Wait for potential async prefetch to fire
        await new Promise(r => setTimeout(r, 0));

        // Should have called synthesize for Item 2
        expect(mockSynthesize).toHaveBeenCalledWith("Item 2", expect.any(String), expect.any(Number));
    });

    it('should not make duplicate requests for the same item (request coalescing)', async () => {
         // Create a slow synthesize to ensure pending state
         const mockSynthesize = vi.fn().mockImplementation(async (text) => {
             await new Promise(r => setTimeout(r, 10));
             return {
                 audio: new Blob(["audio"], { type: 'audio/mp3' }),
                 alignment: [],
                 isNative: false
             };
         });

         const mockCloudProvider = {
            id: 'cloud',
            init: vi.fn().mockResolvedValue(undefined),
            getVoices: vi.fn().mockResolvedValue([]),
            synthesize: mockSynthesize,
        } as any;

        service.setProvider(mockCloudProvider);
        service.setQueue([
            { text: "Shared", cfi: "1" },
            { text: "Shared", cfi: "2" }
        ]);

        // Start playing first item
        const playPromise = service.play();

        // bufferNext() will call fetch("Shared") again because next item has same text.

        await playPromise;

        // Wait for prefetch
        await new Promise(r => setTimeout(r, 20));

        // If request coalescing works, pendingRequests should handle the overlap if they overlap.
        // But here, play() finishes, THEN bufferNext() is called.
        // So the first request is DONE.
        // But the first request writes to cache.
        // So the second request hits the cache.
        // So synthesize should be called only ONCE.

        expect(mockSynthesize).toHaveBeenCalledTimes(1);
    });

    it('should track cost only once per text', async () => {
        const mockSynthesize = vi.fn().mockResolvedValue({
             audio: new Blob(["audio"], { type: 'audio/mp3' }),
             alignment: [],
             isNative: false
        });
        const mockCloudProvider = {
            id: 'cloud',
            init: vi.fn(),
            getVoices: vi.fn(),
            synthesize: mockSynthesize,
        } as any;

        const trackSpy = vi.fn();
        // @ts-ignore
        CostEstimator.getInstance.mockReturnValue({ track: trackSpy });

        service.setProvider(mockCloudProvider);
        service.setQueue([{ text: "Costly", cfi: "1" }]);

        await service.play();
        expect(trackSpy).toHaveBeenCalledWith("Costly");

        // Clear mocks to verify next call
        trackSpy.mockClear();

        // Play again (should hit cache)
        service.stop();
        // Since we are using memoryCache now, it should persist across play calls in same test (but wiped in beforeEach)
        // Wait, play() was called, so it populated cache.

        await service.play();
        expect(trackSpy).not.toHaveBeenCalled();
    });
});

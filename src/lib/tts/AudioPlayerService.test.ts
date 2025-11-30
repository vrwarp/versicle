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

// Mock useTTSStore
vi.mock('../../store/useTTSStore', () => ({
    useTTSStore: {
        getState: vi.fn(() => ({
            lastPauseTime: null,
            setLastPauseTime: vi.fn(),
        }))
    }
}));


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

    it('should transition to completed status when queue finishes', async () => {
        service.setQueue([{ text: "Test", cfi: "cfi1" }]);

        // Mock provider synthesize to return immediately (or use WebSpeechProvider mock)
        // Since we are using mock WebSpeechProvider, it doesn't really play unless we mock `synthesize` to behave nicely?
        // Actually, playNext is internal. We can trigger it by simulating 'end' event.

        // We can expose a way to trigger events on the mock provider,
        // OR we can just test playNext if we could access it, but it's private.
        // Instead, we rely on the fact that AudioPlayerService subscribes to provider events.

        // Let's get the provider instance and trigger 'end'.
        // But provider is private.
        // We can use setProvider to inject a mock that we control.

        const mockProvider = {
            init: vi.fn(),
            getVoices: vi.fn().mockResolvedValue([]),
            synthesize: vi.fn(),
            on: vi.fn(),
            stop: vi.fn()
        };

        // Capture the event listener passed to provider.on
        let eventHandler: any;
        mockProvider.on.mockImplementation((handler) => {
            eventHandler = handler;
        });

        // @ts-expect-error - setProvider accepts ITTSProvider
        service.setProvider(mockProvider);

        // Initialize service (setupWebSpeech called in constructor, but setProvider calls it again for WebSpeechProvider type)
        // Wait, setProvider checks instanceof WebSpeechProvider. Our mock isn't instanceof WebSpeechProvider.
        // So it treats it as Cloud provider if we are not careful.
        // Actually, AudioPlayerService.ts: if (provider instanceof WebSpeechProvider) ... else setupCloudPlayback()

        // We need our mock to pass instanceof check or we need to simulate cloud playback end.
        // Simulating cloud playback end involves AudioPlayer mock.

        // Let's use the WebSpeechProvider mock that was established in vi.mock at top of file.
        // The mock in vi.mock replaces the import. So any new WebSpeechProvider() is our mock.

        // Re-instantiate service to get fresh WebSpeechProvider
        // @ts-expect-error Resetting singleton
        AudioPlayerService.instance = undefined;
        service = AudioPlayerService.getInstance();

        // The provider inside service is now our Mock class instance.
        // Accessing private provider is hard.
        // But we can use `play()` and wait for `synthesize`?

        // Alternative: playNext is called when `audioPlayer` ends (cloud) or `provider` ends (local).
        // Let's rely on `play()` behavior.

        // 1. Set Queue with 1 item.
        service.setQueue([{ text: "Only Item", cfi: "cfi1" }]);

        // 2. Play
        await service.play();

        // 3. Status should be 'playing' (or 'loading' then 'playing')
        // But since our mock synthesize does nothing, it might stay loading?
        // WebSpeechProvider mock `synthesize` is vi.fn().

        // To test "Queue Finished", we need `playNext` to be called.
        // `playNext` is called when provider emits 'end'.

        // We need to trigger 'end' event on the provider.
        // Since we mocked WebSpeechProvider class, we can modify the prototype or the instance?
        // The `on` method was mocked.

        // We can spy on the `WebSpeechProvider.prototype.on` before creating service?
        // No, `vi.mock` factory runs before tests.

        // Let's look at how we can capture the listener.
        // The mock class definition:
        // WebSpeechProvider: class { on = vi.fn(); ... }

        // We can spy on the mock class instance methods?
        // When `new WebSpeechProvider()` is called, it returns an object.
        // We don't have reference to that object easily unless we spy on constructor?
        // Or we use `vi.spyOn(service, 'playNext')`? No, private.

        // Best bet: use `setProvider` with a custom object that we say IS a WebSpeechProvider.
        // In JS/TS testing, we can cast.

        const mockLocalProvider = {
            init: vi.fn(),
            getVoices: vi.fn().mockResolvedValue([]),
            synthesize: vi.fn(),
            stop: vi.fn(),
            on: vi.fn(),
            // Mocking instanceof check is tricky.
            // Usually we just assume the default provider (WebSpeech) is used.
        };

        // Hack: Overwrite the provider property (private)
        // @ts-expect-error Access private
        service.provider = mockLocalProvider;
        // @ts-expect-error Access private
        service.setupWebSpeech();

        // Capture listener
        // The mock provider is passed to setProvider.
        // setProvider calls init() and sets up WebSpeech listeners if it is an instance of WebSpeechProvider.
        // But our mockLocalProvider is NOT an instance of WebSpeechProvider (it's a plain object).
        // So setupWebSpeech() is NOT called. Instead setupCloudPlayback() is called.

        // We need to make sure AudioPlayerService treats it as WebSpeechProvider.
        // We can do this by modifying the provider prototype or just casting/forcing logic.

        // Actually, the AudioPlayerService code uses `instanceof`.
        // We can't easily mock `instanceof` for a plain object unless we use the Mock class.

        // Let's use the actual Mock class we defined in vi.mock
        const { WebSpeechProvider } = await import('./providers/WebSpeechProvider');
        const mockInstance = new WebSpeechProvider() as any;

        service.setProvider(mockInstance);

        // Now setupWebSpeech() should have been called on mockInstance.
        // mockInstance.on should have been called.

        expect(mockInstance.on).toHaveBeenCalled();

        const onCall = mockInstance.on.mock.calls[0];
        const listener = onCall[0];

        // Set queue with 1 item
        service.setQueue([{ text: "1", cfi: "1" }]);

        // IMPORTANT: We need to set status to 'playing' or something other than 'stopped'
        // because playNext() has a check: if (this.status !== 'stopped')
        // We can cheat by calling play() but since synthesize is mocked and doesn't do anything,
        // status might stay 'loading'.
        // Or we can manually set it.

        // Let's call play().
        await service.play();
        // Status should be loading (as per code: play calls setStatus('loading'))

        // Trigger 'end' event
        // This should trigger playNext().
        // Since index 0 is last item (length 1), it should stop/complete.

        // Spy on notifyListeners
        // @ts-expect-error Access private
        const notifySpy = vi.spyOn(service, 'notifyListeners');

        listener({ type: 'end' });

        // Check status
        // @ts-expect-error Access private
        expect(service.status).toBe('completed');
        expect(notifySpy).toHaveBeenCalledWith(null);
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

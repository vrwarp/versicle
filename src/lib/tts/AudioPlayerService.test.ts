import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';
import { BackgroundAudio } from './BackgroundAudio';

// Mock WebSpeechProvider class
vi.mock('./providers/WebSpeechProvider', () => {
  return {
    WebSpeechProvider: class {
      id = 'local';
      init = vi.fn().mockResolvedValue(undefined);
      getVoices = vi.fn().mockResolvedValue([]);
      play = vi.fn().mockResolvedValue(undefined);
      preload = vi.fn();
      stop = vi.fn();
      on = vi.fn();
      setConfig = vi.fn();
      pause = vi.fn();
      resume = vi.fn();
    }
  };
});

// Mock CapacitorTTSProvider class
vi.mock('./providers/CapacitorTTSProvider', () => {
    return {
        CapacitorTTSProvider: class {
            id = 'local';
            init = vi.fn().mockResolvedValue(undefined);
            getVoices = vi.fn().mockResolvedValue([]);
            play = vi.fn().mockResolvedValue(undefined);
            preload = vi.fn();
            stop = vi.fn();
            on = vi.fn();
            pause = vi.fn();
            resume = vi.fn();
        }
    }
});

// Mock Dependencies
vi.mock('./SyncEngine');
vi.mock('./LexiconService', () => ({
    LexiconService: {
        getInstance: vi.fn(() => ({
            getRules: vi.fn().mockResolvedValue([]),
            applyLexicon: vi.fn((text) => text),
            getRulesHash: vi.fn().mockResolvedValue('hash')
        }))
    }
}));
vi.mock('./MediaSessionManager');
vi.mock('../../db/DBService', () => ({
  dbService: {
    getBookMetadata: vi.fn().mockResolvedValue({}),
    updatePlaybackState: vi.fn().mockResolvedValue(undefined),
    getTTSState: vi.fn().mockResolvedValue(null),
    saveTTSState: vi.fn(),
    updateReadingHistory: vi.fn(),
    getSections: vi.fn().mockResolvedValue([]),
    getContentAnalysis: vi.fn(),
    getTTSContent: vi.fn(),
  }
}));
vi.mock('./CostEstimator');

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
        // Use the WebSpeechProvider mock class to create a mock instance that passes instanceof checks
        const { WebSpeechProvider } = await import('./providers/WebSpeechProvider');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mockInstance = new WebSpeechProvider() as any;

        await service.setProvider(mockInstance);

        // Ensure listeners registered
        expect(mockInstance.on).toHaveBeenCalled();

        const onCall = mockInstance.on.mock.calls[0];
        const listener = onCall[0];

        // Set queue with 1 item
        await service.setQueue([{ text: "1", cfi: "1" }]);

        // Call play() to set status to 'loading'/'playing'
        void service.play();

        // Wait for play to finish calling provider.play
        await new Promise(resolve => setTimeout(resolve, 0));

        // Spy on notifyListeners to verify outcome
        // @ts-expect-error Access private method
        const notifySpy = vi.spyOn(service, 'notifyListeners');

        // Trigger 'end' event on the provider listener
        listener({ type: 'end' });

        // Wait for playNext logic
        await new Promise(resolve => setTimeout(resolve, 0));

        // Check status transition
        // @ts-expect-error Access private property
        expect(service.status).toBe('completed');
        expect(notifySpy).toHaveBeenCalledWith(null);
    });

    it('should handle fallback from cloud to local on error', async () => {
        // Setup a mock cloud provider that fails
        const mockCloudProvider = {
            id: 'cloud',
            init: vi.fn().mockResolvedValue(undefined),
            getVoices: vi.fn().mockResolvedValue([]),
            play: vi.fn().mockRejectedValue(new Error("API Quota Exceeded")),
            preload: vi.fn(),
            on: vi.fn(),
            stop: vi.fn(),
            pause: vi.fn(),
            resume: vi.fn(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;

        // Force provider to be cloud
        await service.setProvider(mockCloudProvider);

        // Setup queue
        await service.setQueue([{ text: "Hello", cfi: "cfi1" }]);

        // Listener to catch error notification
        const listener = vi.fn();
        service.subscribe(listener);

        // Spy on play to verify retry (recursive call)
        vi.spyOn(service, 'play');
        const consoleSpy = vi.spyOn(console, 'warn');

        await service.play();

        // Wait for async fallback logic
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Falling back"));

        // Verify listener got error notification
        const errorCalls = listener.mock.calls.filter(args => args[4] && args[4].includes("Cloud voice failed"));
        expect(errorCalls.length).toBeGreaterThan(0);
        expect(errorCalls[0][4]).toContain("API Quota Exceeded");
    });

    it('should continue playing background audio when status becomes completed', async () => {
        const playSpy = vi.spyOn(BackgroundAudio.prototype, 'play');
        const forceStopSpy = vi.spyOn(BackgroundAudio.prototype, 'forceStop');

        // Ensure we are in a playing state
        // @ts-expect-error Access private
        service.setStatus('playing');

        expect(playSpy).toHaveBeenCalled();
        playSpy.mockClear();

        // Transition to completed
        // @ts-expect-error Access private
        service.setStatus('completed');

        expect(playSpy).toHaveBeenCalled();
        expect(forceStopSpy).not.toHaveBeenCalled();
    });
});

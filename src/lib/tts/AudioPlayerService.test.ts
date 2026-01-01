import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';
import { BackgroundAudio } from './BackgroundAudio';
import { dbService } from '../../db/DBService';
import { genAIService } from '../genai/GenAIService';

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
    getBookMetadata: vi.fn().mockResolvedValue({
        title: 'Test Book',
        author: 'Test Author',
        coverUrl: 'http://example.com/cover.jpg'
    }),
    updatePlaybackState: vi.fn().mockResolvedValue(undefined),
    getTTSState: vi.fn().mockResolvedValue(null),
    saveTTSState: vi.fn(),
    updateReadingHistory: vi.fn(),
    getSections: vi.fn().mockResolvedValue([
        { sectionId: 'sec1', characterCount: 100 },
        { sectionId: 'sec2', characterCount: 0 }, // Empty section
        { sectionId: 'sec3', characterCount: 100 }
    ]),
    getContentAnalysis: vi.fn().mockResolvedValue({ structure: { title: 'Chapter 1' } }),
    getTTSContent: vi.fn().mockImplementation((bookId, sectionId) => {
        if (sectionId === 'sec2') return Promise.resolve({ sentences: [] });
        return Promise.resolve({
            sentences: [{ text: "Sentence " + sectionId, cfi: "cfi_" + sectionId }]
        });
    }),
    saveTTSPosition: vi.fn(),
    saveContentClassifications: vi.fn(),
  }
}));
vi.mock('./CostEstimator');

// Mock useTTSStore to avoid circular dependency
vi.mock('../../store/useTTSStore', () => ({
  useTTSStore: {
    getState: vi.fn().mockReturnValue({
        customAbbreviations: [],
        alwaysMerge: [],
        sentenceStarters: []
    })
  }
}));

vi.mock('../../store/useGenAIStore', () => ({
    useGenAIStore: {
        getState: vi.fn().mockReturnValue({
            isContentAnalysisEnabled: true,
            contentFilterSkipTypes: ['footnote'],
            apiKey: 'test-key'
        })
    }
}));

vi.mock('../genai/GenAIService', () => ({
    genAIService: {
        isConfigured: vi.fn().mockReturnValue(true),
        configure: vi.fn(),
        detectContentTypes: vi.fn().mockResolvedValue([
            { id: '0', type: 'text' }
        ])
    }
}));

describe('AudioPlayerService', () => {
    let service: AudioPlayerService;

    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});

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

    it('should include coverUrl in queue items including Preroll', async () => {
        // Enable preroll
        service.setPrerollEnabled(true);
        service.setBookId('book1');

        // Load section 0 (normal content)
        await service.loadSection(0, false);

        const queue = service.getQueue();
        expect(queue.length).toBeGreaterThan(0);

        // Check Preroll item (first item)
        expect(queue[0].isPreroll).toBe(true);
        // This expectation will fail until fixed
        expect(queue[0].coverUrl).toBe('http://example.com/cover.jpg');

        // Check Content item
        expect(queue[1].coverUrl).toBe('http://example.com/cover.jpg');
    });

    it('should include coverUrl in queue items for empty chapters', async () => {
        service.setBookId('book1');

        // Load section 1 (empty content)
        await service.loadSection(1, false);

        const queue = service.getQueue();
        expect(queue.length).toBe(1);
        expect(queue[0].isPreroll).toBe(true); // Empty message is marked as preroll

        // This expectation will fail until fixed
        expect(queue[0].coverUrl).toBe('http://example.com/cover.jpg');
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

    it('should trigger content analysis for the next chapter', async () => {
        service.setBookId('book1');

        // Mock getTTSContent to spy on it
        const getTTSContentSpy = vi.mocked(dbService.getTTSContent);

        // Load section 1 (sec2, empty) -> should trigger analysis for section 2 (sec3)
        // section index 1 corresponds to sec2
        // next section is index 2, which is sec3

        await service.loadSection(1, false);

        // Wait for background promise (run in next tick)
        await new Promise(resolve => setTimeout(resolve, 10));

        // Check if getTTSContent was called for sec3
        // It's called with 'book1', 'sec3'
        expect(getTTSContentSpy).toHaveBeenCalledWith('book1', 'sec3');

        // Check if GenAI detection was triggered
        expect(genAIService.detectContentTypes).toHaveBeenCalled();
    });
});

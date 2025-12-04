import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioPlayerService, TTSQueueItem } from './AudioPlayerService';
import { WebSpeechProvider } from './providers/WebSpeechProvider';

// Mock dependencies
vi.mock('./providers/WebSpeechProvider');
vi.mock('../../db/DBService', () => ({
  dbService: {
    getBookMetadata: vi.fn().mockResolvedValue(null),
    updatePlaybackState: vi.fn().mockResolvedValue(undefined),
    getCachedSegment: vi.fn().mockResolvedValue(undefined),
    cacheSegment: vi.fn().mockResolvedValue(undefined),
  }
}));
vi.mock('./LexiconService', () => ({
  LexiconService: {
    getInstance: () => ({
      getRules: vi.fn().mockResolvedValue([]),
      applyLexicon: vi.fn((text) => text),
      getRulesHash: vi.fn().mockResolvedValue('hash'),
    })
  }
}));
vi.mock('./CostEstimator', () => ({
  CostEstimator: {
    getInstance: () => ({
      track: vi.fn()
    })
  }
}));

// Helper to delay execution
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('AudioPlayerService Concurrency', () => {
    let service: AudioPlayerService;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockProvider: any;

    beforeEach(() => {
        vi.useRealTimers();
        // Reset singleton
        // @ts-expect-error - resetting private static instance for testing
        AudioPlayerService.instance = undefined;
        service = AudioPlayerService.getInstance();

        // Setup mock provider
        mockProvider = {
            id: 'local',
            init: vi.fn().mockResolvedValue(undefined),
            getVoices: vi.fn().mockResolvedValue([]),
            synthesize: vi.fn().mockImplementation(async () => {
                await delay(50); // Simulate processing time
                return { isNative: true };
            }),
            stop: vi.fn(),
            pause: vi.fn(),
            resume: vi.fn(),
            on: vi.fn(),
        };

        // Inject mock provider
        // @ts-expect-error - accessing private property
        service.provider = mockProvider;

        // Setup simple queue
        const queue: TTSQueueItem[] = [
            { text: 'One', cfi: 'cfi1' },
            { text: 'Two', cfi: 'cfi2' },
            { text: 'Three', cfi: 'cfi3' },
            { text: 'Four', cfi: 'cfi4' },
            { text: 'Five', cfi: 'cfi5' },
        ];
        service.setQueue(queue);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should execute play() sequentially when called rapidly', async () => {
        const synthesizeSpy = mockProvider.synthesize;

        // Trigger 3 plays rapidly
        const p1 = service.play();
        const p2 = service.play();
        const p3 = service.play();

        await Promise.all([p1, p2, p3]);

        expect(synthesizeSpy).toHaveBeenCalledTimes(3);
    });

    it('should execute next() sequentially', async () => {
        // Calling next() 3 times should increment index 3 times
        // Note: next() is fire-and-forget in typical usage, but returns Promise now.

        // Reset
        service.jumpTo(0);

        const p1 = service.next();
        const p2 = service.next();
        const p3 = service.next();

        await Promise.all([p1, p2, p3]);

        // @ts-expect-error - accessing private
        expect(service.currentIndex).toBe(3);
    });

    it('should prevent interleaved execution of play logic', async () => {
        const executionLog: string[] = [];
        mockProvider.synthesize.mockImplementation(async (text: string) => {
            executionLog.push(`start:${text}`);
            await delay(20);
            executionLog.push(`end:${text}`);
            return { isNative: true };
        });

        const queue: TTSQueueItem[] = [
            { text: 'A', cfi: '1' },
            { text: 'B', cfi: '2' }
        ];
        service.setQueue(queue);

        // Call play twice. Since index doesn't change, it plays "A" twice.
        const p1 = service.play();
        const p2 = service.play();

        await Promise.all([p1, p2]);

        expect(executionLog).toEqual(['start:A', 'end:A', 'start:A', 'end:A']);
    });
});

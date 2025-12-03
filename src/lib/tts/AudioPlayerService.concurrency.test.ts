import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioPlayerService, TTSQueueItem } from './AudioPlayerService';
import { MockCloudProvider } from './providers/MockCloudProvider';

// Mock dependencies
vi.mock('./providers/WebSpeechProvider', () => {
    return {
        WebSpeechProvider: class {
            id = 'local';
            init = vi.fn().mockResolvedValue(undefined);
            getVoices = vi.fn().mockResolvedValue([]);
            synthesize = vi.fn().mockResolvedValue({ isNative: true });
            stop = vi.fn();
            pause = vi.fn();
            resume = vi.fn();
            on = vi.fn();
        }
    }
});

vi.mock('./AudioElementPlayer', () => {
    return {
        AudioElementPlayer: class {
            seek = vi.fn();
            playBlob = vi.fn().mockResolvedValue(undefined);
            pause = vi.fn();
            resume = vi.fn();
            stop = vi.fn();
            setRate = vi.fn();
            getCurrentTime = vi.fn().mockReturnValue(0);
            getDuration = vi.fn().mockReturnValue(100);
            setOnTimeUpdate = vi.fn();
            setOnEnded = vi.fn();
            setOnError = vi.fn();
        }
    }
});

vi.mock('../../db/DBService', () => ({
    dbService: {
        getBookMetadata: vi.fn().mockResolvedValue(null),
        updatePlaybackState: vi.fn().mockResolvedValue(undefined),
        getCachedSegment: vi.fn().mockResolvedValue(undefined),
        cacheSegment: vi.fn().mockResolvedValue(undefined)
    }
}));

describe('AudioPlayerService Concurrency', () => {
    let service: AudioPlayerService;
    let mockProvider: MockCloudProvider;

    beforeEach(async () => {
        // Reset singleton
        // @ts-ignore
        AudioPlayerService.instance = undefined;
        service = AudioPlayerService.getInstance();
        mockProvider = new MockCloudProvider();
        vi.spyOn(mockProvider, 'synthesize').mockImplementation(async (_text, _voice, _speed, signal) => {
            // Simulate network delay
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    resolve({
                         audio: new Blob(['data'], { type: 'audio/mp3' }),
                         isNative: false,
                         alignment: []
                    });
                }, 50);

                signal?.addEventListener('abort', () => {
                    clearTimeout(timeout);
                    reject(new DOMException('Aborted', 'AbortError'));
                });
            });
        });

        service.setProvider(mockProvider);
        await service.init();

        const queue: TTSQueueItem[] = [
            { text: 'Sentence 1', cfi: 'cfi1' },
            { text: 'Sentence 2', cfi: 'cfi2' },
            { text: 'Sentence 3', cfi: 'cfi3' }
        ];
        service.setQueue(queue);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should only call synthesize once (for the last call) when play is spammed', async () => {
        const synthesizeSpy = vi.spyOn(mockProvider, 'synthesize');

        // Call play multiple times rapidly
        // Because play() awaits lexicon rules (async), the subsequent calls cancel the previous ones
        // BEFORE they reach synthesize().
        service.play();
        service.play();
        const p3 = service.play();

        await p3;

        // Expect ONLY 1 call to synthesize (optimization works!)
        expect(synthesizeSpy).toHaveBeenCalledTimes(1);

        // Ensure it wasn't aborted
        const callArgs = synthesizeSpy.mock.calls[0];
        // @ts-ignore
        expect(callArgs[3].aborted).toBe(false);
    });

    it('should not start playing if stopped while loading', async () => {
        const p1 = service.play();
        service.stop();

        await p1;

        // Check status via a listener
        let lastStatus = '';
        service.subscribe((status) => { lastStatus = status; });

        // Wait a bit to ensure async operations settle
        await new Promise(r => setTimeout(r, 100));

        expect(lastStatus).toBe('stopped');
    });

    it('should not update queue index if prev/next are spammed', async () => {
        // Initial index 0
        service.next(); // to 1
        service.next(); // to 2
        service.prev(); // to 1

        // We expect it to end up at 1.
        // Logic:
        // next() increments to 1, calls play(). play() starts async op.
        // next() increments to 2, calls play(). cancels previous play().
        // prev() decrements to 1, calls play(). cancels previous play().
        // only the last play() proceeds.

        // Wait for potential async effects
        await new Promise(r => setTimeout(r, 100));

        // Check call to synthesize with specific text
        // Text at index 1 is "Sentence 2"
        expect(mockProvider.synthesize).toHaveBeenLastCalledWith(
            expect.stringContaining('Sentence 2'),
            expect.any(String),
            expect.any(Number),
            expect.any(AbortSignal)
        );

        // And ensure only one call happened (the last one)
        expect(mockProvider.synthesize).toHaveBeenCalledTimes(1);
    });
});

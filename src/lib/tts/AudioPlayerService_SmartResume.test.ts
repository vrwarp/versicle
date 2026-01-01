import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';
import { WebSpeechProvider } from './providers/WebSpeechProvider';
import { AudioElementPlayer } from './AudioElementPlayer';
import { dbService } from '../../db/DBService';

// Mock useTTSStore to avoid circular dependency crash
vi.mock('../../store/useTTSStore', () => ({
    useTTSStore: {
        getState: vi.fn(() => ({
            settings: { customAbbreviations: [], alwaysMerge: [], sentenceStarters: [] }
        }))
    }
}));

// Mock DBService
vi.mock('../../db/DBService', () => ({
  dbService: {
    getBook: vi.fn(),
    getBookMetadata: vi.fn(),
    updatePlaybackState: vi.fn(),
    saveTTSState: vi.fn(),
    getTTSState: vi.fn(),
    saveTTSPosition: vi.fn(), // Added saveTTSPosition
    updateReadingHistory: vi.fn(), // Added updateReadingHistory
    getSections: vi.fn().mockResolvedValue([]),
    getContentAnalysis: vi.fn(),
    getTTSContent: vi.fn(),
  }
}));

// Define hoisted mocks first to avoid reference errors
const { mockDB, mockBook, mockTTSState } = vi.hoisted(() => {
    const mockBook = {
        id: 'test-book-id',
        lastPauseTime: undefined as number | undefined | null,
        lastPlayedCfi: undefined as string | undefined | null,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockTTSState: any = {};

    const mockDB = {
        get: vi.fn().mockImplementation((store, key) => {
            if (store === 'books' && key === 'test-book-id') {
                return Promise.resolve(mockBook);
            }
            if (store === 'tts_queue' && key === 'test-book-id') {
                return Promise.resolve(mockTTSState['test-book-id']);
            }
            return Promise.resolve(undefined);
        }),
        put: vi.fn().mockImplementation((store, val) => {
            if (store === 'books') {
                 if (val.id === 'test-book-id') {
                     if (val.lastPauseTime !== undefined) mockBook.lastPauseTime = val.lastPauseTime;
                     if (val.lastPlayedCfi !== undefined) mockBook.lastPlayedCfi = val.lastPlayedCfi;
                 }
            }
            if (store === 'tts_queue') {
                mockTTSState[val.bookId] = val;
            }
            return Promise.resolve();
        }),
        transaction: vi.fn().mockReturnValue({
            objectStore: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue(mockBook),
                put: vi.fn().mockImplementation((val) => {
                     if (val.lastPauseTime !== undefined) mockBook.lastPauseTime = val.lastPauseTime;
                     if (val.lastPlayedCfi !== undefined) mockBook.lastPlayedCfi = val.lastPlayedCfi;
                     return Promise.resolve();
                }),
            }),
            done: Promise.resolve(),
        }),
    };

    return { mockDB, mockBook, mockTTSState };
});

vi.mock('../../db/db', () => ({
    getDB: vi.fn().mockResolvedValue(mockDB)
}));

// Mock WebSpeechProvider
const mockSynthesize = vi.fn();
const mockResume = vi.fn();
const mockPause = vi.fn();
const mockStop = vi.fn();
const mockGetVoices = vi.fn().mockResolvedValue([]);

vi.mock('./providers/WebSpeechProvider', () => {
    return {
        WebSpeechProvider: class {
            id = 'local';
            init = vi.fn().mockResolvedValue(undefined);
            play = mockSynthesize.mockResolvedValue(undefined);
            resume = mockResume;
            pause = mockPause;
            stop = mockStop;
            on = vi.fn();
            getVoices = mockGetVoices;
            preload = vi.fn();
        }
    };
});

// Mock AudioElementPlayer
const mockSeek = vi.fn();
const mockPlayerResume = vi.fn();
const mockPlayerPause = vi.fn();
const mockPlayerStop = vi.fn();
const mockGetCurrentTime = vi.fn().mockReturnValue(100); // 100 seconds
const mockPlayBlob = vi.fn();

vi.mock('./AudioElementPlayer', () => {
    return {
        AudioElementPlayer: class {
            seek = mockSeek;
            resume = mockPlayerResume;
            pause = mockPlayerPause;
            stop = mockPlayerStop;
            getCurrentTime = mockGetCurrentTime;
            playBlob = mockPlayBlob;
            setOnTimeUpdate = vi.fn();
            setOnEnded = vi.fn();
            setOnError = vi.fn();
            setRate = vi.fn();
        }
    };
});

// Mock LexiconService
vi.mock('./LexiconService', () => ({
    LexiconService: {
        getInstance: vi.fn().mockReturnValue({
            getRules: vi.fn().mockResolvedValue([]),
            applyLexicon: vi.fn((text) => text),
            getRulesHash: vi.fn().mockResolvedValue('hash'),
        })
    }
}));

describe('AudioPlayerService - Smart Resume', () => {
    let service: AudioPlayerService;

    beforeEach(async () => {
        vi.clearAllMocks();

        // Reset mockBook state
        mockBook.lastPauseTime = undefined;
        mockBook.lastPlayedCfi = undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockTTSState as any)['test-book-id'] = undefined;

        // Reset singleton logic
        // @ts-expect-error Resetting singleton
        AudioPlayerService.instance = undefined;
        service = AudioPlayerService.getInstance();

        // Wait for setup
        await service.stop();
        service.setBookId('test-book-id');

        // Mock DBService responses
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getBookMetadata as any).mockResolvedValue({ lastPauseTime: null });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getBook as any).mockResolvedValue({ metadata: { lastPlayedCfi: null } });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getTTSState as any).mockResolvedValue(undefined);


        // IMPORTANT: Set Book ID to enable DB logic
        service.setBookId('test-book-id');

        // Must await queue setting if it becomes async (though it is executeWithLock)
        // Note: queue items are short, so charsPerSecond (180wpm ~ 15cps)
        // "Sentence 1" ~ 10 chars ~ 0.6s
        // "Sentence 2" ~ 10 chars ~ 0.6s
        // We set 5 sentences.
        await service.setQueue([
            { text: 'Sentence 1', cfi: 'cfi1' }, // 10 chars
            { text: 'Sentence 2', cfi: 'cfi2' }, // 10 chars
            { text: 'Sentence 3', cfi: 'cfi3' }, // 10 chars
            { text: 'Sentence 4', cfi: 'cfi4' }, // 10 chars
            { text: 'Sentence 5', cfi: 'cfi5' }, // 10 chars
        ], 3); // Start at index 3 (Sentence 4)
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should set lastPauseTime on pause', async () => {
        vi.useFakeTimers();
        const now = 1000000;
        vi.setSystemTime(now);

        await service.pause();

        // Now we expect DBService to be called
        expect(dbService.updatePlaybackState).toHaveBeenCalledWith(
            'test-book-id',
            'cfi4', // The cfi of current index 3 ('Sentence 4') is 'cfi4'
            now
        );
    });

    it('should set lastPauseTime on stop', async () => {
        vi.useFakeTimers();
        const now = 2000000;
        vi.setSystemTime(now);

        await service.stop();
        expect(dbService.updatePlaybackState).toHaveBeenCalledWith(
            'test-book-id',
            'cfi4',
            null
        );
    });

    describe('WebSpeechProvider (Local)', () => {
        beforeEach(async () => {
            await service.setProvider(new WebSpeechProvider());
        });

        it('should NOT rewind if paused for < 5 minutes', async () => {
            vi.useFakeTimers();
            const now = 1000000;
            vi.setSystemTime(now);

            // Simulate paused state in DB
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (dbService.getBookMetadata as any).mockResolvedValue({
                lastPauseTime: now - (4 * 60 * 1000) // 4 mins ago
            });

            // Set status manually to simulate active pause
            // @ts-expect-error Access private property
            service['status'] = 'paused';

            await service.resume();
            await vi.advanceTimersByTimeAsync(100);

            // Updated expectation: AudioPlayerService always calls playInternal (synthesize) on resume
            // to ensure state consistency.
            expect(mockSynthesize).toHaveBeenCalled();
            // Index should remain 3
            // @ts-expect-error Access private property
            expect(service['currentIndex']).toBe(3);
        });

        it('should rewind 2 sentences if paused for > 5 minutes', async () => {
            vi.useFakeTimers();
            const now = 1000000;
            vi.setSystemTime(now);

             // eslint-disable-next-line @typescript-eslint/no-explicit-any
             (dbService.getBookMetadata as any).mockResolvedValue({
                lastPauseTime: now - (6 * 60 * 1000) // 6 mins ago
            });

            // @ts-expect-error Access private property
            service['currentIndex'] = 3;
            // @ts-expect-error Access private property
            service['status'] = 'paused';

            await service.resume();
            await vi.advanceTimersByTimeAsync(100);

            // 3 - 2 = 1
            // @ts-expect-error Access private property
            expect(service['currentIndex']).toBe(1);
            expect(mockSynthesize).toHaveBeenCalled();
        });

        it('should rewind 5 sentences if paused for > 24 hours', async () => {
            vi.useFakeTimers();
            const now = 1000000 + (25 * 60 * 60 * 1000); // 25 hours later
            vi.setSystemTime(now);

             // eslint-disable-next-line @typescript-eslint/no-explicit-any
             (dbService.getBookMetadata as any).mockResolvedValue({
                lastPauseTime: 1000000
            });

            // @ts-expect-error Access private property
            service['status'] = 'paused';

            await service.resume();
            await vi.advanceTimersByTimeAsync(100);

            // 3 - 5 = -2 -> max(0, -2) = 0
            // @ts-expect-error Access private property
            expect(service['currentIndex']).toBe(0);
            expect(mockSynthesize).toHaveBeenCalled();
        });
    });

    describe('Cloud Provider (AudioElementPlayer)', () => {
        // Mock play method for cloud provider
        const mockCloudPlay = vi.fn().mockResolvedValue(undefined);

        beforeEach(async () => {
            const mockCloudProvider = {
                id: 'cloud',
                init: vi.fn(),
                play: mockCloudPlay,
                getVoices: vi.fn(),
                on: vi.fn(),
                stop: vi.fn(),
                pause: vi.fn(),
                resume: vi.fn(),
                preload: vi.fn(),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any;
            await service.setProvider(mockCloudProvider);
            // We do NOT inject audioPlayer because service doesn't use it.
            // Service calculates index based on time.

            // Re-calculate prefix sums and speed to ensure time calculations work
            // Default speed 1.0. WPM 180. CPS 15.
            // Sentence length 10. Duration ~ 0.66s.
            // Total duration for 5 sentences ~ 3.33s.

            // To test time based rewind properly, we need longer sentences or smaller rewind expectation.
            // But the service logic is hardcoded: rewind 10s or 60s.
            // If total content is 3s, rewinding 10s will go to start (index 0).

            // Let's update queue to have LONGER text for testing time rewind
            // Each char ~ 1/15 sec. 150 chars = 10 sec.
            const longText = "a".repeat(300); // 20 seconds per sentence
            await service.setQueue([
                { text: longText, cfi: 'cfi1' }, // 0-20s
                { text: longText, cfi: 'cfi2' }, // 20-40s
                { text: longText, cfi: 'cfi3' }, // 40-60s
                { text: longText, cfi: 'cfi4' }, // 60-80s
                { text: longText, cfi: 'cfi5' }, // 80-100s
            ], 3); // Start at index 3 (60s mark)

            mockCloudPlay.mockClear();
        });

        it('should NOT rewind if paused for < 5 minutes', async () => {
            vi.useFakeTimers();
            const now = 1000000;
            vi.setSystemTime(now);

             // eslint-disable-next-line @typescript-eslint/no-explicit-any
             (dbService.getBookMetadata as any).mockResolvedValue({
                lastPauseTime: now - (4 * 60 * 1000)
            });

            // @ts-expect-error Access private property
            service['status'] = 'paused';

            await service.resume();
            await vi.advanceTimersByTimeAsync(100);

            // Should call play (since we always restart)
            expect(mockCloudPlay).toHaveBeenCalled();
            // Should NOT change index
            // @ts-expect-error Access private property
            expect(service['currentIndex']).toBe(3);
        });

        it('should rewind 10 seconds if paused for > 5 minutes', async () => {
            vi.useFakeTimers();
            const now = 1000000;
            vi.setSystemTime(now);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (dbService.getBookMetadata as any).mockResolvedValue({
                lastPauseTime: now - (6 * 60 * 1000)
            });

            // @ts-expect-error Access private property
            service['status'] = 'paused';

            // Current Index 3 starts at 60s.
            // Rewind 10s -> Target 50s.
            // 50s is inside Index 2 (40s-60s).
            // So expected index is 2.

            await service.resume();
            await vi.advanceTimersByTimeAsync(100);

            // @ts-expect-error Access private property
            expect(service['currentIndex']).toBe(2);
            expect(mockCloudPlay).toHaveBeenCalled();
        });

        it('should rewind 60 seconds if paused for > 24 hours', async () => {
            vi.useFakeTimers();
            const now = 1000000 + (25 * 60 * 60 * 1000);
            vi.setSystemTime(now);

             // eslint-disable-next-line @typescript-eslint/no-explicit-any
             (dbService.getBookMetadata as any).mockResolvedValue({
                lastPauseTime: 1000000
            });

            // @ts-expect-error Access private property
            service['status'] = 'paused';

            // Current Index 3 starts at 60s.
            // Rewind 60s -> Target 0s.
            // 0s is Index 0.

            await service.resume();
            await vi.advanceTimersByTimeAsync(100);

            // @ts-expect-error Access private property
            expect(service['currentIndex']).toBe(0);
            expect(mockCloudPlay).toHaveBeenCalled();
        });
    });
});

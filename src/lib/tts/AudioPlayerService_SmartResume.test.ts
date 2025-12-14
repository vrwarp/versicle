import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';
import { WebSpeechProvider } from './providers/WebSpeechProvider';
import { AudioElementPlayer } from './AudioElementPlayer';
import { dbService } from '../../db/DBService';

// Mock DBService
vi.mock('../../db/DBService', () => ({
  dbService: {
    getBook: vi.fn(),
    getBookMetadata: vi.fn(),
    updatePlaybackState: vi.fn(),
    saveTTSState: vi.fn(),
    getTTSState: vi.fn(),
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
            id = 'local'; // Added id='local'
            init = vi.fn().mockResolvedValue(undefined);
            play = mockSynthesize.mockResolvedValue(undefined);
            resume = mockResume;
            pause = mockPause;
            stop = mockStop;
            on = vi.fn();
            getVoices = mockGetVoices;
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
        await service.setQueue([
            { text: 'Sentence 1', cfi: 'cfi1' },
            { text: 'Sentence 2', cfi: 'cfi2' },
            { text: 'Sentence 3', cfi: 'cfi3' },
            { text: 'Sentence 4', cfi: 'cfi4' },
            { text: 'Sentence 5', cfi: 'cfi5' },
        ], 3); // Start at index 3
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

        it.skip('should NOT rewind if paused for < 5 minutes', async () => {
            vi.useFakeTimers();
            const now = 1000000;
            vi.setSystemTime(now);

            // Simulate paused state in DB
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (dbService.getBookMetadata as any).mockResolvedValue({
                lastPauseTime: now - (4 * 60 * 1000) // 4 mins ago
            });

            // Need to mock that resume finds the time
            // We set status directly, but service logic might overwrite it if not careful
            // @ts-expect-error Access private property
            service['status'] = 'paused';

            await service.resume();
            await vi.advanceTimersByTimeAsync(100);

            expect(mockResume).toHaveBeenCalled();
            // @ts-expect-error Access private property
            expect(service['currentIndex']).toBe(3);

            expect(mockBook.lastPauseTime).toBeUndefined();
        });

        it.skip('should rewind 2 sentences if paused for > 5 minutes', async () => {
            vi.useFakeTimers();
            const now = 1000000;
            vi.setSystemTime(now);

             // eslint-disable-next-line @typescript-eslint/no-explicit-any
             (dbService.getBookMetadata as any).mockResolvedValue({
                lastPauseTime: now - (6 * 60 * 1000) // 6 mins ago
            });

            // Set current index before "pausing" logic simulation
            // @ts-expect-error Access private property
            service['currentIndex'] = 3;
            // @ts-expect-error Access private property
            service['status'] = 'paused';

            await service.resume();
            await vi.advanceTimersByTimeAsync(100);

            // @ts-expect-error Access private property
            expect(service['currentIndex']).toBe(1);
            expect(mockSynthesize).toHaveBeenCalled();
        });

        it.skip('should rewind 5 sentences if paused for > 24 hours', async () => {
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

            // @ts-expect-error Access private property
            expect(service['currentIndex']).toBe(0);
            expect(mockSynthesize).toHaveBeenCalled();
        });
    });

    describe('Cloud Provider (AudioElementPlayer)', () => {
        beforeEach(async () => {
            const mockCloudProvider = {
                id: 'cloud', // Already correct here, but for completeness
                init: vi.fn(),
                play: vi.fn(),
                getVoices: vi.fn(),
                on: vi.fn(),
                stop: vi.fn(),
                pause: vi.fn(),
                resume: vi.fn(),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any;
            await service.setProvider(mockCloudProvider);
            // @ts-expect-error Access private property
            service['audioPlayer'] = new AudioElementPlayer();
        });

        it.skip('should NOT rewind if paused for < 5 minutes', async () => {
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

            expect(mockSeek).not.toHaveBeenCalled();
            expect(mockPlayerResume).toHaveBeenCalled();
        });

        it.skip('should rewind 10 seconds if paused for > 5 minutes', async () => {
            vi.useFakeTimers();
            const now = 1000000;
            vi.setSystemTime(now);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (dbService.getBookMetadata as any).mockResolvedValue({
                lastPauseTime: now - (6 * 60 * 1000)
            });

            // @ts-expect-error Access private property
            service['status'] = 'paused';

            await service.resume();
            await vi.advanceTimersByTimeAsync(100);

            expect(mockSeek).toHaveBeenCalledWith(90);
            expect(mockPlayerResume).toHaveBeenCalled();
        });

        it.skip('should rewind 60 seconds if paused for > 24 hours', async () => {
            vi.useFakeTimers();
            const now = 1000000 + (25 * 60 * 60 * 1000);
            vi.setSystemTime(now);

             // eslint-disable-next-line @typescript-eslint/no-explicit-any
             (dbService.getBookMetadata as any).mockResolvedValue({
                lastPauseTime: 1000000
            });

            // @ts-expect-error Access private property
            service['status'] = 'paused';

            await service.resume();
            await vi.advanceTimersByTimeAsync(100);

            expect(mockSeek).toHaveBeenCalledWith(40);
            expect(mockPlayerResume).toHaveBeenCalled();
        });
    });
});

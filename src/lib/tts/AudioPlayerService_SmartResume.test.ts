import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';
import { WebSpeechProvider } from './providers/WebSpeechProvider';
import { AudioElementPlayer } from './AudioElementPlayer';
import { dbService } from '../../db/DBService';

// Mock DBService
vi.mock('../../db/DBService', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockBook: any = {
        id: 'test-book-id',
        lastPauseTime: undefined as number | undefined | null,
        lastPlayedCfi: undefined as string | undefined | null,
    };

    const mockDB = {
        get: vi.fn().mockImplementation((store, key) => {
            if (store === 'books' && key === 'test-book-id') {
                return Promise.resolve(mockBook);
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

    return {
        dbService: {
            getBookMetadata: vi.fn(),
            getBook: vi.fn(),
            updatePlaybackState: vi.fn(),
            getCachedSegment: vi.fn(),
            cacheSegment: vi.fn(),
        },
        mockBook
    };
});

// Mock WebSpeechProvider
const mockSynthesize = vi.fn();
const mockResume = vi.fn();
const mockPause = vi.fn();
const mockStop = vi.fn();
const mockGetVoices = vi.fn().mockResolvedValue([]);

vi.mock('./providers/WebSpeechProvider', () => {
    return {
        WebSpeechProvider: class {
            init = vi.fn().mockResolvedValue(undefined);
            synthesize = mockSynthesize;
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

// Mock CostEstimator
vi.mock('./CostEstimator', () => ({
  CostEstimator: {
    getInstance: () => ({
      track: vi.fn()
    })
  }
}));

describe('AudioPlayerService - Smart Resume', () => {
    let service: AudioPlayerService;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockBook: any;

    beforeEach(async () => {
        vi.clearAllMocks();

        // Load mockBook from module mock
        // @ts-expect-error - accessing internal mock
        mockBook = (await import('../../db/DBService')).mockBook;

        // Reset mockBook state
        mockBook.lastPauseTime = undefined;
        mockBook.lastPlayedCfi = undefined;

        // Reset singleton logic
        // @ts-expect-error - reset private static
        AudioPlayerService.instance = undefined;
        service = AudioPlayerService.getInstance();
        await service.stop();
        service.setBookId('test-book-id');

        // Mock DBService responses
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getBookMetadata as any).mockResolvedValue({ lastPauseTime: null });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getBook as any).mockResolvedValue({ metadata: { lastPlayedCfi: null } });

        // IMPORTANT: Set Book ID to enable DB logic
        service.setBookId('test-book-id');

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
            null // Stop clears pause time?
            // Actually, AudioPlayerService.stop() calls savePlaybackState() with isPaused=false (since status set to stopped before calling save? No.)
            // Logic:
            // stop() {
            //   savePlaybackState();
            //   setStatus('stopped');
            // ...
            // }
            // savePlaybackState() {
            //   const isPaused = status === 'paused';
            //   const lastPauseTime = isPaused ? Date.now() : null;
            // }
            // If status is 'playing' when stop() called, isPaused is false. lastPauseTime is null.
            // If status was 'paused' when stop() called, isPaused is true. lastPauseTime is now.
            // Wait, stop() does not change status before calling savePlaybackState().
            // So if we were paused, it saves pause time.
            // But if we were playing, it saves null.
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

            // Need to mock that resume finds the time
            // @ts-expect-error - accessing private
            service['status'] = 'paused';

            await service.resume();
            await vi.advanceTimersByTimeAsync(100);

            expect(mockResume).toHaveBeenCalled();
            // @ts-expect-error - accessing private
            expect(service['currentIndex']).toBe(3);

            expect(mockBook.lastPauseTime).toBeUndefined();
        });

        it('should rewind 2 sentences if paused for > 5 minutes', async () => {
            vi.useFakeTimers();
            const now = 1000000;
            vi.setSystemTime(now);

             // eslint-disable-next-line @typescript-eslint/no-explicit-any
             (dbService.getBookMetadata as any).mockResolvedValue({
                lastPauseTime: now - (6 * 60 * 1000) // 6 mins ago
            });

            // Set current index before "pausing" logic simulation
            // @ts-expect-error - accessing private
            service['currentIndex'] = 3;
            // @ts-expect-error - accessing private
            service['status'] = 'paused';

            await service.resume();
            await vi.advanceTimersByTimeAsync(100);

            // @ts-expect-error - accessing private
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

            // @ts-expect-error - accessing private
            service['status'] = 'paused';

            await service.resume();
            await vi.advanceTimersByTimeAsync(100);

            // @ts-expect-error - accessing private
            expect(service['currentIndex']).toBe(0);
            expect(mockSynthesize).toHaveBeenCalled();
        });
    });

    describe('Cloud Provider (AudioElementPlayer)', () => {
        beforeEach(async () => {
            const mockCloudProvider = {
                init: vi.fn(),
                synthesize: vi.fn(),
                getVoices: vi.fn(),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any;
            await service.setProvider(mockCloudProvider);
            // @ts-expect-error - accessing private
            service['audioPlayer'] = new AudioElementPlayer();
        });

        it('should NOT rewind if paused for < 5 minutes', async () => {
            vi.useFakeTimers();
            const now = 1000000;
            vi.setSystemTime(now);

             // eslint-disable-next-line @typescript-eslint/no-explicit-any
             (dbService.getBookMetadata as any).mockResolvedValue({
                lastPauseTime: now - (4 * 60 * 1000)
            });

            // @ts-expect-error - accessing private
            service['status'] = 'paused';

            await service.resume();
            await vi.advanceTimersByTimeAsync(100);

            expect(mockSeek).not.toHaveBeenCalled();
            expect(mockPlayerResume).toHaveBeenCalled();
        });

        it('should rewind 10 seconds if paused for > 5 minutes', async () => {
            vi.useFakeTimers();
            const now = 1000000;
            vi.setSystemTime(now);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (dbService.getBookMetadata as any).mockResolvedValue({
                lastPauseTime: now - (6 * 60 * 1000)
            });

            // @ts-expect-error - accessing private
            service['status'] = 'paused';

            await service.resume();
            await vi.advanceTimersByTimeAsync(100);

            expect(mockSeek).toHaveBeenCalledWith(90);
            expect(mockPlayerResume).toHaveBeenCalled();
        });

        it('should rewind 60 seconds if paused for > 24 hours', async () => {
            vi.useFakeTimers();
            const now = 1000000 + (25 * 60 * 60 * 1000);
            vi.setSystemTime(now);

             // eslint-disable-next-line @typescript-eslint/no-explicit-any
             (dbService.getBookMetadata as any).mockResolvedValue({
                lastPauseTime: 1000000
            });

            // @ts-expect-error - accessing private
            service['status'] = 'paused';

            await service.resume();
            await vi.advanceTimersByTimeAsync(100);

            expect(mockSeek).toHaveBeenCalledWith(40);
            expect(mockPlayerResume).toHaveBeenCalled();
        });
    });
});

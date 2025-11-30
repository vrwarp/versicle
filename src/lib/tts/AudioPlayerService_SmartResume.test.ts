import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';
import { useTTSStore } from '../../store/useTTSStore';
import { WebSpeechProvider } from './providers/WebSpeechProvider';
import { AudioElementPlayer } from './AudioElementPlayer';

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

// Mock Store
vi.mock('../../store/useTTSStore', () => ({
    useTTSStore: {
        getState: vi.fn().mockReturnValue({
            lastPauseTime: null,
            setLastPauseTime: vi.fn(),
        })
    }
}));

// Mock LexiconService to avoid DB calls during fake timers
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
    let mockStore: any;

    beforeEach(async () => {
        vi.clearAllMocks();

        // Reset singleton logic
        service = AudioPlayerService.getInstance();
        service.stop();

        mockStore = {
            lastPauseTime: null,
            setLastPauseTime: vi.fn((time) => { mockStore.lastPauseTime = time; }),
        };
        (useTTSStore.getState as any).mockImplementation(() => mockStore);

        // Setup queue
        service.setQueue([
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

    it('should set lastPauseTime on pause', () => {
        vi.useFakeTimers();
        const now = 1000000;
        vi.setSystemTime(now);

        service.pause();

        expect(mockStore.setLastPauseTime).toHaveBeenCalledWith(now);
    });

    it('should clear lastPauseTime on stop', () => {
        service.stop();
        expect(mockStore.setLastPauseTime).toHaveBeenCalledWith(null);
    });

    describe('WebSpeechProvider (Local)', () => {
        beforeEach(() => {
            service.setProvider(new WebSpeechProvider());
        });

        it('should NOT rewind if paused for < 5 minutes', async () => {
            vi.useFakeTimers();
            const now = 1000000;
            vi.setSystemTime(now);

            // Simulate paused state
            service['status'] = 'paused';
            mockStore.lastPauseTime = now - (4 * 60 * 1000); // 4 mins ago

            await service.resume();

            expect(mockResume).toHaveBeenCalled();
            expect(service['currentIndex']).toBe(3);
        });

        it('should rewind 2 sentences if paused for > 5 minutes', async () => {
            vi.useFakeTimers();
            const now = 1000000;
            vi.setSystemTime(now);

            // Simulate paused state
            service['status'] = 'paused';
            mockStore.lastPauseTime = now - (6 * 60 * 1000); // 6 mins ago

            await service.resume();

            expect(service['currentIndex']).toBe(1);
            expect(mockSynthesize).toHaveBeenCalled();
        });

        it('should rewind 5 sentences if paused for > 24 hours', async () => {
            vi.useFakeTimers();
            const now = 1000000 + (25 * 60 * 60 * 1000); // 25 hours later
            vi.setSystemTime(now);

            service['status'] = 'paused';
            mockStore.lastPauseTime = 1000000;

            await service.resume();

            expect(service['currentIndex']).toBe(0);
            expect(mockSynthesize).toHaveBeenCalled();
        });
    });

    describe('Cloud Provider (AudioElementPlayer)', () => {
        beforeEach(() => {
            const mockCloudProvider = {
                init: vi.fn(),
                synthesize: vi.fn(),
                getVoices: vi.fn(),
            } as any;
            service.setProvider(mockCloudProvider);
            service['audioPlayer'] = new AudioElementPlayer();
        });

        it('should NOT rewind if paused for < 5 minutes', async () => {
            vi.useFakeTimers();
            const now = 1000000;
            vi.setSystemTime(now);

            service['status'] = 'paused';
            mockStore.lastPauseTime = now - (4 * 60 * 1000);

            await service.resume();

            expect(mockSeek).not.toHaveBeenCalled();
            expect(mockPlayerResume).toHaveBeenCalled();
        });

        it('should rewind 10 seconds if paused for > 5 minutes', async () => {
            vi.useFakeTimers();
            const now = 1000000;
            vi.setSystemTime(now);

            service['status'] = 'paused';
            mockStore.lastPauseTime = now - (6 * 60 * 1000);

            await service.resume();

            expect(mockSeek).toHaveBeenCalledWith(90);
            expect(mockPlayerResume).toHaveBeenCalled();
        });

        it('should rewind 60 seconds if paused for > 24 hours', async () => {
            vi.useFakeTimers();
            const now = 1000000 + (25 * 60 * 60 * 1000);
            vi.setSystemTime(now);

            service['status'] = 'paused';
            mockStore.lastPauseTime = 1000000;

            await service.resume();

            expect(mockSeek).toHaveBeenCalledWith(40);
            expect(mockPlayerResume).toHaveBeenCalled();
        });
    });
});

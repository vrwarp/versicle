import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AudioPlayerService, type TTSQueueItem } from './AudioPlayerService';
import { WebSpeechProvider } from './providers/WebSpeechProvider';

// Mock dependencies using classes to ensure constructor behavior works correctly
vi.mock('./providers/WebSpeechProvider', () => {
    return {
        WebSpeechProvider: class MockWebSpeechProvider {
            on = vi.fn();
            init = vi.fn().mockResolvedValue(undefined);
            getVoices = vi.fn().mockResolvedValue([]);
            synthesize = vi.fn().mockResolvedValue({});
            resume = vi.fn();
            pause = vi.fn();
            stop = vi.fn();
        }
    };
});

vi.mock('./AudioElementPlayer', () => {
    return {
        AudioElementPlayer: class MockAudioElementPlayer {
             setOnTimeUpdate = vi.fn();
             setOnEnded = vi.fn();
             setOnError = vi.fn();
             seek = vi.fn();
             getCurrentTime = vi.fn().mockReturnValue(100);
             resume = vi.fn().mockResolvedValue(undefined);
             pause = vi.fn();
             stop = vi.fn();
             setRate = vi.fn();
        }
    };
});

vi.mock('./SyncEngine');
vi.mock('./TTSCache');
vi.mock('./CostEstimator');

// Mock window.MediaMetadata
vi.stubGlobal('MediaMetadata', vi.fn());

describe('AudioPlayerService Smart Resume', () => {
    let service: AudioPlayerService;
    let mockStateHandler: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    let lastPauseTime: number | null = null;
    let enableSmartResume = true;

    beforeEach(() => {
        vi.clearAllMocks();

        // Setup state handler mock
        lastPauseTime = null;
        enableSmartResume = true;
        mockStateHandler = {
            getLastPauseTime: vi.fn().mockImplementation(() => lastPauseTime),
            setLastPauseTime: vi.fn().mockImplementation((time) => { lastPauseTime = time; }),
            getEnableSmartResume: vi.fn().mockImplementation(() => enableSmartResume)
        };

        service = AudioPlayerService.getInstance();
        service.bindStateHandler(mockStateHandler);

        // Reset service internal state best we can
        service.stop();
        // Setup a dummy queue
        const queue: TTSQueueItem[] = [
            { text: 'Sentence 1', cfi: 'cfi1' },
            { text: 'Sentence 2', cfi: 'cfi2' },
            { text: 'Sentence 3', cfi: 'cfi3' },
            { text: 'Sentence 4', cfi: 'cfi4' },
            { text: 'Sentence 5', cfi: 'cfi5' },
        ];
        service.setQueue(queue, 3); // Start at index 3
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should save pause time when paused', () => {
        service.pause();
        expect(mockStateHandler.setLastPauseTime).toHaveBeenCalled();
        expect(lastPauseTime).not.toBeNull();
    });

    it('should NOT rewind if smart resume is disabled', async () => {
        enableSmartResume = false;

        // Mock 6 mins elapsed
        service.pause();
        lastPauseTime = Date.now() - (6 * 60 * 1000);

        await service.resume();

        expect((service as any).currentIndex).toBe(3); // eslint-disable-line @typescript-eslint/no-explicit-any
    });

    it('should rewind 0s if paused for < 5 min (WebSpeech)', async () => {
        // Mock provider as WebSpeech
        const mockProvider = new WebSpeechProvider();
        service.setProvider(mockProvider);

        // Pause
        service.pause();
        // Manually set lastPauseTime to 4 mins ago
        lastPauseTime = Date.now() - (4 * 60 * 1000);

        // Resume
        await service.resume();

        // Should NOT rewind (index remains 3)
        // Check internal index
        expect((service as any).currentIndex).toBe(3); // eslint-disable-line @typescript-eslint/no-explicit-any
    });

    it('should rewind 2 indexes if paused for > 5 min (WebSpeech)', async () => {
        // Mock provider as WebSpeech
        const mockProvider = new WebSpeechProvider();
        service.setProvider(mockProvider);

        (service as any).currentIndex = 3; // eslint-disable-line @typescript-eslint/no-explicit-any

        // Pause
        service.pause();

        // Mock 6 mins elapsed
        lastPauseTime = Date.now() - (6 * 60 * 1000);

        const playSpy = vi.spyOn(service, 'play');

        // Resume
        await service.resume();

        // Should rewind 2 indexes: 3 -> 1
        expect((service as any).currentIndex).toBe(1); // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(playSpy).toHaveBeenCalled();
        expect(mockStateHandler.setLastPauseTime).toHaveBeenCalledWith(null);
    });

    it('should clamp rewind to 0 (WebSpeech)', async () => {
        const mockProvider = new WebSpeechProvider();
        service.setProvider(mockProvider);

        (service as any).currentIndex = 1; // eslint-disable-line @typescript-eslint/no-explicit-any
        service.pause();
        lastPauseTime = Date.now() - (6 * 60 * 1000); // 6 mins

        await service.resume();

        // 1 - 2 = -1 -> clamped to 0
        expect((service as any).currentIndex).toBe(0); // eslint-disable-line @typescript-eslint/no-explicit-any
    });

    it('should rewind to chapter start (index 0) if paused for > 48 hours (WebSpeech)', async () => {
        const mockProvider = new WebSpeechProvider();
        service.setProvider(mockProvider);

        (service as any).currentIndex = 4; // eslint-disable-line @typescript-eslint/no-explicit-any
        service.pause();
        lastPauseTime = Date.now() - (49 * 3600 * 1000); // 49 hours

        await service.resume();

        // Should go to 0
        expect((service as any).currentIndex).toBe(0); // eslint-disable-line @typescript-eslint/no-explicit-any
    });

    it('should rewind 10s if paused for > 5 min (Cloud)', async () => {
        // Mock Cloud Provider
        const mockCloudProvider: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
            init: vi.fn(),
            getVoices: vi.fn(),
            synthesize: vi.fn(),
            stop: vi.fn(),
        };
        service.setProvider(mockCloudProvider);

        // Inject mock audio player
        const mockAudioPlayer = {
            getCurrentTime: vi.fn().mockReturnValue(100), // Current time 100s
            seek: vi.fn(),
            resume: vi.fn().mockResolvedValue(undefined),
            pause: vi.fn(),
            stop: vi.fn(),
            setRate: vi.fn(),
            setOnTimeUpdate: vi.fn(),
            setOnEnded: vi.fn(),
            setOnError: vi.fn(),
        };
        (service as any).audioPlayer = mockAudioPlayer; // eslint-disable-line @typescript-eslint/no-explicit-any

        // Pause
        service.pause();
        lastPauseTime = Date.now() - (6 * 60 * 1000); // 6 mins

        // Resume
        await service.resume();

        // Should seek to 100 - 10 = 90
        expect(mockAudioPlayer.seek).toHaveBeenCalledWith(90);
        expect(mockAudioPlayer.resume).toHaveBeenCalled();
    });

    it('should rewind 60s if paused for > 24 hours (Cloud)', async () => {
        const mockCloudProvider: any = { init: vi.fn(), getVoices: vi.fn(), synthesize: vi.fn(), stop: vi.fn() }; // eslint-disable-line @typescript-eslint/no-explicit-any
        service.setProvider(mockCloudProvider);
        const mockAudioPlayer = {
            getCurrentTime: vi.fn().mockReturnValue(1000),
            seek: vi.fn(),
            resume: vi.fn().mockResolvedValue(undefined),
            pause: vi.fn(),
            stop: vi.fn(),
            setRate: vi.fn(),
            setOnTimeUpdate: vi.fn(),
            setOnEnded: vi.fn(),
            setOnError: vi.fn(),
        };
        (service as any).audioPlayer = mockAudioPlayer; // eslint-disable-line @typescript-eslint/no-explicit-any

        service.pause();
        lastPauseTime = Date.now() - (25 * 3600 * 1000); // 25 hours

        await service.resume();

        // 1000 - 60 = 940
        expect(mockAudioPlayer.seek).toHaveBeenCalledWith(940);
    });

    it('should rewind to 0s (chapter start) if paused for > 48 hours (Cloud)', async () => {
        const mockCloudProvider: any = { init: vi.fn(), getVoices: vi.fn(), synthesize: vi.fn(), stop: vi.fn() }; // eslint-disable-line @typescript-eslint/no-explicit-any
        service.setProvider(mockCloudProvider);
        const mockAudioPlayer = {
            getCurrentTime: vi.fn().mockReturnValue(1000),
            seek: vi.fn(),
            resume: vi.fn().mockResolvedValue(undefined),
            pause: vi.fn(),
            stop: vi.fn(),
            setRate: vi.fn(),
            setOnTimeUpdate: vi.fn(),
            setOnEnded: vi.fn(),
            setOnError: vi.fn(),
        };
        (service as any).audioPlayer = mockAudioPlayer; // eslint-disable-line @typescript-eslint/no-explicit-any

        service.pause();
        lastPauseTime = Date.now() - (49 * 3600 * 1000); // 49 hours

        await service.resume();

        // Should seek to 0
        expect(mockAudioPlayer.seek).toHaveBeenCalledWith(0);
    });
});

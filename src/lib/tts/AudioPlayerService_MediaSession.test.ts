import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';
import { AudioElementPlayer } from './AudioElementPlayer';

// Mock WebSpeechProvider
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

// Mock TTSCache
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

// Mock AudioElementPlayer with shared spies
const sharedSpies = {
    setOnTimeUpdate: vi.fn(),
    seek: vi.fn(),
    getDuration: vi.fn().mockReturnValue(120),
};

vi.mock('./AudioElementPlayer', () => {
    return {
        AudioElementPlayer: class {
            setOnTimeUpdate = sharedSpies.setOnTimeUpdate;
            setOnEnded = vi.fn();
            setOnError = vi.fn();
            getDuration = sharedSpies.getDuration;
            getCurrentTime = vi.fn().mockReturnValue(10);
            seek = sharedSpies.seek;
            playBlob = vi.fn().mockResolvedValue(undefined);
            setRate = vi.fn();
            stop = vi.fn();
            pause = vi.fn();
            resume = vi.fn();
            playUrl = vi.fn();
            setVolume = vi.fn();
            destroy = vi.fn();
        }
    };
});

describe('AudioPlayerService MediaSession Integration', () => {
    let service: AudioPlayerService;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mediaSessionMock: any;

    beforeEach(() => {
        // Reset shared spies
        sharedSpies.setOnTimeUpdate.mockClear();
        sharedSpies.seek.mockClear();
        sharedSpies.getDuration.mockClear();

        // Setup Media Session Mock
        mediaSessionMock = {
            setActionHandler: vi.fn(),
            playbackState: 'none',
            metadata: null,
            setPositionState: vi.fn(),
        };

        // Stub navigator.mediaSession BEFORE creating the service
        vi.stubGlobal('navigator', {
            mediaSession: mediaSessionMock,
            userAgent: 'test-agent'
        });

        // Mock MediaMetadata constructor
        vi.stubGlobal('MediaMetadata', class {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            constructor(public init: any) {}
        });

        // Reset AudioPlayerService singleton
        // @ts-expect-error Resetting singleton for testing
        AudioPlayerService.instance = undefined;
        service = AudioPlayerService.getInstance();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('should register all media session handlers including seekto', () => {
        const actions = mediaSessionMock.setActionHandler.mock.calls.map((call: string[]) => call[0]);

        expect(actions).toContain('play');
        expect(actions).toContain('pause');
        expect(actions).toContain('stop');
        expect(actions).toContain('previoustrack');
        expect(actions).toContain('nexttrack');
        expect(actions).toContain('seekbackward');
        expect(actions).toContain('seekforward');
        expect(actions).toContain('seekto');
    });

    it('should update position state during cloud playback', async () => {
        // Polyfill Blob.arrayBuffer for JSDOM
        const blob = new Blob([]);
        blob.arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(0));

        // Setup cloud provider
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mockCloudProvider = {
            id: 'cloud',
            init: vi.fn().mockResolvedValue(undefined),
            getVoices: vi.fn().mockResolvedValue([]),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            synthesize: vi.fn().mockResolvedValue({ audio: blob, alignment: [] } as any),
        } as any;

        service.setProvider(mockCloudProvider);

        // Setup queue and play
        service.setQueue([{ text: "Text", cfi: "cfi" }]);
        await service.play();

        // Verify setOnTimeUpdate called
        expect(sharedSpies.setOnTimeUpdate).toHaveBeenCalled();

        // Trigger callback
        const onTimeUpdate = sharedSpies.setOnTimeUpdate.mock.calls[0][0];
        onTimeUpdate(10);

        // Verify setPositionState called
        expect(mediaSessionMock.setPositionState).toHaveBeenCalledWith({
            duration: 120,
            playbackRate: 1,
            position: 10
        });
    });

    it('should update metadata when queue is set', () => {
        service.setQueue([{
            text: "Text",
            cfi: "cfi",
            title: "My Chapter",
            author: "Author",
            bookTitle: "Book"
        }]);

        expect(mediaSessionMock.metadata).toEqual(expect.objectContaining({
            init: expect.objectContaining({
                title: 'My Chapter',
                artist: 'Author',
                album: 'Book'
            })
        }));
    });

    it('should handle seekto action', async () => {
        // Polyfill Blob.arrayBuffer for JSDOM
        const blob = new Blob([]);
        blob.arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(0));

         // Setup cloud provider and player
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mockCloudProvider = {
            id: 'cloud',
            init: vi.fn().mockResolvedValue(undefined),
            getVoices: vi.fn().mockResolvedValue([]),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            synthesize: vi.fn().mockResolvedValue({ audio: blob, alignment: [] } as any),
        } as any;

        service.setProvider(mockCloudProvider);
        service.setQueue([{ text: "Text", cfi: "cfi" }]);
        await service.play();

        // Find seekto handler
        const calls = mediaSessionMock.setActionHandler.mock.calls;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const seekToCall = calls.find((c: any) => c[0] === 'seekto');
        expect(seekToCall).toBeDefined();
        const handler = seekToCall[1];

        // Trigger handler
        handler({ action: 'seekto', seekTime: 45 });

        // Verify seek called on player
        expect(sharedSpies.seek).toHaveBeenCalledWith(45);
    });
});

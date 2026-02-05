import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';
import { Capacitor } from '@capacitor/core';

// Define mockService using vi.hoisted to handle hoisting
const { mockService } = vi.hoisted(() => {
    return {
        mockService: {
            init: vi.fn(),
            play: vi.fn(),
            pause: vi.fn(),
            stop: vi.fn(),
        }
    };
});

// Mock dependencies
vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: vi.fn().mockReturnValue(false)
    }
}));

vi.mock('./PlatformIntegration', () => {
    return {
        PlatformIntegration: class {
            updateMetadata = vi.fn();
            setPositionState = vi.fn();
            updatePlaybackState = vi.fn();
            stop = vi.fn();
            setBackgroundAudioMode = vi.fn();
            setBackgroundVolume = vi.fn();
        }
    }
});

vi.mock('./providers/WebSpeechProvider', () => {
    return {
        WebSpeechProvider: class {
            on = vi.fn();
            play = vi.fn();
            preload = vi.fn();
            stop = vi.fn();
            pause = vi.fn();
            resume = vi.fn();
            init = vi.fn();
            getVoices = vi.fn();
        }
    }
});

vi.mock('./providers/CapacitorTTSProvider', () => {
    return {
        CapacitorTTSProvider: class {
            on = vi.fn();
            play = vi.fn();
            preload = vi.fn();
            stop = vi.fn();
            pause = vi.fn();
            resume = vi.fn();
            init = vi.fn();
            getVoices = vi.fn();
        }
    }
});

vi.mock('comlink', () => {
    return {
        wrap: vi.fn().mockReturnValue(mockService),
        proxy: vi.fn(cb => cb),
        expose: vi.fn()
    }
});

// Mock WorkerWrapper
vi.mock('./worker/audio.worker?worker', () => {
    return {
        default: class MockWorker {
            onmessage = null;
            postMessage = vi.fn();
            terminate = vi.fn();
            addEventListener = vi.fn();
            removeEventListener = vi.fn();
        }
    };
});

describe('AudioPlayerService MediaSession Integration', () => {
    let service: AudioPlayerService;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let platformIntegrationMock: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let workerCallback: any;

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset singleton
        // @ts-expect-error Resetting singleton
        AudioPlayerService.instance = undefined;

        service = AudioPlayerService.getInstance();

        // Capture the callback passed to mockService.init
        if (mockService.init.mock.calls.length > 0) {
            workerCallback = mockService.init.mock.calls[0][0];
        }

        // @ts-expect-error Access private
        platformIntegrationMock = service.platformIntegration;
    });

    it('should update metadata on UPDATE_METADATA callback', () => {
        const metadata = {
            title: 'Title',
            artist: 'Author',
            album: 'Book',
            artwork: [{ src: 'cover.jpg' }]
        };

        // Simulate worker callback
        workerCallback.updateMetadata({ metadata });

        expect(platformIntegrationMock.updateMetadata).toHaveBeenCalledWith(metadata);
    });

    it('should update position state on UPDATE_METADATA callback', () => {
        const positionState = {
            duration: 100,
            playbackRate: 1.0,
            position: 50
        };

        // Simulate worker callback
        workerCallback.updateMetadata({ positionState });

        expect(platformIntegrationMock.setPositionState).toHaveBeenCalledWith(positionState);
    });

    it('should update playback state on STATUS_UPDATE callback', () => {
        // Simulate worker callback
        workerCallback.onStatusUpdate('playing', null, 0, []);

        expect(platformIntegrationMock.updatePlaybackState).toHaveBeenCalledWith('playing');
    });
});

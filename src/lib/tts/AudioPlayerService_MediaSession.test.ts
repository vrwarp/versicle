import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';
import { PlatformIntegration } from './PlatformIntegration';
import { Capacitor } from '@capacitor/core';

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

// Mock WorkerWrapper (from setup.ts mock)
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
    let mockWorker: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let platformIntegrationMock: any;

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset singleton
        // @ts-expect-error Resetting singleton
        AudioPlayerService.instance = undefined;

        service = AudioPlayerService.getInstance();
        // @ts-expect-error Access private
        mockWorker = service.worker;
        // @ts-expect-error Access private
        platformIntegrationMock = service.platformIntegration;
    });

    it('should update metadata on UPDATE_METADATA message', () => {
        const metadata = {
            title: 'Title',
            artist: 'Author',
            album: 'Book',
            artwork: [{ src: 'cover.jpg' }]
        };

        const msg = {
            type: 'UPDATE_METADATA',
            metadata: {
                metadata
            }
        };

        mockWorker.onmessage({ data: msg } as MessageEvent);

        expect(platformIntegrationMock.updateMetadata).toHaveBeenCalledWith(metadata);
    });

    it('should update position state on UPDATE_METADATA message', () => {
        const positionState = {
            duration: 100,
            playbackRate: 1.0,
            position: 50
        };

        const msg = {
            type: 'UPDATE_METADATA',
            metadata: {
                metadata: {},
                positionState
            }
        };

        mockWorker.onmessage({ data: msg } as MessageEvent);

        expect(platformIntegrationMock.setPositionState).toHaveBeenCalledWith(positionState);
    });

    it('should update playback state on STATUS_UPDATE', () => {
        const msg = {
            type: 'STATUS_UPDATE',
            status: 'playing',
            cfi: null,
            index: 0,
            queue: []
        };

        mockWorker.onmessage({ data: msg } as MessageEvent);

        expect(platformIntegrationMock.updatePlaybackState).toHaveBeenCalledWith('playing');
    });
});

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
            next: vi.fn(),
            prev: vi.fn(),
            seek: vi.fn(),
            seekTo: vi.fn(),
            setSpeed: vi.fn(),
            setVoice: vi.fn(),
            setBookId: vi.fn(),
            loadSection: vi.fn(),
            loadSectionBySectionId: vi.fn(),
            setQueue: vi.fn(),
            setPrerollEnabled: vi.fn(),
            setBackgroundAudioMode: vi.fn(),
            setBackgroundVolume: vi.fn(),
            preview: vi.fn(),
            skipToNextSection: vi.fn(),
            skipToPreviousSection: vi.fn(),
            setProvider: vi.fn(),
            getVoices: vi.fn().mockResolvedValue([]),
            isVoiceDownloaded: vi.fn().mockResolvedValue(true),
            downloadVoice: vi.fn(),
            deleteVoice: vi.fn(),
            onRemotePlayStart: vi.fn(),
            onRemotePlayEnded: vi.fn(),
            onRemotePlayError: vi.fn(),
            onRemoteTimeUpdate: vi.fn(),
            onRemoteBoundary: vi.fn(),
            onAudioEnded: vi.fn(),
            onAudioError: vi.fn(),
            onAudioTimeUpdate: vi.fn(),
        }
    };
});

// Mock dependencies
vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: vi.fn().mockReturnValue(false)
    }
}));

// Mock Comlink
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

// Mock Local Providers
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

vi.mock('./PlatformIntegration', () => {
    return {
        PlatformIntegration: class {
            updatePlaybackState = vi.fn();
            updateMetadata = vi.fn();
            setPositionState = vi.fn();
            setBackgroundAudioMode = vi.fn();
            setBackgroundVolume = vi.fn();
            stop = vi.fn();
        }
    }
});

describe('AudioPlayerService (Proxy)', () => {
    let service: AudioPlayerService;
    let callback: any;

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset singleton
        // @ts-expect-error Resetting singleton
        AudioPlayerService.instance = undefined;
        vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    });

    const initService = () => {
        service = AudioPlayerService.getInstance();
        // Capture callback passed to init
        if (mockService.init.mock.calls.length > 0) {
            callback = mockService.init.mock.calls[0][0];
        }
    };

    it('should initialize worker service', () => {
        initService();
        expect(mockService.init).toHaveBeenCalled();
        expect(callback).toBeDefined();
    });

    describe('Proxy Commands', () => {
        beforeEach(() => {
            initService();
        });

        it('should proxy play command', () => {
            service.play();
            expect(mockService.play).toHaveBeenCalled();
        });

        it('should proxy pause command', () => {
            service.pause();
            expect(mockService.pause).toHaveBeenCalled();
        });

        it('should proxy stop command', () => {
            service.stop();
            expect(mockService.stop).toHaveBeenCalled();
        });

        it('should proxy navigation commands', () => {
            service.next();
            expect(mockService.next).toHaveBeenCalled();

            service.prev();
            expect(mockService.prev).toHaveBeenCalled();
        });

        it('should proxy configuration commands', () => {
            service.setSpeed(1.5);
            expect(mockService.setSpeed).toHaveBeenCalledWith(1.5);

            service.setVoice('v1');
            expect(mockService.setVoice).toHaveBeenCalledWith('v1');
        });
    });

    describe('Worker Callbacks', () => {
        beforeEach(() => {
            initService();
        });

        it('should handle onStatusUpdate', () => {
            const listener = vi.fn();
            service.subscribe(listener);

            callback.onStatusUpdate('playing', 'cfi1', 5, [{ text: 'test', cfi: 'cfi1' }]);

            expect(listener).toHaveBeenCalledWith(
                'playing',
                'cfi1',
                5,
                [{ text: 'test', cfi: 'cfi1' }],
                null
            );
        });

        it('should handle onError', () => {
            const listener = vi.fn();
            service.subscribe(listener);

            callback.onError('Worker Error');

            expect(listener).toHaveBeenCalledWith(
                'stopped', // Default
                null,
                0,
                [],
                'Worker Error'
            );
        });

        it('should handle onDownloadProgress', () => {
            const listener = vi.fn();
            service.subscribe(listener);

            callback.onDownloadProgress('v1', 50, 'downloading');

            // listener(status, cfi, index, queue, error, downloadInfo)
            const lastCall = listener.mock.calls[listener.mock.calls.length - 1];
            expect(lastCall[5]).toEqual({
                voiceId: 'v1',
                percent: 50,
                status: 'downloading'
            });
        });
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';
import { Capacitor } from '@capacitor/core';
import { WebSpeechProvider } from './providers/WebSpeechProvider';
import { CapacitorTTSProvider } from './providers/CapacitorTTSProvider';

// Mock dependencies
vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: vi.fn().mockReturnValue(false)
    }
}));

// Mock WorkerWrapper (from setup.ts mock)
// We need to ensure we can inspect postMessage
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

// Mock PlatformIntegration to avoid MediaSession errors
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockWorker: any;

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset singleton
        // @ts-expect-error Resetting singleton
        AudioPlayerService.instance = undefined;

        // Default to web
        vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    });

    const initService = () => {
        service = AudioPlayerService.getInstance();
        // @ts-expect-error Access private
        mockWorker = service.worker;
    };

    it('should initialize worker', () => {
        initService();
        expect(mockWorker).toBeDefined();
        expect(mockWorker.postMessage).toBeDefined();
        // Init message sent in constructor
        expect(mockWorker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'INIT' }));
    });

    it('should initialize WebSpeechProvider on Web', () => {
        vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
        initService();
        // We verify that the class constructor was called
        // Since we mocked the class itself, we can check calls on the mock if we had a spy on it.
        // But vi.mock returns the implementation.
        // We can verify that the private property 'localProvider' is instance of our mock class?
        // Or simpler: access private localProvider and check its constructor name or methods.
        // @ts-expect-error Access private
        expect(service.localProvider).toBeDefined();
        // @ts-expect-error Access private
        expect(service.localProvider.play).toBeDefined();
    });

    it('should initialize CapacitorTTSProvider on Native', () => {
        vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
        initService();
        // @ts-expect-error Access private
        expect(service.localProvider).toBeDefined();
    });

    describe('Proxy Commands', () => {
        beforeEach(() => {
            initService();
        });

        it('should proxy play command', () => {
            service.play();
            expect(mockWorker.postMessage).toHaveBeenCalledWith({ type: 'PLAY' });
        });

        it('should proxy pause command', () => {
            service.pause();
            expect(mockWorker.postMessage).toHaveBeenCalledWith({ type: 'PAUSE' });
        });

        it('should proxy stop command', () => {
            service.stop();
            expect(mockWorker.postMessage).toHaveBeenCalledWith({ type: 'STOP' });
        });

        it('should proxy navigation commands', () => {
            service.next();
            expect(mockWorker.postMessage).toHaveBeenCalledWith({ type: 'NEXT' });

            service.prev();
            expect(mockWorker.postMessage).toHaveBeenCalledWith({ type: 'PREV' });
        });

        it('should proxy configuration commands', () => {
            service.setSpeed(1.5);
            expect(mockWorker.postMessage).toHaveBeenCalledWith({ type: 'SET_SPEED', speed: 1.5 });

            service.setVoice('v1');
            expect(mockWorker.postMessage).toHaveBeenCalledWith({ type: 'SET_VOICE', voiceId: 'v1' });
        });
    });

    describe('Worker Messages', () => {
        beforeEach(() => {
            initService();
        });

        it('should handle STATUS_UPDATE from worker', () => {
            const listener = vi.fn();
            service.subscribe(listener);

            // Simulate worker message
            const msg = {
                type: 'STATUS_UPDATE',
                status: 'playing',
                cfi: 'cfi1',
                index: 5,
                queue: [{ text: 'test', cfi: 'cfi1' }]
            };

            mockWorker.onmessage({ data: msg } as MessageEvent);

            expect(listener).toHaveBeenCalledWith(
                'playing',
                'cfi1',
                5,
                [{ text: 'test', cfi: 'cfi1' }],
                null
            );
        });

        it('should handle ERROR from worker', () => {
            const listener = vi.fn();
            service.subscribe(listener);

            const msg = {
                type: 'ERROR',
                message: 'Worker Error'
            };

            mockWorker.onmessage({ data: msg } as MessageEvent);

            expect(listener).toHaveBeenCalledWith(
                'stopped', // Default status in tests
                null,
                0,
                [],
                'Worker Error'
            );
        });

        it('should handle DOWNLOAD_PROGRESS from worker', () => {
            const listener = vi.fn();
            service.subscribe(listener);

            const msg = {
                type: 'DOWNLOAD_PROGRESS',
                voiceId: 'v1',
                percent: 50,
                status: 'downloading'
            };

            mockWorker.onmessage({ data: msg } as MessageEvent);

            const lastCall = listener.mock.calls[listener.mock.calls.length - 1];
            expect(lastCall[5]).toEqual({ // 6th argument is downloadInfo
                voiceId: 'v1',
                percent: 50,
                status: 'downloading'
            });
        });
    });
});

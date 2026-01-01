import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlatformIntegration } from './PlatformIntegration';

vi.mock('./MediaSessionManager', () => {
    return {
        MediaSessionManager: class {
            setPlaybackState = vi.fn().mockResolvedValue(undefined);
            setMetadata = vi.fn().mockResolvedValue(undefined);
            setPositionState = vi.fn();
        }
    }
});

vi.mock('./BackgroundAudio', () => {
    return {
        BackgroundAudio: class {
            play = vi.fn();
            stopWithDebounce = vi.fn();
            forceStop = vi.fn();
            setVolume = vi.fn();
        }
    }
});

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        getPlatform: vi.fn().mockReturnValue('web'),
        isNativePlatform: vi.fn().mockReturnValue(false)
    }
}));

describe('PlatformIntegration', () => {
    let integration: PlatformIntegration;
    let events = {
        onPlay: vi.fn(),
        onPause: vi.fn(),
        onStop: vi.fn(),
        onPrev: vi.fn(),
        onNext: vi.fn(),
        onSeekBackward: vi.fn(),
        onSeekForward: vi.fn(),
        onSeekTo: vi.fn()
    };

    beforeEach(() => {
        vi.clearAllMocks();
        integration = new PlatformIntegration(events);
    });

    it('should update media session', async () => {
        // @ts-expect-error Access private
        const ms = integration.mediaSessionManager;

        await integration.updateMediaSession(
            { text: 'T', cfi: 'c', title: 'Ti', author: 'A' },
            1, 10, 'playing'
        );

        expect(ms.setPlaybackState).toHaveBeenCalledWith('playing');
        expect(ms.setMetadata).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Ti',
            artist: 'A'
        }));
    });

    it('should handle background audio logic', () => {
        // @ts-expect-error Access private
        const ba = integration.backgroundAudio;

        integration.handleBackgroundAudio('playing');
        expect(ba.play).toHaveBeenCalled();

        integration.handleBackgroundAudio('paused');
        expect(ba.stopWithDebounce).toHaveBeenCalled();

        integration.handleBackgroundAudio('stopped');
        expect(ba.forceStop).toHaveBeenCalled();
    });
});

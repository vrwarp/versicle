import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlatformIntegration } from './PlatformIntegration';

vi.mock('./BackgroundAudio', () => ({
    BackgroundAudio: class {
        play = vi.fn();
        stopWithDebounce = vi.fn();
        forceStop = vi.fn();
        setVolume = vi.fn();
    }
}));

vi.mock('./MediaSessionManager', () => ({
    MediaSessionManager: class {
        setPlaybackState = vi.fn();
        setMetadata = vi.fn();
        setPositionState = vi.fn();
    }
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: vi.fn(() => false)
    }
}));

describe('PlatformIntegration', () => {
    let platform: PlatformIntegration;
    let events: any;

    beforeEach(() => {
        vi.clearAllMocks();
        events = {
            onPlay: vi.fn(),
            onPause: vi.fn(),
            onStop: vi.fn(),
            onPrev: vi.fn(),
            onNext: vi.fn(),
            onSeek: vi.fn(),
            onSeekTo: vi.fn(),
        };
        platform = new PlatformIntegration(events);
    });

    it('should initialize background audio and media session', () => {
        expect(platform).toBeDefined();
    });

    it('should update background audio mode', () => {
        platform.setBackgroundAudioMode('noise', true);
        expect((platform as any).backgroundAudio.play).toHaveBeenCalledWith('noise');
    });

    it('should update playback state', () => {
        platform.updatePlaybackState('playing');
        expect((platform as any).mediaSessionManager.setPlaybackState).toHaveBeenCalledWith('playing');
        expect((platform as any).backgroundAudio.play).toHaveBeenCalled();

        platform.updatePlaybackState('paused');
        expect((platform as any).mediaSessionManager.setPlaybackState).toHaveBeenCalledWith('paused');
        expect((platform as any).backgroundAudio.stopWithDebounce).toHaveBeenCalled();
    });

    it('should update metadata only when changed', () => {
        const metadata = { title: 'Test' } as any;
        platform.updateMetadata(metadata);
        expect((platform as any).mediaSessionManager.setMetadata).toHaveBeenCalledWith(metadata);

        // Call again with same metadata
        vi.clearAllMocks();
        platform.updateMetadata(metadata);
        expect((platform as any).mediaSessionManager.setMetadata).not.toHaveBeenCalled();
    });
});

import type { MediaSessionMetadata } from "./MediaSessionManager";
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
    let events: { onPlay: import("vitest").Mock, onPause: import("vitest").Mock, onStop: import("vitest").Mock, onPrev: import("vitest").Mock, onNext: import("vitest").Mock, onSeek: import("vitest").Mock, onSeekTo: import("vitest").Mock };

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
        // @ts-expect-error accessing private property for testing
        expect(platform.backgroundAudio.play).toHaveBeenCalledWith('noise');
    });

    it('should update playback state', () => {
        platform.updatePlaybackState('playing');
        // @ts-expect-error accessing private property for testing
        expect(platform.mediaSessionManager.setPlaybackState).toHaveBeenCalledWith('playing');
        // @ts-expect-error accessing private property for testing
        expect(platform.backgroundAudio.play).toHaveBeenCalled();

        platform.updatePlaybackState('paused');
        // @ts-expect-error accessing private property for testing
        expect(platform.mediaSessionManager.setPlaybackState).toHaveBeenCalledWith('paused');
        // @ts-expect-error accessing private property for testing
        expect(platform.backgroundAudio.stopWithDebounce).toHaveBeenCalled();
    });

    it('should update metadata based on significance thresholds', () => {
        const m1 = { title: 'T1', sectionIndex: 0, progress: 0.1 } as unknown as MediaSessionMetadata;
        platform.updateMetadata(m1);
        // @ts-expect-error accessing private property for testing
        expect(platform.mediaSessionManager.setMetadata).toHaveBeenCalledTimes(1);

        // Case 1: Negligible progress change (0.1 -> 0.14) - Less than 5%
        vi.clearAllMocks();
        const m2 = { title: 'T1', sectionIndex: 0, progress: 0.14 } as unknown as MediaSessionMetadata;
        platform.updateMetadata(m2);
        // @ts-expect-error accessing private property for testing
        expect(platform.mediaSessionManager.setMetadata).not.toHaveBeenCalled();

        // Case 2: Significant progress change (0.1 -> 0.16) - 6% change
        vi.clearAllMocks();
        const m3 = { title: 'T1', sectionIndex: 0, progress: 0.16 } as unknown as MediaSessionMetadata;
        platform.updateMetadata(m3);
        // @ts-expect-error accessing private property for testing
        expect(platform.mediaSessionManager.setMetadata).toHaveBeenCalledWith(m3);

        // Case 3: Title change (progress same)
        vi.clearAllMocks();
        const m4 = { title: 'T2', sectionIndex: 0, progress: 0.12 } as unknown as MediaSessionMetadata;
        platform.updateMetadata(m4);
        // @ts-expect-error accessing private property for testing
        expect(platform.mediaSessionManager.setMetadata).toHaveBeenCalledWith(m4);

        // Case 4: Chapter change (negligible progress change)
        vi.clearAllMocks();
        const m5 = { title: 'T2', sectionIndex: 1, progress: 0.121 } as unknown as MediaSessionMetadata;
        platform.updateMetadata(m5);
        // @ts-expect-error accessing private property for testing
        expect(platform.mediaSessionManager.setMetadata).toHaveBeenCalledWith(m5);
    });
});

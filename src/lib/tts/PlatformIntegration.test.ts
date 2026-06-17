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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((platform as any).backgroundAudio.play).toHaveBeenCalledWith('noise');
    });

    it('should update playback state', () => {
        platform.updatePlaybackState('playing');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((platform as any).mediaSessionManager.setPlaybackState).toHaveBeenCalledWith('playing');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((platform as any).backgroundAudio.play).toHaveBeenCalled();

        platform.updatePlaybackState('paused');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((platform as any).mediaSessionManager.setPlaybackState).toHaveBeenCalledWith('paused');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((platform as any).backgroundAudio.stopWithDebounce).toHaveBeenCalled();
    });

    it('regression: transient loading/completed report mediaState=playing (native STATE_IDLE avoidance)', () => {
        // BUG-2: mapping inter-utterance 'loading'/'completed' to media-state 'none' drove
        // the native Media3 proxy into Player.STATE_IDLE every utterance boundary, tearing
        // down the notification and thrashing the legacy session (the Bluetooth/AVRCP
        // "metadata to sync" timeout). The media-state fold must agree with the
        // BackgroundAudio fold: anything that keeps background audio playing must also keep
        // the session reporting 'playing'. Reserve 'none' for a genuine stop.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sms = (platform as any).mediaSessionManager.setPlaybackState;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bg = (platform as any).backgroundAudio;

        for (const status of ['loading', 'completed'] as const) {
            vi.clearAllMocks();
            platform.updatePlaybackState(status);
            expect(sms).toHaveBeenCalledWith('playing');
            expect(bg.play).toHaveBeenCalled();
            // Invariant: never report a non-playing media state while background audio plays.
            expect(sms).not.toHaveBeenCalledWith('none');
        }

        // A genuine stop still clears the session and force-stops background audio.
        vi.clearAllMocks();
        platform.updatePlaybackState('stopped');
        expect(sms).toHaveBeenCalledWith('none');
        expect(bg.forceStop).toHaveBeenCalledTimes(1);
    });

    it('should update metadata based on significance thresholds', () => {
        const m1 = { title: 'T1', sectionIndex: 0, progress: 0.1 } as unknown as import('./MediaSessionManager').MediaSessionMetadata;
        platform.updateMetadata(m1);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((platform as any).mediaSessionManager.setMetadata).toHaveBeenCalledTimes(1);

        // Case 1: Negligible progress change (0.1 -> 0.14) - Less than 5%
        vi.clearAllMocks();
        const m2 = { title: 'T1', sectionIndex: 0, progress: 0.14 } as unknown as import('./MediaSessionManager').MediaSessionMetadata;
        platform.updateMetadata(m2);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((platform as any).mediaSessionManager.setMetadata).not.toHaveBeenCalled();

        // Case 2: Significant progress change (0.1 -> 0.16) - 6% change
        vi.clearAllMocks();
        const m3 = { title: 'T1', sectionIndex: 0, progress: 0.16 } as unknown as import('./MediaSessionManager').MediaSessionMetadata;
        platform.updateMetadata(m3);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((platform as any).mediaSessionManager.setMetadata).toHaveBeenCalledWith(m3);

        // Case 3: Title change (progress same)
        vi.clearAllMocks();
        const m4 = { title: 'T2', sectionIndex: 0, progress: 0.12 } as unknown as import('./MediaSessionManager').MediaSessionMetadata;
        platform.updateMetadata(m4);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((platform as any).mediaSessionManager.setMetadata).toHaveBeenCalledWith(m4);

        // Case 4: Chapter change (negligible progress change)
        vi.clearAllMocks();
        const m5 = { title: 'T2', sectionIndex: 1, progress: 0.121 } as unknown as import('./MediaSessionManager').MediaSessionMetadata;
        platform.updateMetadata(m5);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((platform as any).mediaSessionManager.setMetadata).toHaveBeenCalledWith(m5);
    });
});

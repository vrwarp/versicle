import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlatformIntegration } from './PlatformIntegration';
import { BackgroundAudio } from './BackgroundAudio';
import { MediaSessionManager } from './MediaSessionManager';
import { Capacitor } from '@capacitor/core';
import { BatteryOptimization } from '@capawesome-team/capacitor-android-battery-optimization';

vi.mock('./BackgroundAudio');
vi.mock('./MediaSessionManager');
vi.mock('@capacitor/core', () => ({
    Capacitor: {
        getPlatform: vi.fn().mockReturnValue('web'),
        isNativePlatform: vi.fn().mockReturnValue(false)
    }
}));
vi.mock('@capawesome-team/capacitor-android-battery-optimization', () => ({
    BatteryOptimization: {
        isBatteryOptimizationEnabled: vi.fn()
    }
}));

describe('PlatformIntegration', () => {
    let platform: PlatformIntegration;
    const handlers = {
        onPlay: vi.fn(),
        onPause: vi.fn(),
        onStop: vi.fn(),
        onPrev: vi.fn(),
        onNext: vi.fn(),
        onSeekBackward: vi.fn(),
        onSeekForward: vi.fn(),
        onSeekTo: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        platform = new PlatformIntegration(handlers);
    });

    it('should initialize managers', () => {
        expect(BackgroundAudio).toHaveBeenCalled();
        expect(MediaSessionManager).toHaveBeenCalled();
    });

    it('should engage background mode', async () => {
        const item = { text: 'text', cfi: null, title: 'Title' };
        await platform.engageBackgroundMode(item, 1, 10);

        const mediaSessionInstance = vi.mocked(MediaSessionManager).mock.instances[0];
        expect(mediaSessionInstance.setMetadata).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Title',
            sectionIndex: 1,
            totalSections: 10
        }));
        expect(mediaSessionInstance.setPlaybackState).toHaveBeenCalledWith('playing');
    });

    it('should update playback state and handle background audio', () => {
        const backgroundAudioInstance = vi.mocked(BackgroundAudio).mock.instances[0];
        const mediaSessionInstance = vi.mocked(MediaSessionManager).mock.instances[0];

        platform.setPlaybackState('playing');
        expect(mediaSessionInstance.setPlaybackState).toHaveBeenCalledWith('playing');
        expect(backgroundAudioInstance.play).toHaveBeenCalled();

        platform.setPlaybackState('paused');
        expect(mediaSessionInstance.setPlaybackState).toHaveBeenCalledWith('paused');
        expect(backgroundAudioInstance.stopWithDebounce).toHaveBeenCalled();

        platform.setPlaybackState('stopped');
        expect(mediaSessionInstance.setPlaybackState).toHaveBeenCalledWith('none');
        expect(backgroundAudioInstance.forceStop).toHaveBeenCalled();
    });

    it('should check battery optimization on Android', async () => {
        (Capacitor.getPlatform as any).mockReturnValue('android');
        (BatteryOptimization.isBatteryOptimizationEnabled as any).mockResolvedValue({ enabled: true });

        await platform.checkBatteryOptimization();

        expect(BatteryOptimization.isBatteryOptimizationEnabled).toHaveBeenCalled();
    });
});

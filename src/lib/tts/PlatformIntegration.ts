import { BackgroundAudio, type BackgroundAudioMode } from './BackgroundAudio';
import { MediaSessionManager, type MediaSessionMetadata } from './MediaSessionManager';
import { Capacitor } from '@capacitor/core';
import { BatteryOptimization } from '@capawesome-team/capacitor-android-battery-optimization';
import type { TTSQueueItem } from './AudioPlayerService';

export interface PlatformHandlers {
    onPlay: () => void;
    onPause: () => void;
    onStop: () => void;
    onPrev: () => void;
    onNext: () => void;
    onSeekBackward: () => void;
    onSeekForward: () => void;
    onSeekTo: (time: number) => void;
}

export class PlatformIntegration {
    private backgroundAudio: BackgroundAudio;
    private backgroundAudioMode: BackgroundAudioMode = 'silence';
    private mediaSessionManager: MediaSessionManager;
    private lastMetadata: MediaSessionMetadata | null = null;

    constructor(handlers: PlatformHandlers) {
        this.backgroundAudio = new BackgroundAudio();
        this.mediaSessionManager = new MediaSessionManager({
            onPlay: handlers.onPlay,
            onPause: handlers.onPause,
            onStop: handlers.onStop,
            onPrev: handlers.onPrev,
            onNext: handlers.onNext,
            onSeekBackward: handlers.onSeekBackward,
            onSeekForward: handlers.onSeekForward,
            onSeekTo: (details) => {
                 if (details.seekTime !== undefined) {
                     handlers.onSeekTo(details.seekTime);
                 }
            },
        });
    }

    async engageBackgroundMode(item: TTSQueueItem, currentSectionIndex: number, totalSections: number): Promise<boolean> {
        try {
            await this.updateMediaMetadata(item, currentSectionIndex, totalSections);
            await this.mediaSessionManager.setPlaybackState('playing');
            return true;
        } catch (e) {
            console.error('Background engagement failed', e);
            return false;
        }
    }

    async updateMediaMetadata(item: TTSQueueItem, currentSectionIndex: number, totalSections: number) {
        const newMetadata: MediaSessionMetadata = {
            title: item.title || 'Chapter Text',
            artist: item.author || 'Versicle',
            album: item.bookTitle || '',
            artwork: item.coverUrl ? [{ src: item.coverUrl }] : [],
            sectionIndex: currentSectionIndex,
            totalSections: totalSections
        };

        if (this.lastMetadata && JSON.stringify(this.lastMetadata) === JSON.stringify(newMetadata)) {
            return;
        }

        this.mediaSessionManager.setMetadata(newMetadata);
        this.lastMetadata = newMetadata;
    }

    updatePositionState(duration: number, position: number, speed: number) {
        this.mediaSessionManager.setPositionState({
            duration,
            playbackRate: speed,
            position
        });
    }

    setPlaybackState(status: 'playing' | 'paused' | 'stopped' | 'loading' | 'completed') {
        this.mediaSessionManager.setPlaybackState(
            status === 'playing' ? 'playing' : (status === 'paused' ? 'paused' : 'none')
        );

        if (status === 'playing' || status === 'loading' || status === 'completed') {
            this.backgroundAudio.play(this.backgroundAudioMode);
        } else if (status === 'paused') {
            this.backgroundAudio.stopWithDebounce(500);
        } else {
            this.backgroundAudio.forceStop();
        }
    }

    setBackgroundAudioMode(mode: BackgroundAudioMode, isPlaying: boolean) {
        this.backgroundAudioMode = mode;
        if (isPlaying) {
            this.backgroundAudio.play(mode);
        }
    }

    setBackgroundVolume(volume: number) {
        this.backgroundAudio.setVolume(volume);
    }

    async checkBatteryOptimization() {
        if (Capacitor.getPlatform() === 'android') {
            try {
                const isEnabled = await BatteryOptimization.isBatteryOptimizationEnabled();
                if (isEnabled.enabled) {
                    // Placeholder for future prompting logic
                }
            } catch (e) {
                console.warn("Battery optimization check failed", e);
            }
        }
    }
}

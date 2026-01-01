import { MediaSessionManager, type MediaSessionMetadata } from './MediaSessionManager';
import { BackgroundAudio, type BackgroundAudioMode } from './BackgroundAudio';
import { Capacitor } from '@capacitor/core';
import { BatteryOptimization } from '@capawesome-team/capacitor-android-battery-optimization';
import type { TTSQueueItem } from './AudioPlayerService';

export interface PlatformEvents {
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
    private mediaSessionManager: MediaSessionManager;
    private backgroundAudio: BackgroundAudio;
    private backgroundAudioMode: BackgroundAudioMode = 'silence';

    constructor(events: PlatformEvents) {
        this.backgroundAudio = new BackgroundAudio();
        this.mediaSessionManager = new MediaSessionManager({
            onPlay: events.onPlay,
            onPause: events.onPause,
            onStop: events.onStop,
            onPrev: events.onPrev,
            onNext: events.onNext,
            onSeekBackward: events.onSeekBackward,
            onSeekForward: events.onSeekForward,
            onSeekTo: (details) => {
                 if (details.seekTime !== undefined) {
                     events.onSeekTo(details.seekTime);
                 }
            },
        });
    }

    async updateMediaSession(
        item: TTSQueueItem | undefined,
        sectionIndex: number,
        totalSections: number,
        playbackState: 'playing' | 'paused' | 'none',
        positionState?: { duration: number, playbackRate: number, position: number }
    ) {
        this.mediaSessionManager.setPlaybackState(playbackState);

        if (item) {
             const newMetadata: MediaSessionMetadata = {
                title: item.title || 'Chapter Text',
                artist: item.author || 'Versicle',
                album: item.bookTitle || '',
                artwork: item.coverUrl ? [{ src: item.coverUrl }] : [],
                sectionIndex: sectionIndex,
                totalSections: totalSections
            };
            this.mediaSessionManager.setMetadata(newMetadata);
        }

        if (positionState) {
            this.mediaSessionManager.setPositionState(positionState);
        }
    }

    async setPlaybackState(state: 'playing' | 'paused' | 'none') {
        await this.mediaSessionManager.setPlaybackState(state);
    }

    updatePosition(state: { duration: number, playbackRate: number, position: number }) {
        this.mediaSessionManager.setPositionState(state);
    }

    setBackgroundAudioMode(mode: BackgroundAudioMode) {
        this.backgroundAudioMode = mode;
    }

    setBackgroundVolume(volume: number) {
        this.backgroundAudio.setVolume(volume);
    }

    handleBackgroundAudio(status: 'playing' | 'loading' | 'paused' | 'stopped' | 'completed') {
        if (status === 'playing' || status === 'loading' || status === 'completed') {
            this.backgroundAudio.play(this.backgroundAudioMode);
        } else if (status === 'paused') {
            this.backgroundAudio.stopWithDebounce(500);
        } else {
            this.backgroundAudio.forceStop();
        }
    }

    async checkBatteryOptimization() {
        if (Capacitor.getPlatform() === 'android') {
            const isEnabled = await BatteryOptimization.isBatteryOptimizationEnabled();
            if (isEnabled.enabled) {
                // TODO: Prompt user to disable optimization
            }
        }
    }
}

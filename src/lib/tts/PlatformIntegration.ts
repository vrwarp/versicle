import { BackgroundAudio, type BackgroundAudioMode } from './BackgroundAudio';
import { MediaSessionManager, type MediaSessionMetadata } from './MediaSessionManager';
import { Capacitor } from '@capacitor/core';
import type { TTSStatus } from './AudioPlayerService';

export interface PlatformEvents {
    onPlay: () => void;
    onPause: () => void;
    onStop: () => void;
    onPrev: () => void;
    onNext: () => void;
    onSeek: (offset: number) => void;
    onSeekTo: (time: number) => void;
}

export class PlatformIntegration {
    private backgroundAudio: BackgroundAudio;
    private backgroundAudioMode: BackgroundAudioMode = 'silence';
    private mediaSessionManager: MediaSessionManager;
    private lastMetadata: MediaSessionMetadata | null = null;

    constructor(events: PlatformEvents) {
        this.backgroundAudio = new BackgroundAudio();
        this.mediaSessionManager = new MediaSessionManager({
            onPlay: events.onPlay,
            onPause: events.onPause,
            onStop: events.onStop,
            onPrev: events.onPrev,
            onNext: events.onNext,
            onSeekBackward: () => events.onSeek(-10),
            onSeekForward: () => events.onSeek(10),
            onSeekTo: (details) => {
                if (details.seekTime !== undefined) {
                    events.onSeekTo(details.seekTime);
                }
            },
        });
    }

    setBackgroundAudioMode(mode: BackgroundAudioMode, isPlaying: boolean) {
        this.backgroundAudioMode = mode;
        if (isPlaying) {
            this.backgroundAudio.play(mode);
        }
    }

    getBackgroundAudioMode(): BackgroundAudioMode {
        return this.backgroundAudioMode;
    }

    setBackgroundVolume(volume: number) {
        this.backgroundAudio.setVolume(volume);
    }

    updatePlaybackState(status: TTSStatus) {
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

    updateMetadata(metadata: MediaSessionMetadata) {
        if (this.lastMetadata && JSON.stringify(this.lastMetadata) === JSON.stringify(metadata)) {
            return;
        }
        this.mediaSessionManager.setMetadata(metadata);
        this.lastMetadata = metadata;
    }

    setPositionState(state: { duration: number, playbackRate: number, position: number }) {
        this.mediaSessionManager.setPositionState(state);
    }

    async stop() {
        if (Capacitor.isNativePlatform()) {
            try {
                await this.mediaSessionManager.setPlaybackState('none');
            } catch (e) { console.warn(e); }
        }
        this.backgroundAudio.forceStop();
    }
}

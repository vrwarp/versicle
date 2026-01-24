import { BackgroundAudio, type BackgroundAudioMode } from './BackgroundAudio';
import { MediaSessionManager, type MediaSessionMetadata } from './MediaSessionManager';
import { Capacitor } from '@capacitor/core';
import type { TTSStatus } from './AudioPlayerService';
import { createLogger } from '../logger';

const logger = createLogger('PlatformIntegration');

/**
 * Interface defining the platform control events received from the OS.
 */
export interface PlatformEvents {
    /** Triggered when the user presses Play on the lock screen or control center. */
    onPlay: () => void;
    /** Triggered when the user presses Pause. */
    onPause: () => void;
    /** Triggered when the user presses Stop. */
    onStop: () => void;
    /** Triggered when the user presses Previous Track. */
    onPrev: () => void;
    /** Triggered when the user presses Next Track. */
    onNext: () => void;
    /**
     * Triggered when the user seeks by a relative offset.
     * @param offset The time in seconds to seek (positive or negative).
     */
    onSeek: (offset: number) => void;
    /**
     * Triggered when the user seeks to a specific timestamp.
     * @param time The target timestamp in seconds.
     */
    onSeekTo: (time: number) => void;
}

/**
 * Handles interactions with platform-specific audio features.
 * Manages the Media Session API (metadata, lock screen controls) and
 * Background Audio persistence (silent audio loop).
 */
export class PlatformIntegration {
    private backgroundAudio: BackgroundAudio;
    private backgroundAudioMode: BackgroundAudioMode = 'silence';
    private mediaSessionManager: MediaSessionManager;
    private lastMetadata: MediaSessionMetadata | null = null;

    /**
     * Creates a new PlatformIntegration instance.
     *
     * @param {PlatformEvents} events Callback handlers for platform control events.
     */
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

    /**
     * Sets the mode for the background audio loop.
     *
     * @param {BackgroundAudioMode} mode The desired audio mode (e.g., 'silence', 'noise').
     * @param {boolean} isPlaying Whether playback is currently active.
     */
    setBackgroundAudioMode(mode: BackgroundAudioMode, isPlaying: boolean) {
        this.backgroundAudioMode = mode;
        if (isPlaying) {
            this.backgroundAudio.play(mode);
        }
    }

    /**
     * Gets the current background audio mode.
     * @returns {BackgroundAudioMode} The active mode.
     */
    getBackgroundAudioMode(): BackgroundAudioMode {
        return this.backgroundAudioMode;
    }

    /**
     * Sets the volume for the background audio track.
     *
     * @param {number} volume The volume level (0.0 to 1.0).
     */
    setBackgroundVolume(volume: number) {
        this.backgroundAudio.setVolume(volume);
    }

    /**
     * Synchronizes the platform's playback state with the player's internal status.
     * Updates Media Session state and manages the background audio loop.
     *
     * @param {TTSStatus} status The current player status.
     */
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

    /**
     * Updates the metadata displayed on the lock screen and control center.
     *
     * @param {MediaSessionMetadata} metadata The new metadata.
     */
    updateMetadata(metadata: MediaSessionMetadata) {
        if (this.lastMetadata && JSON.stringify(this.lastMetadata) === JSON.stringify(metadata)) {
            return;
        }
        this.mediaSessionManager.setMetadata(metadata);
        this.lastMetadata = metadata;
    }

    /**
     * Updates the playback position state for the Media Session.
     *
     * @param {object} state Position state.
     * @param {number} state.duration Total duration in seconds.
     * @param {number} state.playbackRate Current playback rate.
     * @param {number} state.position Current position in seconds.
     */
    setPositionState(state: { duration: number, playbackRate: number, position: number }) {
        this.mediaSessionManager.setPositionState(state);
    }

    /**
     * Stops all platform integration features.
     * Clears the Media Session and forces the background audio to stop.
     */
    async stop() {
        if (Capacitor.isNativePlatform()) {
            try {
                await this.mediaSessionManager.setPlaybackState('none');
            } catch (e) { logger.warn('Error stopping media session:', e); }
        }
        this.backgroundAudio.forceStop();
    }
}

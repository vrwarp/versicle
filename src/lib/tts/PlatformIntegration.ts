import { BackgroundAudio, type BackgroundAudioMode } from './BackgroundAudio';
import { MediaSessionManager, type MediaSessionMetadata } from './MediaSessionManager';
import { Capacitor } from '@capacitor/core';
import type { TTSStatus } from './engine/TtsEngine';
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
 * The slice of platform integration the engine core depends on (media-session metadata,
 * lock-screen playback state, and the background-audio keep-alive loop). Abstracted so the
 * worker-resident engine can inject a stub or a main-thread proxy: all of these reach
 * `navigator.mediaSession` / `HTMLAudioElement`, which don't exist in a Worker.
 */
export interface MediaPlatform {
    setBackgroundAudioMode(mode: BackgroundAudioMode, isPlaying: boolean): void;
    getBackgroundAudioMode(): BackgroundAudioMode;
    setBackgroundVolume(volume: number): void;
    updatePlaybackState(status: TTSStatus): void;
    updateMetadata(metadata: MediaSessionMetadata): void;
    setPositionState(state: { duration: number; playbackRate: number; position: number }): void;
    stop(): Promise<void>;
}

/** Builds a {@link MediaPlatform} wired to the given OS-control callbacks. */
export type MediaPlatformFactory = (events: PlatformEvents) => MediaPlatform;

/**
 * Handles interactions with platform-specific audio features.
 * Manages the Media Session API (metadata, lock screen controls) and
 * Background Audio persistence (silent audio loop).
 */
export class PlatformIntegration implements MediaPlatform {
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
        // 'loading' and 'completed' are transient inter-utterance states. Folding them
        // into mediaState 'playing' is LOAD-BEARING on NATIVE: it keeps the native
        // media-session proxy (the Media3 WebViewProxyPlayer) out of Player.STATE_IDLE
        // across utterance boundaries, so Media3's shouldShowNotification /
        // shouldRunInForeground stay true and the notification does not flicker or tear
        // down (and the legacy session stops thrashing, which is what the Bluetooth/AVRCP
        // "metadata to sync" timeout was reacting to). This intentionally mirrors the
        // BackgroundAudio fold immediately below. Do NOT narrow this back toward 'none'.
        // On web it is the cosmetic navigator.mediaSession.playbackState enum (no
        // timeline/foreground gate); scrubber motion is driven by setPositionState, not
        // this line. 'none' is reserved for a genuine stop.
        this.mediaSessionManager.setPlaybackState(
            (status === 'playing' || status === 'loading' || status === 'completed') ? 'playing'
                : (status === 'paused' ? 'paused' : 'none')
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
     * Implements a "deadband" for progress updates to prevent excessive
     * Bluetooth head unit refreshes (flickering) on minor progress changes.
     *
     * @param {MediaSessionMetadata} metadata The new metadata.
     */
    updateMetadata(metadata: MediaSessionMetadata) {
        if (this.lastMetadata) {
            const titleChanged = this.lastMetadata.title !== metadata.title;
            const artistChanged = this.lastMetadata.artist !== metadata.artist;
            const albumChanged = this.lastMetadata.album !== metadata.album;
            const artworkSrcChanged = this.lastMetadata.artwork?.[0]?.src !== metadata.artwork?.[0]?.src;
            const sectionChanged = this.lastMetadata.sectionIndex !== metadata.sectionIndex;

            // Determine if the progress (for the conic overlay) has moved significantly (at least 5%)
            let progressMovedSignificantly = false;
            if (metadata.progress !== undefined) {
                if (this.lastMetadata.progress === undefined) {
                    progressMovedSignificantly = true;
                } else {
                    const diff = Math.abs(metadata.progress - this.lastMetadata.progress);
                    if (diff >= 0.05) {
                        progressMovedSignificantly = true;
                    }
                }
            }

            // If nothing important has changed and progress hasn't hit the 5% threshold, skip update
            if (!titleChanged && !artistChanged && !albumChanged && !artworkSrcChanged && !sectionChanged && !progressMovedSignificantly) {
                return;
            }
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

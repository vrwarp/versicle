import { Capacitor } from '@capacitor/core';

/**
 * Metadata for the Media Session API.
 */
export interface MediaSessionMetadata {
  /** The title of the media. */
  title: string;
  /** The artist/author of the media. */
  artist: string;
  /** The album/collection name. */
  album: string;
  /** Array of artwork images. */
  artwork?: { src: string; sizes?: string; type?: string }[];
}

/**
 * Callbacks for Media Session action handlers.
 */
export interface MediaSessionCallbacks {
  onPlay?: () => void;
  onPause?: () => void;
  onStop?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onSeekBackward?: (details?: MediaSessionActionDetails) => void;
  onSeekForward?: (details?: MediaSessionActionDetails) => void;
  onSeekTo?: (details: MediaSessionActionDetails) => void;
}

/**
 * Represents the current state of playback.
 */
export interface PlaybackState {
    playbackState: 'playing' | 'paused' | 'none';
    playbackSpeed?: number;
    position?: number;
    duration?: number;
}

/**
 * Wrapper for the Media Session API to integrate browser media controls.
 * Allows controlling playback from hardware keys, notification center, or lock screen.
 * Handles both Native (Capacitor) and Web environments via standard Web API.
 */
export class MediaSessionManager {
  private hasWebMediaSession = typeof navigator !== 'undefined' && 'mediaSession' in navigator;

  /**
   * Initializes the MediaSessionManager with the provided callbacks.
   *
   * @param callbacks - The set of action handlers for media events.
   */
  constructor(private callbacks: MediaSessionCallbacks) {
    this.setupActionHandlers();
  }

  /**
   * Sets up the action handlers for the Media Session API.
   */
  private async setupActionHandlers() {
    if (this.hasWebMediaSession) {
        const actionHandlers: [MediaSessionAction, MediaSessionActionHandler | undefined][] = [
          ['play', this.callbacks.onPlay],
          ['pause', this.callbacks.onPause],
          ['stop', this.callbacks.onStop],
          ['previoustrack', this.callbacks.onPrev],
          ['nexttrack', this.callbacks.onNext],
          ['seekbackward', this.callbacks.onSeekBackward],
          ['seekforward', this.callbacks.onSeekForward],
          ['seekto', this.callbacks.onSeekTo],
        ];

        actionHandlers.forEach(([action, handler]) => {
          try {
            if (handler) {
              navigator.mediaSession.setActionHandler(action, handler);
            } else {
                navigator.mediaSession.setActionHandler(action, null);
            }
          } catch {
            console.warn(`MediaSession action '${action}' is not supported.`);
          }
        });
    }
  }

  /**
   * Updates the media metadata (Title, Artist, Artwork).
   *
   * @param metadata - The new metadata to display.
   */
  async setMetadata(metadata: MediaSessionMetadata) {
    if (this.hasWebMediaSession) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        navigator.mediaSession.metadata = new (window as any).MediaMetadata({
          title: metadata.title,
          artist: metadata.artist,
          album: metadata.album,
          artwork: metadata.artwork
        });
    }
  }

  /**
   * Updates the playback state (playing/paused) and optionally position state.
   *
   * @param state - The current playback state or just the string 'playing' | 'paused' | 'none' for compatibility.
   */
  async setPlaybackState(state: PlaybackState | 'playing' | 'paused' | 'none') {
    const playbackState = typeof state === 'string' ? state : state.playbackState;
    const playbackSpeed = typeof state === 'string' ? 1.0 : state.playbackSpeed;

    const position = typeof state === 'string' ? undefined : state.position;
    const duration = typeof state === 'string' ? undefined : state.duration;

    if (this.hasWebMediaSession) {
        navigator.mediaSession.playbackState = playbackState;
        if (position !== undefined && duration !== undefined && 'setPositionState' in navigator.mediaSession) {
             navigator.mediaSession.setPositionState({
                duration: duration,
                playbackRate: playbackSpeed || 1.0,
                position: position
            });
        }
    }
  }

  /**
   * Updates the position state (duration, playback rate, current time).
   * Kept for backward compatibility with Web implementation usage.
   *
   * @param state - The current position state.
   */
  setPositionState(state: MediaPositionState) {
    if (this.hasWebMediaSession && 'setPositionState' in navigator.mediaSession) {
        try {
            navigator.mediaSession.setPositionState(state);
        } catch (e) {
            console.warn("Failed to set MediaSession position state", e);
        }
    }
  }
}

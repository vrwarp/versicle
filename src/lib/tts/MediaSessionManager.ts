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
  onSeekBackward?: (details: MediaSessionActionDetails) => void;
  onSeekForward?: (details: MediaSessionActionDetails) => void;
  onSeekTo?: (details: MediaSessionActionDetails) => void;
}

/**
 * Wrapper for the Media Session API to integrate browser media controls.
 * Allows controlling playback from hardware keys, notification center, or lock screen.
 */
export class MediaSessionManager {
  private hasMediaSession: boolean;

  /**
   * Initializes the MediaSessionManager with the provided callbacks.
   *
   * @param callbacks - The set of action handlers for media events.
   */
  constructor(private callbacks: MediaSessionCallbacks) {
    this.hasMediaSession = typeof navigator !== 'undefined' && 'mediaSession' in navigator;
    if (this.hasMediaSession) {
      this.setupActionHandlers();
    }
  }

  /**
   * Sets up the action handlers for the Media Session API.
   */
  private setupActionHandlers() {
    if (!this.hasMediaSession) return;

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
            // Unset handler if not provided
            navigator.mediaSession.setActionHandler(action, null);
        }
      } catch {
        console.warn(`MediaSession action '${action}' is not supported.`);
      }
    });
  }

  /**
   * Updates the media metadata (Title, Artist, Artwork).
   *
   * @param metadata - The new metadata to display.
   */
  setMetadata(metadata: MediaSessionMetadata) {
    if (!this.hasMediaSession) return;

    // TODO: Sanitize or process artwork URL if needed (e.g., ensure it's not an expired Blob URL)
    // For now, we assume the caller passes a valid URL.

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    navigator.mediaSession.metadata = new (window as any).MediaMetadata({
      title: metadata.title,
      artist: metadata.artist,
      album: metadata.album,
      artwork: metadata.artwork
    });
  }

  /**
   * Updates the playback state (playing/paused).
   *
   * @param state - The current playback state.
   */
  setPlaybackState(state: 'playing' | 'paused' | 'none') {
    if (!this.hasMediaSession) return;
    navigator.mediaSession.playbackState = state;
  }

  /**
   * Updates the position state (duration, playback rate, current time).
   *
   * @param state - The current position state.
   */
  setPositionState(state: MediaPositionState) {
    if (!this.hasMediaSession || !('setPositionState' in navigator.mediaSession)) return;
    try {
        navigator.mediaSession.setPositionState(state);
    } catch (e) {
        // Ignore errors if state is invalid (e.g., duration < position)
        console.warn("Failed to set MediaSession position state", e);
    }
  }
}

export interface MediaSessionMetadata {
  title: string;
  artist: string;
  album: string;
  artwork?: { src: string; sizes?: string; type?: string }[];
}

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

export class MediaSessionManager {
  private hasMediaSession: boolean;

  constructor(private callbacks: MediaSessionCallbacks) {
    this.hasMediaSession = typeof navigator !== 'undefined' && 'mediaSession' in navigator;
    if (this.hasMediaSession) {
      this.setupActionHandlers();
    }
  }

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
      } catch (e) {
        console.warn(`MediaSession action '${action}' is not supported.`);
      }
    });
  }

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

  setPlaybackState(state: 'playing' | 'paused' | 'none') {
    if (!this.hasMediaSession) return;
    navigator.mediaSession.playbackState = state;
  }

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

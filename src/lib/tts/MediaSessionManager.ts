import { Capacitor } from '@capacitor/core';
import { MediaSession } from '@jofr/capacitor-media-session';
import { Filesystem, Directory } from '@capacitor/filesystem';
import writeBlob from 'capacitor-blob-writer';

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
 * Handles both Native (Capacitor) and Web environments.
 */
export class MediaSessionManager {
  private isNative = Capacitor.isNativePlatform();
  private hasWebMediaSession = typeof navigator !== 'undefined' && 'mediaSession' in navigator;
  private artworkCounter = 0;

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
    if (this.isNative) {
        // NATIVE MODE
        await this.setNativeActionHandler('play', this.callbacks.onPlay);
        await this.setNativeActionHandler('pause', this.callbacks.onPause);
        await this.setNativeActionHandler('stop', this.callbacks.onStop);
        await this.setNativeActionHandler('nexttrack', this.callbacks.onNext);
        await this.setNativeActionHandler('previoustrack', this.callbacks.onPrev);
        await this.setNativeActionHandler('seekbackward', this.callbacks.onSeekBackward);
        await this.setNativeActionHandler('seekforward', this.callbacks.onSeekForward);
    } else if (this.hasWebMediaSession) {
        // WEB MODE
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async setNativeActionHandler(action: string, handler?: (...args: any[]) => void) {
      if (handler) {
          // The types for MediaSessionAction might not perfectly align with string but it works at runtime or needs explicit casting
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await MediaSession.setActionHandler({ action: action as any }, handler);
      }
  }

  /**
   * Updates the media metadata (Title, Artist, Artwork).
   *
   * @param metadata - The new metadata to display.
   */
  async setMetadata(metadata: MediaSessionMetadata) {
    if (this.isNative) {
        let artwork = metadata.artwork;

        // Persist blob artwork to disk for native display
        if (artwork && artwork.length > 0 && artwork[0].src.startsWith('blob:')) {
            try {
                const processedArtwork = await this.processNativeArtwork(artwork[0]);
                if (processedArtwork) {
                    artwork = [processedArtwork];
                }
            } catch (e) {
                console.error("Failed to process native artwork", e);
            }
        }

        await MediaSession.setMetadata({
            title: metadata.title,
            artist: metadata.artist,
            album: metadata.album,
            artwork: artwork
        });
    } else if (this.hasWebMediaSession) {
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
   * Fetches blob data, writes it to a rolling cache file, and returns the native URI.
   */
  private async processNativeArtwork(artwork: { src: string; sizes?: string; type?: string }): Promise<{ src: string; sizes?: string; type?: string } | null> {
    try {
        const response = await fetch(artwork.src);
        const blob = await response.blob();

        const filename = `temp_artwork_${this.artworkCounter}.png`;
        this.artworkCounter = (this.artworkCounter + 1) % 10;

        await writeBlob({
            path: filename,
            directory: Directory.Cache,
            blob: blob,
            fast_mode: true,
            recursive: true
        });

        const uriResult = await Filesystem.getUri({
            path: filename,
            directory: Directory.Cache
        });

        if (uriResult && uriResult.uri) {
            return {
                ...artwork,
                src: uriResult.uri
            };
        }
    } catch (e) {
        console.error("Error processing native artwork", e);
    }
    return null;
  }

  /**
   * Updates the playback state (playing/paused) and optionally position state.
   *
   * @param state - The current playback state or just the string 'playing' | 'paused' | 'none' for compatibility.
   */
  async setPlaybackState(playbackState: 'playing' | 'paused' | 'none') {
    if (this.isNative) {
        await MediaSession.setPlaybackState({
            playbackState,
        });
    } else if (this.hasWebMediaSession) {
        navigator.mediaSession.playbackState = playbackState;
    }
  }

  /**
   * Updates the position state (duration, playback rate, current time).
   * Kept for backward compatibility with Web implementation usage.
   *
   * @param state - The current position state.
   */
  setPositionState(state: MediaPositionState) {
    if (this.isNative) {
        MediaSession.setPositionState({
            duration: state.duration,
            playbackRate: state.playbackRate,
            position: state.position
        }).catch(e => console.warn("Failed to set native position state", e));
    } else if (this.hasWebMediaSession && 'setPositionState' in navigator.mediaSession) {
        try {
            navigator.mediaSession.setPositionState(state);
        } catch (e) {
            console.warn("Failed to set MediaSession position state", e);
        }
    }
  }
}

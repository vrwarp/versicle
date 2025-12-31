import { Capacitor } from '@capacitor/core';
import { MediaSession } from '@jofr/capacitor-media-session';

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
  /** The index of the current section (0-based). */
  sectionIndex?: number;
  /** The total number of sections in the book. */
  totalSections?: number;
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
    let artwork = metadata.artwork;

    // Process artwork (fetch, crop to square, convert to base64) for both Native and Web
    if (artwork && artwork.length > 0) {
        try {
            // We process the first artwork item as the primary cover
            const processedArtwork = await this.processArtwork(artwork[0], metadata.sectionIndex, metadata.totalSections);
            if (processedArtwork) {
                artwork = [processedArtwork];
            }
        } catch (e) {
            console.warn("Failed to process artwork", e);
        }
    }

    if (this.isNative) {
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
          artwork: artwork
        });
    }
  }

  /**
   * Fetches the artwork, crops it to a square, and converts it to a base64 Data URL.
   */
  private async processArtwork(
      artwork: { src: string; sizes?: string; type?: string },
      sectionIndex?: number,
      totalSections?: number
  ): Promise<{ src: string; sizes?: string; type?: string } | null> {
    try {
      let progress: number | undefined;
      if (sectionIndex !== undefined && totalSections !== undefined && totalSections > 0) {
          progress = Math.min(Math.max((sectionIndex + 1) / totalSections, 0), 1);
      }

      // Crop to square and get base64 directly from URL
      const base64 = await this.cropAndOverlayArtwork(artwork.src, progress);

      return {
        ...artwork,
        src: base64,
        type: 'image/png' // Canvas export defaults to PNG usually, unless specified
      };
    } catch (e) {
      console.warn("Error processing artwork", e);
      return null;
    }
  }

  /**
   * Crops a given image URL to a center square and returns it as a base64 string.
   * Optionally applies a conic gradient overlay to indicate reading progress.
   */
  private cropAndOverlayArtwork(src: string, progress?: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous'; // Needed if the source is external

        img.onload = () => {
            try {
                // Determine crop dimensions (min side)
                const size = Math.min(img.width, img.height);

                // Create canvas
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error("Could not get canvas context"));
                    return;
                }

                // Calculate source rectangle for center crop
                const sx = (img.width - size) / 2;
                const sy = (img.height - size) / 2;

                // Draw to canvas
                ctx.drawImage(img, sx, sy, size, size, 0, 0, size, size);

                // Apply conic gradient overlay if progress info is available
                if (progress !== undefined) {
                    // Check browser support for createConicGradient
                    if (ctx.createConicGradient) {
                        const cx = size / 2;
                        const cy = size / 2;

                        // Start from top (12 o'clock), so rotate -PI/2
                        const gradient = ctx.createConicGradient(-Math.PI / 2, cx, cy);

                        const overlayColor = 'rgba(255, 255, 255, 0.4)';
                        const transparent = 'rgba(0, 0, 0, 0)';

                        gradient.addColorStop(0, overlayColor);
                        gradient.addColorStop(progress, overlayColor);
                        // If fully complete, the whole circle is overlayColor.
                        // If not, transition sharply to transparent.
                        if (progress < 1) {
                            gradient.addColorStop(progress, transparent);
                            gradient.addColorStop(1, transparent);
                        }

                        ctx.fillStyle = gradient;
                        ctx.fillRect(0, 0, size, size);
                    }
                }

                // Convert to base64
                const dataUrl = canvas.toDataURL('image/png');
                resolve(dataUrl);
            } catch (e) {
                reject(e);
            }
        };

        img.onerror = () => {
             // If image load fails, we can't process it.
             reject(new Error("Failed to load image for cropping"));
        };

        img.src = src;
    });
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

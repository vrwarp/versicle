import { Capacitor } from '@capacitor/core';
import { MediaSession } from '@jofr/capacitor-media-session';
import { ForegroundService } from '@capawesome-team/capacitor-android-foreground-service';

/**
 * Metadata for the Media Session API (Title, Artist, Artwork).
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
 * These connect the OS-level controls to the app's internal logic.
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
 * Represents the current state of playback for updating the OS UI.
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
 * Handles platform divergence between Web and Native (Capacitor/Android) implementations.
 */
export class MediaSessionManager {
  private isNative = Capacitor.isNativePlatform();
  private hasWebMediaSession = typeof navigator !== 'undefined' && 'mediaSession' in navigator;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private stopTimer: any | null = null;
  private currentMetadata: MediaSessionMetadata | null = null;

  /**
   * Initializes the MediaSessionManager with the provided callbacks.
   * Sets up platform-specific channels (Android notifications) and action handlers.
   *
   * @param callbacks - The set of action handlers for media events.
   */
  constructor(private callbacks: MediaSessionCallbacks) {
    this.setupActionHandlers();
    this.setupAndroidChannel();
  }

  /**
   * Configures the Android Notification Channel required for Foreground Services.
   */
  private async setupAndroidChannel() {
      if (this.isNative && Capacitor.getPlatform() === 'android') {
          try {
              await ForegroundService.createNotificationChannel({
                  id: 'versicle_tts_channel',
                  name: 'Versicle Playback',
                  description: 'Controls for background reading',
                  importance: 3
              });
          } catch (e) {
              console.error('Failed to create notification channel', e);
          }
      }
  }

  /**
   * Sets up the action handlers for the Media Session API.
   * Maps 'play', 'pause', 'seek', etc. to the provided callbacks.
   */
  private async setupActionHandlers() {
    if (this.isNative) {
        // NATIVE MODE (Capacitor Plugin)
        await this.setNativeActionHandler('play', this.callbacks.onPlay);
        await this.setNativeActionHandler('pause', this.callbacks.onPause);
        await this.setNativeActionHandler('stop', this.callbacks.onStop);
        await this.setNativeActionHandler('next', this.callbacks.onNext);
        await this.setNativeActionHandler('previous', this.callbacks.onPrev);
        await this.setNativeActionHandler('seekbackward', this.callbacks.onSeekBackward);
        await this.setNativeActionHandler('seekforward', this.callbacks.onSeekForward);
    } else if (this.hasWebMediaSession) {
        // WEB MODE (Browser API)
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await MediaSession.setActionHandler({ action: action as any }, handler);
      }
  }

  /**
   * Updates the media metadata (Title, Artist, Artwork).
   * Also updates the Android Foreground Service notification if running.
   *
   * @param metadata - The new metadata to display.
   */
  async setMetadata(metadata: MediaSessionMetadata) {
    this.currentMetadata = metadata;

    if (this.isNative) {
        await MediaSession.setMetadata({
            title: metadata.title,
            artist: metadata.artist,
            album: metadata.album,
            artwork: metadata.artwork
        });

        if (Capacitor.getPlatform() === 'android') {
             try {
                 // Update the persistent notification
                 await ForegroundService.updateForegroundService({
                     id: 1001,
                     title: metadata.title,
                     body: metadata.artist,
                     smallIcon: 'ic_stat_versicle'
                 });
             } catch (e) {
                 // Service might not be running yet if playback hasn't started, which is expected
                 console.debug("Failed to update foreground service metadata (service might be stopped)", e);
             }
        }
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
   * Updates the playback state (playing/paused) and optionally position state.
   * Manages the lifecycle of the Android Foreground Service (starting on play, stopping on pause).
   *
   * @param state - The current playback state object or string.
   */
  async setPlaybackState(state: PlaybackState | 'playing' | 'paused' | 'none') {
    const playbackState = typeof state === 'string' ? state : state.playbackState;
    const playbackSpeed = typeof state === 'string' ? 1.0 : state.playbackSpeed;
    const position = typeof state === 'string' ? undefined : state.position;
    const duration = typeof state === 'string' ? undefined : state.duration;

    if (playbackState === 'playing') {
        if (this.stopTimer) {
            clearTimeout(this.stopTimer);
            this.stopTimer = null;
        }

        if (this.isNative && Capacitor.getPlatform() === 'android') {
            try {
                // Start Foreground Service to prevent app kill
                await ForegroundService.startForegroundService({
                    id: 1001,
                    title: this.currentMetadata?.title || 'Versicle',
                    body: this.currentMetadata?.artist || 'Reading...',
                    smallIcon: 'ic_stat_versicle',
                    notificationChannelId: 'versicle_tts_channel',
                    buttons: [{ id: 101, title: 'Pause' }]
                });
            } catch (e) {
                console.error("Failed to start foreground service", e);
            }
        }
    } else if (playbackState === 'paused' || playbackState === 'none') {
         if (this.isNative && Capacitor.getPlatform() === 'android') {
             // Debounce stopping the service to handle quick pauses/resumes or buffering
             if (!this.stopTimer) {
                 this.stopTimer = setTimeout(async () => {
                     try {
                         await ForegroundService.stopForegroundService();
                     } catch (e) {
                         console.warn("Failed to stop foreground service", e);
                     }
                     this.stopTimer = null;
                 }, 5 * 60 * 1000); // 5 minutes debounce
             }
         }
    }

    if (this.isNative) {
        await MediaSession.setPlaybackState({
            playbackState,
        });
        if (playbackSpeed !== undefined || position !== undefined || duration !== undefined) {
             await MediaSession.setPositionState({
                 playbackRate: playbackSpeed || 1.0,
                 position: position,
                 duration: duration
             });
        }
    } else if (this.hasWebMediaSession) {
        navigator.mediaSession.playbackState = playbackState;
        if (position !== undefined && duration !== undefined && 'setPositionState' in navigator.mediaSession) {
             navigator.mediaSession.setPositionState({
                duration,
                playbackRate: playbackSpeed || 1.0,
                position
            });
        }
    }
  }

  /**
   * Updates the position state (duration, playback rate, current time).
   * Kept for granular updates separate from playback state.
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

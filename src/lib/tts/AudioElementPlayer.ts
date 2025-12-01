
/**
 * Wrapper around the HTML5 Audio element to handle playback of Blobs and URLs.
 * Provides a consistent interface for controlling playback, volume, and rate,
 * and abstracts away the URL.createObjectURL/revokeObjectURL lifecycle.
 */
export class AudioElementPlayer {
  private audio: HTMLAudioElement;
  private onTimeUpdateCallback: ((time: number) => void) | null = null;
  private onEndedCallback: (() => void) | null = null;
  private onErrorCallback: ((error: MediaError | null) => void) | null = null;
  private currentObjectUrl: string | null = null;

  /**
   * Initializes a new instance of AudioElementPlayer.
   * Creates the underlying Audio element and attaches event listeners.
   */
  constructor() {
    this.audio = new Audio();
    this.attachListeners();
  }

  /**
   * Attaches internal event listeners to the Audio element to propagate events.
   */
  private attachListeners() {
    this.audio.ontimeupdate = () => {
      if (this.onTimeUpdateCallback) {
        this.onTimeUpdateCallback(this.audio.currentTime);
      }
    };

    this.audio.onended = () => {
      this.revokeCurrentUrl();
      if (this.onEndedCallback) {
        this.onEndedCallback();
      }
    };

    this.audio.onerror = () => {
      if (this.onErrorCallback) {
        this.onErrorCallback(this.audio.error);
      }
    };
  }

  /**
   * Revokes the current Object URL to prevent memory leaks.
   */
  private revokeCurrentUrl() {
      if (this.currentObjectUrl) {
          URL.revokeObjectURL(this.currentObjectUrl);
          this.currentObjectUrl = null;
      }
  }

  /**
   * Plays audio from a Blob object.
   *
   * @param blob - The audio Blob to play.
   * @returns A Promise that resolves when playback begins.
   */
  public playBlob(blob: Blob): Promise<void> {
    this.revokeCurrentUrl();
    const url = URL.createObjectURL(blob);
    this.currentObjectUrl = url;
    this.audio.src = url;
    return this.audio.play();
  }

  /**
   * Plays audio from a URL string.
   *
   * @param url - The URL of the audio to play.
   * @returns A Promise that resolves when playback begins.
   */
  public playUrl(url: string): Promise<void> {
    this.revokeCurrentUrl();
    this.audio.src = url;
    return this.audio.play();
  }

  /**
   * Pauses playback.
   */
  public pause() {
    this.audio.pause();
  }

  /**
   * Resumes playback.
   *
   * @returns A Promise that resolves when playback resumes.
   */
  public resume(): Promise<void> {
    return this.audio.play();
  }

  /**
   * Stops playback, resets the position to the beginning, and cleans up resources.
   */
  public stop() {
    this.audio.pause();
    this.audio.currentTime = 0;
    this.revokeCurrentUrl();
  }

  /**
   * Sets the playback volume.
   *
   * @param volume - The volume level (0.0 to 1.0).
   */
  public setVolume(volume: number) {
    this.audio.volume = Math.max(0, Math.min(1, volume));
  }

  /**
   * Sets the playback rate.
   *
   * @param rate - The playback speed (e.g., 1.0 for normal speed).
   */
  public setRate(rate: number) {
    this.audio.playbackRate = rate;
  }

  /**
   * Seeks to a specific time in the audio.
   *
   * @param time - The time in seconds to seek to.
   */
  public seek(time: number) {
    if (isFinite(time)) {
       this.audio.currentTime = Math.max(0, Math.min(time, this.audio.duration || 0));
    }
  }

  /**
   * Gets the current playback time.
   *
   * @returns The current time in seconds.
   */
  public getCurrentTime(): number {
    return this.audio.currentTime;
  }

  /**
   * Gets the duration of the audio.
   *
   * @returns The duration in seconds.
   */
  public getDuration(): number {
    return this.audio.duration;
  }

  /**
   * Sets the callback for time update events.
   *
   * @param callback - The function to call when playback time updates.
   */
  public setOnTimeUpdate(callback: (time: number) => void) {
    this.onTimeUpdateCallback = callback;
  }

  /**
   * Sets the callback for playback ended events.
   *
   * @param callback - The function to call when playback ends.
   */
  public setOnEnded(callback: () => void) {
    this.onEndedCallback = callback;
  }

  /**
   * Sets the callback for error events.
   *
   * @param callback - The function to call when an error occurs.
   */
  public setOnError(callback: (error: MediaError | null) => void) {
    this.onErrorCallback = callback;
  }

  /**
   * Destroys the player instance and clears all listeners.
   */
  public destroy() {
      this.stop();
      this.audio.ontimeupdate = null;
      this.audio.onended = null;
      this.audio.onerror = null;
  }
}

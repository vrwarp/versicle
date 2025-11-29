
export class AudioElementPlayer {
  private audio: HTMLAudioElement;
  private onTimeUpdateCallback: ((time: number) => void) | null = null;
  private onEndedCallback: (() => void) | null = null;
  private onErrorCallback: ((error: MediaError | null) => void) | null = null;
  private currentObjectUrl: string | null = null;

  constructor() {
    this.audio = new Audio();
    this.attachListeners();
  }

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

  private revokeCurrentUrl() {
      if (this.currentObjectUrl) {
          URL.revokeObjectURL(this.currentObjectUrl);
          this.currentObjectUrl = null;
      }
  }

  public playBlob(blob: Blob): Promise<void> {
    this.revokeCurrentUrl();
    const url = URL.createObjectURL(blob);
    this.currentObjectUrl = url;
    this.audio.src = url;
    return this.audio.play();
  }

  public playUrl(url: string): Promise<void> {
    this.revokeCurrentUrl();
    this.audio.src = url;
    return this.audio.play();
  }

  public pause() {
    this.audio.pause();
  }

  public resume(): Promise<void> {
    return this.audio.play();
  }

  public stop() {
    this.audio.pause();
    this.audio.currentTime = 0;
    this.revokeCurrentUrl();
  }

  public setVolume(volume: number) {
    this.audio.volume = Math.max(0, Math.min(1, volume));
  }

  public setRate(rate: number) {
    this.audio.playbackRate = rate;
  }

  public seek(time: number) {
    if (isFinite(time)) {
       this.audio.currentTime = Math.max(0, Math.min(time, this.audio.duration || 0));
    }
  }

  public getCurrentTime(): number {
    return this.audio.currentTime;
  }

  public getDuration(): number {
    return this.audio.duration;
  }

  public setOnTimeUpdate(callback: (time: number) => void) {
    this.onTimeUpdateCallback = callback;
  }

  public setOnEnded(callback: () => void) {
    this.onEndedCallback = callback;
  }

  public setOnError(callback: (error: MediaError | null) => void) {
    this.onErrorCallback = callback;
  }

  public destroy() {
      this.stop();
      this.audio.ontimeupdate = null;
      this.audio.onended = null;
      this.audio.onerror = null;
  }
}

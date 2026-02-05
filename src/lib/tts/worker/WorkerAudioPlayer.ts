import type { IAudioPlayer } from '../IAudioPlayer';
import type { IMainThreadAudioCallback } from './interfaces';

export class WorkerAudioPlayer implements IAudioPlayer {
    private onTimeUpdateCallback: ((time: number) => void) | null = null;
    private onEndedCallback: (() => void) | null = null;
    private onErrorCallback: ((error: string) => void) | null = null;
    private duration: number = 0;
    private callback: IMainThreadAudioCallback;

    constructor(callback: IMainThreadAudioCallback) {
        this.callback = callback;
    }

    // Methods called by Service when events arrive
    handleAudioTimeUpdate(time: number, duration: number) {
        this.duration = duration;
        if (this.onTimeUpdateCallback) this.onTimeUpdateCallback(time);
    }

    handleAudioEnded() {
        if (this.onEndedCallback) this.onEndedCallback();
    }

    handleAudioError(error: string) {
        if (this.onErrorCallback) this.onErrorCallback(error);
    }

    async playBlob(blob: Blob): Promise<void> {
        // We assume playbackRate 1.0 initially, it can be updated
        await this.callback.playBlob(blob, 1.0);
    }

    pause(): void {
        this.callback.pausePlayback();
    }

    resume(): void {
        this.callback.resumePlayback();
    }

    stop(): void {
        this.callback.stopPlayback();
    }

    setRate(rate: number): void {
        this.callback.setPlaybackRate(rate);
    }

    getDuration(): number {
        return this.duration;
    }

    setOnTimeUpdate(callback: (time: number) => void): void {
        this.onTimeUpdateCallback = callback;
    }

    setOnEnded(callback: () => void): void {
        this.onEndedCallback = callback;
    }

    setOnError(callback: (error: string) => void): void {
        this.onErrorCallback = callback;
    }
}

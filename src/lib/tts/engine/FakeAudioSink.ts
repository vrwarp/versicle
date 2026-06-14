/**
 * FakeAudioSink — a deterministic in-memory {@link AudioSink} for unit tests.
 *
 * Records every command and exposes `fire*` helpers so a test can drive the playback
 * lifecycle (timeupdate / ended / error) without an `HTMLAudioElement`, `AudioContext`,
 * or any jsdom media shims.
 */
import type { AudioSink } from './AudioSink';

export class FakeAudioSink implements AudioSink {
    // --- Recorded commands ---
    readonly playedBlobs: Blob[] = [];
    readonly playedUrls: string[] = [];
    readonly earcons: Array<'bookmark_captured' | 'bookmark_failed'> = [];
    pauseCount = 0;
    resumeCount = 0;
    stopCount = 0;
    destroyed = false;
    volume = 1;
    rate = 1;
    currentTime = 0;
    duration = 0;

    private onTimeUpdate: ((time: number) => void) | null = null;
    private onEnded: (() => void) | null = null;
    private onError: ((error: MediaError | null) => void) | null = null;

    async playBlob(blob: Blob): Promise<void> {
        this.playedBlobs.push(blob);
    }
    async playUrl(url: string): Promise<void> {
        this.playedUrls.push(url);
    }
    pause(): void {
        this.pauseCount++;
    }
    async resume(): Promise<void> {
        this.resumeCount++;
    }
    stop(): void {
        this.stopCount++;
        this.currentTime = 0;
    }
    setVolume(volume: number): void {
        this.volume = volume;
    }
    setRate(rate: number): void {
        this.rate = rate;
    }
    seek(time: number): void {
        this.currentTime = time;
    }
    getCurrentTime(): number {
        return this.currentTime;
    }
    getDuration(): number {
        return this.duration;
    }
    setOnTimeUpdate(callback: (time: number) => void): void {
        this.onTimeUpdate = callback;
    }
    setOnEnded(callback: () => void): void {
        this.onEnded = callback;
    }
    setOnError(callback: (error: MediaError | null) => void): void {
        this.onError = callback;
    }
    playEarcon(type: 'bookmark_captured' | 'bookmark_failed'): void {
        this.earcons.push(type);
    }
    destroy(): void {
        this.destroyed = true;
    }

    // --- Test-side lifecycle triggers ---
    fireTimeUpdate(time: number) {
        this.currentTime = time;
        this.onTimeUpdate?.(time);
    }
    fireEnded() {
        this.onEnded?.();
    }
    fireError(error: MediaError | null = null) {
        this.onError?.(error);
    }
}

import type { IAudioPlayer } from '../IAudioPlayer';
import type { MainToWorkerMessage, WorkerToMainMessage } from './messages';

export class WorkerAudioPlayer implements IAudioPlayer {
    private onTimeUpdateCallback: ((time: number) => void) | null = null;
    private onEndedCallback: (() => void) | null = null;
    private onErrorCallback: ((error: string) => void) | null = null;
    private duration: number = 0;

    constructor() {
        self.addEventListener('message', this.handleMessage.bind(this));
    }

    private handleMessage(event: MessageEvent) {
        const msg = event.data as MainToWorkerMessage;
        switch (msg.type) {
            case 'AUDIO_TIME_UPDATE':
                this.duration = msg.duration;
                if (this.onTimeUpdateCallback) this.onTimeUpdateCallback(msg.time);
                break;
            case 'AUDIO_ENDED':
                if (this.onEndedCallback) this.onEndedCallback();
                break;
            case 'AUDIO_ERROR':
                if (this.onErrorCallback) this.onErrorCallback(msg.error);
                break;
        }
    }

    playBlob(blob: Blob): Promise<void> {
        // We can't really "wait" for playback to start in the same way as DOM Audio
        // unless we add a handshake. For now, assume fire-and-forget success.
        // BaseCloudProvider awaits this.
        this.postMessage({ type: 'PLAY_BLOB', blob, playbackRate: 1.0 }); // Rate will be set separately or default
        return Promise.resolve();
    }

    pause(): void {
        this.postMessage({ type: 'PAUSE_PLAYBACK' });
    }

    resume(): void {
        this.postMessage({ type: 'RESUME_PLAYBACK' });
    }

    stop(): void {
        this.postMessage({ type: 'STOP_PLAYBACK' });
    }

    setRate(rate: number): void {
        this.postMessage({ type: 'SET_PLAYBACK_RATE', speed: rate });
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

    private postMessage(msg: WorkerToMainMessage) {
        self.postMessage(msg);
    }
}

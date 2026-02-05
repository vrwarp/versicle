import type { ITTSProvider, TTSVoice, TTSOptions, TTSEvent } from '../providers/types';
import type { IMainThreadAudioCallback } from './interfaces';

export class RemoteWebSpeechProvider implements ITTSProvider {
    id = 'local';
    private listeners: ((event: TTSEvent) => void)[] = [];
    private callback: IMainThreadAudioCallback;

    constructor(callback: IMainThreadAudioCallback) {
        this.callback = callback;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleRemoteEvent(event: any) {
         if (event.type === 'start') this.emit({ type: 'start' });
         if (event.type === 'end') this.emit({ type: 'end' });
         if (event.type === 'error') this.emit({ type: 'error', error: event.error });
         if (event.type === 'timeupdate') this.emit({ type: 'timeupdate', currentTime: event.time, duration: event.duration });
    }

    async init(): Promise<void> {
        // No-op
    }

    async getVoices(): Promise<TTSVoice[]> {
        return await this.callback.getLocalVoices();
    }

    async play(text: string, options: TTSOptions): Promise<void> {
        await this.callback.playLocal(text, { voiceId: options.voiceId, speed: options.speed }, 'local');
    }

    async preload(text: string, options: TTSOptions): Promise<void> {
        await this.callback.preloadLocal(text, { voiceId: options.voiceId, speed: options.speed }, 'local');
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

    on(callback: (event: TTSEvent) => void): void {
        this.listeners.push(callback);
    }

    private emit(event: TTSEvent) {
        this.listeners.forEach(l => l(event));
    }
}

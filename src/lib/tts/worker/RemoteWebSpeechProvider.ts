import type { ITTSProvider, TTSVoice, TTSOptions, TTSEvent } from '../providers/types';
import type { MainToWorkerMessage } from './messages';

export class RemoteWebSpeechProvider implements ITTSProvider {
    id = 'local';
    private listeners: ((event: TTSEvent) => void)[] = [];
    private pendingRequests = new Map<string, (voices: TTSVoice[]) => void>();

    constructor() {
        self.addEventListener('message', this.handleMessage.bind(this));
    }

    private handleMessage(event: MessageEvent) {
        const msg = event.data as MainToWorkerMessage;
        if (msg.type === 'LOCAL_VOICES_LIST' && this.pendingRequests.has(msg.reqId)) {
            const resolve = this.pendingRequests.get(msg.reqId);
            this.pendingRequests.delete(msg.reqId);
            if (resolve) resolve(msg.voices);
        }

        if (msg.type === 'REMOTE_PLAY_START' && msg.provider === 'local') {
            this.emit({ type: 'start' });
        }
        if (msg.type === 'REMOTE_PLAY_ENDED' && msg.provider === 'local') {
            this.emit({ type: 'end' });
        }
        if (msg.type === 'REMOTE_PLAY_ERROR' && msg.provider === 'local') {
            this.emit({ type: 'error', error: msg.error });
        }
        if (msg.type === 'REMOTE_TIME_UPDATE' && msg.provider === 'local') {
            this.emit({ type: 'timeupdate', currentTime: msg.time, duration: msg.duration });
        }
    }

    async init(): Promise<void> {
        // No-op
    }

    async getVoices(): Promise<TTSVoice[]> {
        return new Promise((resolve) => {
            const reqId = Math.random().toString(36).substring(7);
            this.pendingRequests.set(reqId, resolve);
            (self as any).postMessage({ type: 'GET_LOCAL_VOICES', reqId });
        });
    }

    async play(text: string, options: TTSOptions): Promise<void> {
        (self as any).postMessage({
            type: 'PLAY_LOCAL',
            text,
            options: { voiceId: options.voiceId, speed: options.speed }
        });
    }

    preload(text: string, options: TTSOptions): void {
        (self as any).postMessage({
            type: 'PRELOAD_LOCAL',
            text,
            options: { voiceId: options.voiceId, speed: options.speed }
        });
    }

    pause(): void {
        (self as any).postMessage({ type: 'PAUSE_PLAYBACK' });
    }

    resume(): void {
        (self as any).postMessage({ type: 'RESUME_PLAYBACK' });
    }

    stop(): void {
        (self as any).postMessage({ type: 'STOP_PLAYBACK' });
    }

    on(callback: (event: TTSEvent) => void): void {
        this.listeners.push(callback);
    }

    private emit(event: TTSEvent) {
        this.listeners.forEach(l => l(event));
    }
}

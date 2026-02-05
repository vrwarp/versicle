import type { ITTSProvider, TTSVoice, TTSOptions, TTSEvent } from '../providers/types';
import type { MainToWorkerMessage } from './messages';

export class RemoteCapacitorProvider implements ITTSProvider {
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

        if (msg.provider === 'native') {
            switch (msg.type) {
                case 'REMOTE_PLAY_START':
                    this.emit({ type: 'start' });
                    break;
                case 'REMOTE_PLAY_ENDED':
                    this.emit({ type: 'end' });
                    break;
                case 'REMOTE_PLAY_ERROR':
                    this.emit({ type: 'error', error: msg.error });
                    break;
                case 'REMOTE_TIME_UPDATE':
                    this.emit({ type: 'timeupdate', currentTime: msg.time, duration: msg.duration });
                    break;
                case 'REMOTE_BOUNDARY':
                    this.emit({ type: 'boundary', charIndex: msg.charIndex });
                    break;
            }
        }
    }

    async init(): Promise<void> {
        // Main Thread initializes plugin
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
            type: 'PLAY_NATIVE',
            text,
            options: { voiceId: options.voiceId, speed: options.speed }
        });
    }

    preload(text: string, options: TTSOptions): void {
        (self as any).postMessage({
            type: 'PRELOAD_NATIVE',
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

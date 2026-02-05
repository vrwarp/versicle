import type { ITTSProvider, TTSVoice } from '../providers/types';
import type { TTSOptions } from '../providers/types';

export interface TTSProviderCallbacks {
    onStart: () => void;
    onEnd: () => void;
    onError: (error: Error) => void;
    onTimeUpdate: (currentTime: number) => void;
    onBoundary: (event: any) => void;
    onMeta: (metadata: any) => void;
    onDownloadProgress: (voiceId: string, percent: number, status: 'downloading' | 'completed' | 'error') => void;
}

export class WorkerTTSProviderManager {
    private provider: ITTSProvider | null = null;
    private callbacks: TTSProviderCallbacks;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(callbacks: TTSProviderCallbacks, _isNative: boolean) {
        this.callbacks = callbacks;
    }

    setProvider(provider: ITTSProvider) {
        if (this.provider) {
            this.provider.stop();
        }
        this.provider = provider;
        this.attachListeners();
    }

    private attachListeners() {
        if (!this.provider) return;

        this.provider.on((event) => {
            switch (event.type) {
                case 'start':
                    this.callbacks.onStart();
                    break;
                case 'end':
                    this.callbacks.onEnd();
                    break;
                case 'error':
                    this.callbacks.onError(event.error);
                    break;
                case 'timeupdate':
                    this.callbacks.onTimeUpdate(event.currentTime);
                    break;
                case 'boundary':
                    this.callbacks.onBoundary(event.charIndex);
                    break;
                case 'meta':
                    this.callbacks.onMeta(event.alignment);
                    break;
                case 'download-progress':
                    this.callbacks.onDownloadProgress(event.voiceId, event.percent, event.status as any);
                    break;
            }
        });
    }

    async init() {
        if (this.provider) {
            await this.provider.init();
        }
    }

    async play(text: string, options: TTSOptions) {
        if (!this.provider) throw new Error("No TTS provider set");
        await this.provider.play(text, options);
    }

    async pause() {
        if (this.provider) await this.provider.pause();
    }

    async stop() {
        if (this.provider) await this.provider.stop();
    }

    async preload(text: string, options: TTSOptions) {
        if (this.provider) await this.provider.preload(text, options);
    }

    async getVoices(): Promise<TTSVoice[]> {
        if (!this.provider) return [];
        return await this.provider.getVoices();
    }

    async downloadVoice(voiceId: string) {
         if (this.provider && 'downloadVoice' in this.provider) {
             // eslint-disable-next-line @typescript-eslint/no-explicit-any
             await (this.provider as any).downloadVoice(voiceId);
         }
    }

    async deleteVoice(voiceId: string) {
        if (this.provider && 'deleteVoice' in this.provider) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (this.provider as any).deleteVoice(voiceId);
        }
    }

    async isVoiceDownloaded(voiceId: string): Promise<boolean> {
        if (this.provider && 'isVoiceDownloaded' in this.provider) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return await (this.provider as any).isVoiceDownloaded(voiceId);
        }
        return true; // Default to true for cloud providers
    }
}

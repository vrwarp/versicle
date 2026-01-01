import type { ITTSProvider, TTSVoice } from './providers/types';
import { WebSpeechProvider } from './providers/WebSpeechProvider';
import { CapacitorTTSProvider } from './providers/CapacitorTTSProvider';
import { Capacitor } from '@capacitor/core';
import type { AlignmentData } from './SyncEngine';

export interface TTSProviderEvents {
    onStart: () => void;
    onEnd: () => void;
    onError: (error: { message: string, type?: string }) => void;
    onTimeUpdate: (time: number) => void;
    onMeta: (alignment: AlignmentData[]) => void;
    onDownloadProgress: (voiceId: string, percent: number, status: string) => void;
}

export class TTSProviderManager {
    private provider: ITTSProvider;

    constructor(private events: TTSProviderEvents) {
        if (Capacitor.isNativePlatform()) {
            this.provider = new CapacitorTTSProvider();
        } else {
            this.provider = new WebSpeechProvider();
        }
        this.setupListeners();
    }

    private setupListeners() {
        this.provider.on((event) => {
            switch (event.type) {
                case 'start':
                    this.events.onStart();
                    break;
                case 'end':
                    this.events.onEnd();
                    break;
                case 'error':
                     // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const errorObj = event.error as any;
                    const errorType = errorObj?.error || event.error;
                    if (errorType === 'interrupted' || errorType === 'canceled') return;
                    this.events.onError({
                        message: event.error?.message || "Unknown error",
                        type: typeof errorType === 'string' ? errorType : undefined
                    });
                    break;
                case 'timeupdate':
                    this.events.onTimeUpdate(event.currentTime);
                    break;
                case 'meta':
                    if (event.alignment) {
                         const alignmentData: AlignmentData[] = event.alignment.map(tp => ({
                            time: tp.timeSeconds,
                            textOffset: tp.charIndex,
                            type: (tp.type as 'word' | 'sentence') || 'word'
                        }));
                        this.events.onMeta(alignmentData);
                    }
                    break;
                case 'download-progress':
                    this.events.onDownloadProgress(event.voiceId, event.percent, event.status);
                    break;
            }
        });
    }

    async init() {
        await this.provider.init();
    }

    async play(text: string, options: { voiceId: string, speed: number }) {
        try {
            await this.provider.play(text, options);
        } catch (e) {
             // Fallback logic
             if (this.provider.id !== 'local') {
                 console.warn("Cloud/Piper provider failed, falling back to local...");
                 // Emit error to let AudioPlayerService know about the fallback reason
                 this.events.onError({
                     message: "Cloud voice failed (" + (e instanceof Error ? e.message : "Unknown") + "). Switching to local backup.",
                     type: 'fallback'
                 });

                 await this.switchToLocal();
                 await this.provider.play(text, options);
             } else {
                 throw e;
             }
        }
    }

    preload(text: string, options: { voiceId: string, speed: number }) {
        this.provider.preload(text, options);
    }

    pause() {
        this.provider.pause();
    }

    stop() {
        this.provider.stop();
    }

    async switchToLocal() {
        this.stop();
        if (Capacitor.isNativePlatform()) {
             this.provider = new CapacitorTTSProvider();
        } else {
             this.provider = new WebSpeechProvider();
        }
        this.setupListeners();
        await this.init();
    }

    setProvider(provider: ITTSProvider) {
        this.stop();
        this.provider = provider;
        this.setupListeners();
    }

    getVoices(): Promise<TTSVoice[]> {
        return this.provider.getVoices();
    }

    getId(): string {
        return this.provider.id;
    }

    // Piper specific methods, safely proxied
    async downloadVoice(voiceId: string): Promise<void> {
        if (this.provider.id === 'piper') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const piper = this.provider as any;
            if (typeof piper.downloadVoice === 'function') {
                await piper.downloadVoice(voiceId);
            }
        }
    }

    async deleteVoice(voiceId: string): Promise<void> {
        if (this.provider.id === 'piper') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const piper = this.provider as any;
            if (typeof piper.deleteVoice === 'function') {
                await piper.deleteVoice(voiceId);
            }
        }
    }

    async isVoiceDownloaded(voiceId: string): Promise<boolean> {
         if (this.provider.id === 'piper') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const piper = this.provider as any;
             if (typeof piper.isVoiceDownloaded === 'function') {
                return await piper.isVoiceDownloaded(voiceId);
            }
         }
         return true;
    }
}

import type { ITTSProvider, TTSVoice } from './providers/types';
import { WebSpeechProvider } from './providers/WebSpeechProvider';
import { CapacitorTTSProvider } from './providers/CapacitorTTSProvider';
import { Capacitor } from '@capacitor/core';
import type { AlignmentData } from './SyncEngine';

export interface TTSProviderEvents {
    onStart: () => void;
    onEnd: () => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (error: any) => void;
    onTimeUpdate: (currentTime: number) => void;
    onBoundary: (charIndex: number) => void;
    onMeta: (alignment: AlignmentData[]) => void;
    onDownloadProgress: (voiceId: string, percent: number, status: string) => void;
}

export class TTSProviderManager {
    private provider: ITTSProvider;
    private events: TTSProviderEvents;

    constructor(events: TTSProviderEvents) {
        this.events = events;
        if (Capacitor.isNativePlatform()) {
            this.provider = new CapacitorTTSProvider();
        } else {
            this.provider = new WebSpeechProvider();
        }
        this.setupProviderListeners();
    }

    private setupProviderListeners() {
        this.provider.on((event) => {
            if (event.type === 'start') {
                this.events.onStart();
            } else if (event.type === 'end') {
                this.events.onEnd();
            } else if (event.type === 'error') {
                // Handle common interruption errors or real errors
                const errorObj = event.error as unknown as { error?: string, message?: string };
                const errorType = errorObj?.error || event.error;
                // If it's just an interruption (e.g. from cancel), ignore
                if (errorType === 'interrupted' || errorType === 'canceled') return;

                console.error("TTS Provider Error", event.error);

                // Fallback Logic
                if (this.provider.id !== 'local') {
                    this.events.onError({ type: 'fallback', message: event.error instanceof Error ? event.error.message : event.error });
                    this.switchToLocalProvider();
                } else {
                    this.events.onError(event.error);
                }

            } else if (event.type === 'timeupdate') {
                this.events.onTimeUpdate(event.currentTime);
            } else if (event.type === 'boundary') {
                this.events.onBoundary(event.charIndex);
            } else if (event.type === 'meta') {
                if (event.alignment) {
                     const alignmentData: AlignmentData[] = event.alignment.map(tp => ({
                         time: tp.timeSeconds,
                         textOffset: tp.charIndex,
                         type: (tp.type as 'word' | 'sentence') || 'word'
                     }));
                     this.events.onMeta(alignmentData);
                }
            } else if (event.type === 'download-progress') {
                this.events.onDownloadProgress(event.voiceId, event.percent, event.status);
            }
        });
    }

    private async switchToLocalProvider() {
         console.warn("Falling back to local provider...");
         this.provider.stop(); // Ensure old provider is stopped

         if (Capacitor.isNativePlatform()) {
             this.provider = new CapacitorTTSProvider();
         } else {
             this.provider = new WebSpeechProvider();
         }
         this.setupProviderListeners();
         await this.provider.init();
    }

    async init() {
        await this.provider.init();
    }

    async play(text: string, options: { voiceId: string, speed: number }) {
        try {
            return await this.provider.play(text, options);
        } catch (e) {
            // Catch play errors and treat them as provider errors to trigger fallback if applicable
             const errorObj = e as unknown as { error?: string, message?: string };
             const errorType = errorObj?.error || e;

             // Check if it's not just a cancellation
             if (errorType !== 'interrupted' && errorType !== 'canceled') {
                 console.error("TTS Provider Play Error", e);
                 if (this.provider.id !== 'local') {
                    this.events.onError({ type: 'fallback', message: e instanceof Error ? e.message : e });
                    await this.switchToLocalProvider();
                 } else {
                    // Re-throw if it's local provider or we can't handle it
                    throw e;
                 }
             } else {
                 throw e;
             }
        }
    }

    pause() {
        this.provider.pause();
    }

    stop() {
        this.provider.stop();
    }

    async getVoices(): Promise<TTSVoice[]> {
        return this.provider.getVoices();
    }

    preload(text: string, options: { voiceId: string, speed: number }) {
        this.provider.preload(text, options);
    }

    setProvider(provider: ITTSProvider) {
         this.provider.stop();
         this.provider = provider;
         this.setupProviderListeners();
    }

    get providerId() {
        return this.provider.id;
    }

    // Proxy other methods if needed (downloadVoice, etc)
    // Casting to any for provider specific methods as per original code
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

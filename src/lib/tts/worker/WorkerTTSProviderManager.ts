import type { ITTSProvider, TTSVoice, TTSProviderEvents } from '../providers/types';
import { RemoteWebSpeechProvider } from './RemoteWebSpeechProvider';
import { RemoteCapacitorProvider } from './RemoteCapacitorProvider';
import type { AlignmentData } from '../SyncEngine';

export class WorkerTTSProviderManager {
    private provider: ITTSProvider;
    private events: TTSProviderEvents;
    private isNative: boolean;

    constructor(events: TTSProviderEvents, isNative: boolean) {
        this.events = events;
        this.isNative = isNative;
        if (isNative) {
            this.provider = new RemoteCapacitorProvider();
        } else {
            this.provider = new RemoteWebSpeechProvider();
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
                const errorObj = event.error as any;
                const errorType = errorObj?.error || event.error;
                if (errorType === 'interrupted' || errorType === 'canceled') return;

                console.error("TTS Provider Error", event.error);

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
         this.provider.stop();

         if (this.isNative) {
             this.provider = new RemoteCapacitorProvider();
         } else {
             this.provider = new RemoteWebSpeechProvider();
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
             const errorObj = e as any;
             const errorType = errorObj?.error || e;

             if (errorType !== 'interrupted' && errorType !== 'canceled') {
                 console.error("TTS Provider Play Error", e);
                 if (this.provider.id !== 'local') {
                    this.events.onError({ type: 'fallback', message: e instanceof Error ? e.message : e });
                    await this.switchToLocalProvider();
                    // Retry play with local? Not implemented in original, so just switching.
                 } else {
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
        if (this.provider.preload) {
            this.provider.preload(text, options);
        }
    }

    setProvider(provider: ITTSProvider) {
         this.provider.stop();
         this.provider = provider;
         this.setupProviderListeners();
    }

    get providerId() {
        return this.provider.id;
    }

    async downloadVoice(voiceId: string): Promise<void> {
        if (this.provider.id === 'piper') {
            const piper = this.provider as any;
            if (typeof piper.downloadVoice === 'function') {
                await piper.downloadVoice(voiceId);
            }
        }
    }

    async deleteVoice(voiceId: string): Promise<void> {
        if (this.provider.id === 'piper') {
            const piper = this.provider as any;
            if (typeof piper.deleteVoice === 'function') {
                await piper.deleteVoice(voiceId);
            }
        }
    }

    async isVoiceDownloaded(voiceId: string): Promise<boolean> {
         if (this.provider.id === 'piper') {
            const piper = this.provider as any;
             if (typeof piper.isVoiceDownloaded === 'function') {
                return await piper.isVoiceDownloaded(voiceId);
            }
         }
         return true;
    }
}

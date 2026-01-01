import type { ITTSProvider, TTSVoice, TTSEvent } from './providers/types';
import { WebSpeechProvider } from './providers/WebSpeechProvider';
import { CapacitorTTSProvider } from './providers/CapacitorTTSProvider';
import { Capacitor } from '@capacitor/core';

export type TTSProviderEvent = TTSEvent;
export type ProviderEventType = TTSProviderEvent['type'];

export class TTSProviderManager {
    private provider: ITTSProvider;
    private listeners: ((event: TTSProviderEvent) => void)[] = [];

    constructor(initialProvider?: ITTSProvider) {
        if (initialProvider) {
            this.provider = initialProvider;
        } else if (Capacitor.isNativePlatform()) {
            this.provider = new CapacitorTTSProvider();
        } else {
            this.provider = new WebSpeechProvider();
        }
        this.setupListener();
    }

    private setupListener() {
        this.provider.on((event) => {
            this.notifyListeners(event);
        });
    }

    async init() {
        await this.provider.init();
    }

    async setProvider(provider: ITTSProvider) {
        // Stop current provider before switching
        this.provider.stop();
        this.provider = provider;
        this.setupListener();
        await this.provider.init();
    }

    getProviderId(): string {
        return this.provider.id;
    }

    async getVoices(): Promise<TTSVoice[]> {
        return this.provider.getVoices();
    }

    async play(text: string, options: { voiceId: string; speed: number }) {
        try {
            await this.provider.play(text, options);
        } catch (e) {
            // Fallback logic
            if (this.provider.id !== 'local') {
                console.warn("Cloud/Custom TTS error, falling back to local...", e);
                const errorMessage = e instanceof Error ? e.message : "Provider Error";
                this.notifyListeners({ type: 'error', error: `Cloud voice failed (${errorMessage}). Switching to local backup.` });

                if (Capacitor.isNativePlatform()) {
                    await this.setProvider(new CapacitorTTSProvider());
                } else {
                    await this.setProvider(new WebSpeechProvider());
                }

                // Retry play
                await this.provider.play(text, options);
            } else {
                throw e;
            }
        }
    }

    preload(text: string, options: { voiceId: string; speed: number }) {
        this.provider.preload(text, options);
    }

    pause() {
        this.provider.pause();
    }

    resume() {
        this.provider.resume();
    }

    stop() {
        this.provider.stop();
    }

    on(callback: (event: TTSProviderEvent) => void) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }

    private notifyListeners(event: TTSProviderEvent) {
        this.listeners.forEach(l => l(event));
    }

    // Piper specific methods, proxied safely
    async downloadVoice(voiceId: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const provider = this.provider as any;
        if (typeof provider.downloadVoice === 'function') {
            await provider.downloadVoice(voiceId);
        }
    }

    async deleteVoice(voiceId: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const provider = this.provider as any;
        if (typeof provider.deleteVoice === 'function') {
            await provider.deleteVoice(voiceId);
        }
    }

    async isVoiceDownloaded(voiceId: string): Promise<boolean> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const provider = this.provider as any;
        if (typeof provider.isVoiceDownloaded === 'function') {
            return await provider.isVoiceDownloaded(voiceId);
        }
        return true;
    }
}

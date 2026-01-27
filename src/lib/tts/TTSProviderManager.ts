import type { ITTSProvider, TTSVoice } from './providers/types';
import { WebSpeechProvider } from './providers/WebSpeechProvider';
import { CapacitorTTSProvider } from './providers/CapacitorTTSProvider';
import { Capacitor } from '@capacitor/core';
import type { AlignmentData } from './SyncEngine';
import { createLogger } from '../logger';

const logger = createLogger('TTSProviderManager');

/**
 * Interface defining the events emitted by the TTSProviderManager.
 */
export interface TTSProviderEvents {
    /** Triggered when playback starts. */
    onStart: () => void;
    /** Triggered when playback completes successfully. */
    onEnd: () => void;
    /**
     * Triggered when an error occurs during playback.
     * @param error The error object or message.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (error: any) => void;
    /**
     * Triggered periodically during playback with the current timestamp.
     * @param currentTime The current playback position in seconds.
     */
    onTimeUpdate: (currentTime: number) => void;
    /**
     * Triggered when a word or sentence boundary is reached.
     * @param charIndex The character index of the boundary.
     */
    onBoundary: (charIndex: number) => void;
    /**
     * Triggered when alignment metadata is available.
     * @param alignment The alignment data.
     */
    onMeta: (alignment: AlignmentData[]) => void;
    /**
     * Triggered during voice download progress.
     * @param voiceId The ID of the voice being downloaded.
     * @param percent The progress percentage (0-100).
     * @param status A status message.
     */
    onDownloadProgress: (voiceId: string, percent: number, status: string) => void;
}

/**
 * Manages the lifecycle and selection of Text-to-Speech providers.
 * Handles initialization, platform detection (Native vs Web), error recovery (Cloud -> Local fallback),
 * and event normalization across different providers.
 */
export class TTSProviderManager {
    private provider: ITTSProvider;
    private events: TTSProviderEvents;

    /**
     * Creates a new TTSProviderManager.
     * Automatically selects the appropriate provider based on the platform.
     *
     * @param {TTSProviderEvents} events Callback handlers for provider events.
     */
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

                logger.error("TTS Provider Error", event.error);

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
         logger.warn("Falling back to local provider...");
         this.provider.stop(); // Ensure old provider is stopped

         if (Capacitor.isNativePlatform()) {
             this.provider = new CapacitorTTSProvider();
         } else {
             this.provider = new WebSpeechProvider();
         }
         this.setupProviderListeners();
         await this.provider.init();
    }

    /**
     * Initializes the underlying TTS provider.
     */
    async init() {
        await this.provider.init();
    }

    /**
     * Starts playback of the given text.
     *
     * @param {string} text The text to speak.
     * @param {object} options Playback options.
     * @param {string} options.voiceId The ID of the voice to use.
     * @param {number} options.speed The playback speed factor.
     */
    async play(text: string, options: { voiceId: string, speed: number }) {
        try {
            return await this.provider.play(text, options);
        } catch (e) {
            // Catch play errors and treat them as provider errors to trigger fallback if applicable
             const errorObj = e as unknown as { error?: string, message?: string };
             const errorType = errorObj?.error || e;

             // Check if it's not just a cancellation
             if (errorType !== 'interrupted' && errorType !== 'canceled') {
                 logger.error("TTS Provider Play Error", e);
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

    /**
     * Pauses the current playback.
     */
    pause() {
        this.provider.pause();
    }

    /**
     * Stops the current playback.
     */
    stop() {
        this.provider.stop();
    }

    /**
     * Retrieves the list of available voices.
     * @returns {Promise<TTSVoice[]>} A promise resolving to an array of voices.
     */
    async getVoices(): Promise<TTSVoice[]> {
        return this.provider.getVoices();
    }

    /**
     * Preloads audio for the given text to reduce latency.
     *
     * @param {string} text The text to preload.
     * @param {object} options Playback options.
     */
    preload(text: string, options: { voiceId: string, speed: number }) {
        this.provider.preload(text, options);
    }

    /**
     * Explicitly sets the provider instance.
     *
     * @param {ITTSProvider} provider The new provider to use.
     */
    setProvider(provider: ITTSProvider) {
         this.provider.stop();
         this.provider = provider;
         this.setupProviderListeners();
    }

    /**
     * Gets the ID of the current provider.
     */
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

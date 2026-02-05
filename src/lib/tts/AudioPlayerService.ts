import { Capacitor } from '@capacitor/core';
import type { TTSStatus, TTSQueueItem, DownloadInfo } from './types';
import type { ITTSProvider, TTSVoice } from './providers/types';
import { AudioElementPlayer } from './AudioElementPlayer';
import { WebSpeechProvider } from './providers/WebSpeechProvider';
import { CapacitorTTSProvider } from './providers/CapacitorTTSProvider';
import { PlatformIntegration } from './PlatformIntegration';
import type { IWorkerAudioService, IMainThreadAudioCallback } from './worker/interfaces';
import * as Comlink from 'comlink';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import Worker from './worker/audio.worker?worker';

export type { TTSStatus, TTSQueueItem, DownloadInfo };

type PlaybackListener = (status: TTSStatus, activeCfi: string | null, currentIndex: number, queue: ReadonlyArray<TTSQueueItem>, error: string | null, downloadInfo?: DownloadInfo) => void;

export class AudioPlayerService {
    private static instance: AudioPlayerService;
    private worker: Worker;
    private service: Comlink.Remote<IWorkerAudioService>;
    private listeners: PlaybackListener[] = [];

    private status: TTSStatus = 'stopped';
    private activeCfi: string | null = null;
    private currentIndex: number = 0;
    private queue: ReadonlyArray<TTSQueueItem> = [];

    // Audio Players
    private audioPlayer: AudioElementPlayer;
    private localProvider: ITTSProvider;
    private platformIntegration: PlatformIntegration;

    private callback: IMainThreadAudioCallback;

    private constructor() {
        this.worker = new Worker();
        this.service = Comlink.wrap<IWorkerAudioService>(this.worker);
        this.audioPlayer = new AudioElementPlayer();

        // Initialize Platform Integration
        this.platformIntegration = new PlatformIntegration({
            onPlay: () => this.service.play(),
            onPause: () => this.service.pause(),
            onStop: () => this.service.stop(),
            onPrev: () => this.service.prev(),
            onNext: () => this.service.next(),
            onSeek: (offset) => this.service.seek(offset),
            onSeekTo: (time) => this.service.seekTo(time),
        });

        // Initialize Local Provider
        if (Capacitor.isNativePlatform()) {
            this.localProvider = new CapacitorTTSProvider();
        } else {
            this.localProvider = new WebSpeechProvider();
        }
        this.setupLocalProviderListeners();

        this.setupAudioPlayerListeners();

        // Create callback implementation
        this.callback = {
            onStatusUpdate: (status, cfi, index, queue) => {
                this.status = status;
                this.activeCfi = cfi;
                this.currentIndex = index;
                this.queue = queue;
                this.platformIntegration.updatePlaybackState(status);
                this.notifyListeners();
            },
            onError: (message) => {
                this.notifyError(message);
            },
            onDownloadProgress: (voiceId, percent, status) => {
                this.notifyDownloadProgress(voiceId, percent, status);
            },
            playBlob: async (blob, playbackRate) => {
                this.audioPlayer.setRate(playbackRate);
                try {
                    await this.audioPlayer.playBlob(blob);
                } catch (err: any) {
                    console.error("Main Thread Audio Playback Failed", err);
                    this.service.onAudioError(err.message || String(err));
                }
            },
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            playLocal: async (text, options, _provider) => {
                await this.localProvider.play(text, options);
            },
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            preloadLocal: async (text, options, _provider) => {
                await this.localProvider.preload(text, options);
            },
            pausePlayback: () => {
                this.audioPlayer.pause();
                this.localProvider.pause();
            },
            resumePlayback: () => {
                this.audioPlayer.resume();
                this.localProvider.resume();
            },
            stopPlayback: () => {
                this.audioPlayer.stop();
                this.localProvider.stop();
                this.platformIntegration.stop();
            },
            setPlaybackRate: (speed) => {
                this.audioPlayer.setRate(speed);
            },
            updateMetadata: (metadata) => {
                if (metadata.metadata) {
                    this.platformIntegration.updateMetadata(metadata.metadata);
                }
                if (metadata.positionState) {
                    this.platformIntegration.setPositionState(metadata.positionState);
                }
            },
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            updatePlaybackPosition: (_bookId, _cfi) => {
            },
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            addCompletedRange: (_bookId, _cfi) => {
            },
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            updateHistory: (_bookId, _cfi, _text, _completed) => {
            },
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            updateCost: (_characters) => {
            },
            getLocalVoices: async () => {
                await this.localProvider.init();
                return await this.localProvider.getVoices();
            }
        };

        // Initialize Worker Service
        this.service.init(
            Comlink.proxy(this.callback),
            Capacitor.isNativePlatform()
        );
    }

    static getInstance(): AudioPlayerService {
        if (!AudioPlayerService.instance) {
            AudioPlayerService.instance = new AudioPlayerService();
        }
        return AudioPlayerService.instance;
    }

    private setupLocalProviderListeners() {
        this.localProvider.on((event) => {
            const isNative = Capacitor.isNativePlatform();
            const providerType = isNative ? 'native' : 'local';

            switch (event.type) {
                case 'start':
                    this.service.onRemotePlayStart(providerType);
                    break;
                case 'end':
                    this.service.onRemotePlayEnded(providerType);
                    break;
                case 'error':
                    this.service.onRemotePlayError(providerType, String(event.error));
                    break;
                case 'timeupdate':
                    this.service.onRemoteTimeUpdate(providerType, event.currentTime, event.duration);
                    break;
                case 'boundary':
                     this.service.onRemoteBoundary(providerType, event.charIndex);
                     break;
            }
        });
    }

    private setupAudioPlayerListeners() {
        this.audioPlayer.setOnEnded(() => {
            this.service.onAudioEnded();
        });
        this.audioPlayer.setOnError((e) => {
             const errorMsg = typeof e === 'string' ? e : "Audio Error";
             this.service.onAudioError(errorMsg);
        });
        this.audioPlayer.setOnTimeUpdate((time) => {
             this.service.onAudioTimeUpdate(time, this.audioPlayer.getDuration());
        });
    }

    // --- Public API ---

    subscribe(listener: PlaybackListener) {
        this.listeners.push(listener);
        setTimeout(() => {
             listener(this.status, this.activeCfi, this.currentIndex, this.queue, null);
        }, 0);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    play() { this.service.play(); }
    pause() { this.service.pause(); }
    stop() { this.service.stop(); }
    next() { this.service.next(); }
    prev() { this.service.prev(); }

    setSpeed(speed: number) { this.service.setSpeed(speed); }
    setVoice(voiceId: string) { this.service.setVoice(voiceId); }

    jumpTo(index: number) { this.service.jumpTo(index); }
    seek(offset: number) { this.service.seek(offset); }
    seekTo(time: number) { this.service.seekTo(time); }

    setBookId(bookId: string | null) { this.service.setBookId(bookId); }

    loadSection(index: number, autoPlay: boolean = true) {
         this.service.loadSection(index, autoPlay);
    }

    loadSectionBySectionId(sectionId: string, autoPlay: boolean = true, title?: string) {
        this.service.loadSectionBySectionId(sectionId, autoPlay, title);
    }

    setQueue(items: TTSQueueItem[], startIndex: number = 0) {
        this.service.setQueue(items, startIndex);
    }

    setPrerollEnabled(enabled: boolean) {
        this.service.setPrerollEnabled(enabled);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setBackgroundAudioMode(mode: any) {
        this.platformIntegration.setBackgroundAudioMode(mode, this.status === 'playing' || this.status === 'loading');
        this.service.setBackgroundAudioMode(mode);
    }

    setBackgroundVolume(volume: number) {
         this.platformIntegration.setBackgroundVolume(volume);
         this.service.setBackgroundVolume(volume);
    }

    preview(text: string) {
        this.service.preview(text);
    }

    skipToNextSection() {
        this.service.skipToNextSection();
    }

    skipToPreviousSection() {
        this.service.skipToPreviousSection();
    }

    getQueue(): ReadonlyArray<TTSQueueItem> {
        return this.queue;
    }

    // Provider Management
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async setProvider(providerId: string | ITTSProvider, config?: any) {
        if (typeof providerId !== 'string') {
            console.warn("AudioPlayerService.setProvider called with object. Expecting providerId string.");
            if ('id' in providerId) {
                this.service.setProvider(providerId.id, config);
            }
            return;
        }
        this.service.setProvider(providerId, config);
    }

    async init() {
    }

    // Async Methods with Response
    async getVoices(): Promise<TTSVoice[]> {
        return await this.service.getVoices(crypto.randomUUID());
    }

    async isVoiceDownloaded(voiceId: string): Promise<boolean> {
        return await this.service.isVoiceDownloaded(voiceId, crypto.randomUUID());
    }

    downloadVoice(voiceId: string) {
        this.service.downloadVoice(voiceId);
        return Promise.resolve();
    }

    deleteVoice(voiceId: string) {
        this.service.deleteVoice(voiceId);
        return Promise.resolve();
    }

    // Helpers
    private notifyListeners() {
        this.listeners.forEach(l => l(this.status, this.activeCfi, this.currentIndex, this.queue, null));
    }

    private notifyError(message: string) {
        this.listeners.forEach(l => l(this.status, this.activeCfi, this.currentIndex, this.queue, message));
    }

    private notifyDownloadProgress(voiceId: string, percent: number, status: string) {
        this.listeners.forEach(l => l(this.status, this.activeCfi, this.currentIndex, this.queue, null, { voiceId, percent, status }));
    }
}

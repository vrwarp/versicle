import { Capacitor } from '@capacitor/core';
import type { TTSStatus, TTSQueueItem, DownloadInfo } from './types';
import type { ITTSProvider, TTSVoice } from './providers/types';
import { AudioElementPlayer } from './AudioElementPlayer';
import { WebSpeechProvider } from './providers/WebSpeechProvider';
import { CapacitorTTSProvider } from './providers/CapacitorTTSProvider';
import { PlatformIntegration } from './PlatformIntegration';
import type { MainToWorkerMessage, WorkerToMainMessage } from './worker/messages';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import Worker from './worker/audio.worker?worker';

export type { TTSStatus, TTSQueueItem, DownloadInfo };

type PlaybackListener = (status: TTSStatus, activeCfi: string | null, currentIndex: number, queue: ReadonlyArray<TTSQueueItem>, error: string | null, downloadInfo?: DownloadInfo) => void;

export class AudioPlayerService {
    private static instance: AudioPlayerService;
    private worker: Worker;
    private listeners: PlaybackListener[] = [];

    private status: TTSStatus = 'stopped';
    private activeCfi: string | null = null;
    private currentIndex: number = 0;
    private queue: TTSQueueItem[] = [];

    // Audio Players
    private audioPlayer: AudioElementPlayer;
    private localProvider: ITTSProvider;
    private platformIntegration: PlatformIntegration;

    // Callbacks for local providers (proxied from worker)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private localProviderCallbacks: Map<string, (result: any) => void> = new Map();

    private constructor() {
        this.worker = new Worker();
        this.audioPlayer = new AudioElementPlayer();

        // Initialize Platform Integration (Media Session, Lock Screen)
        this.platformIntegration = new PlatformIntegration({
            onPlay: () => this.postMessage({ type: 'PLAY' }),
            onPause: () => this.postMessage({ type: 'PAUSE' }),
            onStop: () => this.postMessage({ type: 'STOP' }),
            onPrev: () => this.postMessage({ type: 'PREV' }),
            onNext: () => this.postMessage({ type: 'NEXT' }),
            onSeek: (offset) => this.postMessage({ type: 'SEEK', offset }),
            onSeekTo: (time) => this.postMessage({ type: 'SEEK_TO', time }),
        });

        // Initialize Local Provider
        if (Capacitor.isNativePlatform()) {
            this.localProvider = new CapacitorTTSProvider();
        } else {
            this.localProvider = new WebSpeechProvider();
        }
        this.setupLocalProviderListeners();

        this.setupWorkerListeners();
        this.setupAudioPlayerListeners();

        // Initialize Worker
        this.postMessage({
            type: 'INIT',
            isNative: Capacitor.isNativePlatform()
        });
    }

    static getInstance(): AudioPlayerService {
        if (!AudioPlayerService.instance) {
            AudioPlayerService.instance = new AudioPlayerService();
        }
        return AudioPlayerService.instance;
    }

    private postMessage(msg: MainToWorkerMessage) {
        this.worker.postMessage(msg);
    }

    private setupLocalProviderListeners() {
        this.localProvider.on((event) => {
            const isNative = Capacitor.isNativePlatform();
            const providerType = isNative ? 'native' : 'local';

            switch (event.type) {
                case 'start':
                    this.postMessage({ type: 'REMOTE_PLAY_START', provider: providerType });
                    break;
                case 'end':
                    this.postMessage({ type: 'REMOTE_PLAY_ENDED', provider: providerType });
                    break;
                case 'error':
                    this.postMessage({ type: 'REMOTE_PLAY_ERROR', provider: providerType, error: String(event.error) });
                    break;
                case 'timeupdate':
                    this.postMessage({ type: 'REMOTE_TIME_UPDATE', provider: providerType, time: event.currentTime, duration: event.duration });
                    break;
                case 'boundary':
                     this.postMessage({ type: 'REMOTE_BOUNDARY', provider: providerType, charIndex: event.charIndex });
                     break;
            }
        });
    }

    private setupWorkerListeners() {
        this.worker.onmessage = async (e: MessageEvent<WorkerToMainMessage>) => {
            const msg = e.data;
            switch (msg.type) {
                case 'STATUS_UPDATE':
                    this.status = msg.status;
                    this.activeCfi = msg.cfi;
                    this.currentIndex = msg.index;
                    this.queue = msg.queue;
                    this.platformIntegration.updatePlaybackState(msg.status);
                    this.notifyListeners();
                    break;
                case 'ERROR':
                    this.notifyError(msg.message);
                    break;
                case 'DOWNLOAD_PROGRESS':
                    this.notifyDownloadProgress(msg.voiceId, msg.percent, msg.status);
                    break;

                // --- Audio Playback ---
                case 'PLAY_BLOB':
                    this.audioPlayer.setRate(msg.playbackRate);
                    this.audioPlayer.playBlob(msg.blob).catch(err => {
                        console.error("Main Thread Audio Playback Failed", err);
                        this.postMessage({ type: 'AUDIO_ERROR', error: err.message });
                    });
                    break;
                case 'PLAY_LOCAL':
                case 'PLAY_NATIVE':
                    await this.localProvider.play(msg.text, msg.options);
                    break;
                case 'PRELOAD_LOCAL':
                case 'PRELOAD_NATIVE':
                    await this.localProvider.preload(msg.text, msg.options);
                    break;

                case 'PAUSE_PLAYBACK':
                    this.audioPlayer.pause();
                    this.localProvider.pause();
                    break;
                case 'RESUME_PLAYBACK':
                    this.audioPlayer.resume();
                    this.localProvider.resume();
                    break;
                case 'STOP_PLAYBACK':
                    this.audioPlayer.stop();
                    this.localProvider.stop();
                    this.platformIntegration.stop(); // Clear notification
                    break;
                case 'SET_PLAYBACK_RATE':
                    this.audioPlayer.setRate(msg.speed);
                    // Local provider speed is set per play() call, so we don't need to set it here globally
                    break;

                // --- Metadata & UI ---
                case 'UPDATE_METADATA':
                    this.platformIntegration.updateMetadata(msg.metadata.metadata);
                    if (msg.metadata.positionState) {
                        this.platformIntegration.setPositionState(msg.metadata.positionState);
                    }
                    break;

                // --- Provider Management ---
                case 'GET_LOCAL_VOICES':
                    await this.localProvider.init();
                    const voices = await this.localProvider.getVoices();
                    this.postMessage({ type: 'LOCAL_VOICES_LIST', voices, reqId: msg.reqId });
                    break;

                case 'GET_ALL_VOICES_RESULT':
                case 'CHECK_VOICE_RESULT':
                    const cb = this.localProviderCallbacks.get(msg.reqId);
                    if (cb) {
                        if (msg.type === 'GET_ALL_VOICES_RESULT') cb(msg.voices);
                        if (msg.type === 'CHECK_VOICE_RESULT') cb(msg.isDownloaded);
                        this.localProviderCallbacks.delete(msg.reqId);
                    }
                    break;
            }
        };
    }

    private setupAudioPlayerListeners() {
        this.audioPlayer.setOnEnded(() => {
            this.postMessage({ type: 'AUDIO_ENDED' });
        });
        this.audioPlayer.setOnError((e) => {
             const errorMsg = typeof e === 'string' ? e : "Audio Error";
             this.postMessage({ type: 'AUDIO_ERROR', error: errorMsg });
        });
        this.audioPlayer.setOnTimeUpdate((time) => {
             this.postMessage({ type: 'AUDIO_TIME_UPDATE', time, duration: this.audioPlayer.getDuration() });
        });
    }

    // --- Public API (Proxies) ---

    subscribe(listener: PlaybackListener) {
        this.listeners.push(listener);
        setTimeout(() => {
             listener(this.status, this.activeCfi, this.currentIndex, this.queue, null);
        }, 0);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    play() { this.postMessage({ type: 'PLAY' }); }
    pause() { this.postMessage({ type: 'PAUSE' }); }
    stop() { this.postMessage({ type: 'STOP' }); }
    next() { this.postMessage({ type: 'NEXT' }); }
    prev() { this.postMessage({ type: 'PREV' }); }

    setSpeed(speed: number) { this.postMessage({ type: 'SET_SPEED', speed }); }
    setVoice(voiceId: string) { this.postMessage({ type: 'SET_VOICE', voiceId }); }

    jumpTo(index: number) { this.postMessage({ type: 'JUMP_TO', index }); }
    seek(offset: number) { this.postMessage({ type: 'SEEK', offset }); }
    seekTo(time: number) { this.postMessage({ type: 'SEEK_TO', time }); }

    setBookId(bookId: string | null) { this.postMessage({ type: 'SET_BOOK', bookId }); }

    loadSection(index: number, autoPlay: boolean = true) {
         this.postMessage({ type: 'LOAD_SECTION', index, autoPlay });
    }

    loadSectionBySectionId(sectionId: string, autoPlay: boolean = true, title?: string) {
        this.postMessage({ type: 'LOAD_SECTION_BY_ID', sectionId, autoPlay, title });
    }

    setQueue(items: TTSQueueItem[], startIndex: number = 0) {
        this.postMessage({ type: 'SET_QUEUE', items, startIndex });
    }

    setPrerollEnabled(enabled: boolean) {
        this.postMessage({ type: 'SET_PREROLL', enabled });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setBackgroundAudioMode(mode: any) {
        this.platformIntegration.setBackgroundAudioMode(mode, this.status === 'playing' || this.status === 'loading');
        this.postMessage({ type: 'SET_BG_MODE', mode });
    }

    setBackgroundVolume(volume: number) {
         this.platformIntegration.setBackgroundVolume(volume);
         this.postMessage({ type: 'SET_BG_VOLUME', volume });
    }

    preview(text: string) {
        this.postMessage({ type: 'PREVIEW', text });
    }

    skipToNextSection() {
        this.postMessage({ type: 'SKIP_NEXT_SECTION' });
    }

    skipToPreviousSection() {
        this.postMessage({ type: 'SKIP_PREV_SECTION' });
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
                this.postMessage({ type: 'SET_PROVIDER', providerId: providerId.id, config });
            }
            return;
        }
        this.postMessage({ type: 'SET_PROVIDER', providerId, config });
    }

    async init() {
    }

    // Async Methods with Response
    getVoices(): Promise<TTSVoice[]> {
        return new Promise((resolve) => {
            const reqId = crypto.randomUUID();
            this.localProviderCallbacks.set(reqId, resolve);
            this.postMessage({ type: 'GET_ALL_VOICES', reqId });
        });
    }

    isVoiceDownloaded(voiceId: string): Promise<boolean> {
        return new Promise((resolve) => {
             const reqId = crypto.randomUUID();
             this.localProviderCallbacks.set(reqId, resolve);
             this.postMessage({ type: 'CHECK_VOICE', voiceId, reqId });
        });
    }

    downloadVoice(voiceId: string) {
        this.postMessage({ type: 'DOWNLOAD_VOICE', voiceId });
        return Promise.resolve();
    }

    deleteVoice(voiceId: string) {
        this.postMessage({ type: 'DELETE_VOICE', voiceId });
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

import type { TTSQueueItem, TTSStatus } from '../types';
import type { TTSVoice } from '../providers/types';

export interface IMainThreadAudioCallback {
    // Status Updates
    onStatusUpdate(status: TTSStatus, cfi: string | null, index: number, queue: TTSQueueItem[]): void;
    onError(message: string): void;
    onDownloadProgress(voiceId: string, percent: number, status: string): void;

    // Audio Playback (Worker -> Main)
    playBlob(blob: Blob, playbackRate: number): Promise<void>;

    // Local/Native TTS Commands (Worker -> Main)
    // The worker instructs the main thread to play via the local provider
    playLocal(text: string, options: { voiceId: string; speed: number }, provider: 'local' | 'native'): Promise<void>;
    preloadLocal(text: string, options: { voiceId: string; speed: number }, provider: 'local' | 'native'): Promise<void>;

    // Playback Control (Worker -> Main)
    // Used for controlling the AudioElementPlayer or Local Provider on Main Thread
    pausePlayback(): void;
    resumePlayback(): void;
    stopPlayback(): void;
    setPlaybackRate(speed: number): void;

    // Metadata (Worker -> Main)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateMetadata(metadata: any): void;
    updatePlaybackPosition(bookId: string, cfi: string): void;
    addCompletedRange(bookId: string, cfi: string): void;
    updateHistory(bookId: string, cfi: string, text: string, completed: boolean): void;
    updateCost(characters: number): void;

    // Provider Management (Worker -> Main)
    // Worker asks Main to get voices from the local provider
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getLocalVoices(): Promise<any[]>;
}

export interface IWorkerAudioService {
    // Initialization
    init(callback: IMainThreadAudioCallback, isNative: boolean): Promise<void>;

    setBookId(bookId: string | null): void;

    // Playback Control (Main -> Worker)
    play(): Promise<void>;
    pause(): Promise<void>;
    stop(): Promise<void>;
    next(): Promise<void>;
    prev(): Promise<void>;
    jumpTo(index: number): Promise<void>;
    seekTo(time: number): Promise<void>;
    seek(offset: number): Promise<void>;
    setSpeed(speed: number): Promise<void>;
    setVoice(voiceId: string): Promise<void>;

    // Queue/Load
    loadSection(index: number, autoPlay: boolean): Promise<void>;
    loadSectionBySectionId(sectionId: string, autoPlay: boolean, title?: string): Promise<void>;
    setQueue(items: TTSQueueItem[], startIndex: number): Promise<void>;

    // Features
    setPrerollEnabled(enabled: boolean): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setBackgroundAudioMode(mode: any): void;
    setBackgroundVolume(volume: number): void;
    preview(text: string): Promise<void>;
    skipToNextSection(): Promise<void>;
    skipToPreviousSection(): Promise<void>;

    // Provider Management
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setProvider(providerId: string, config?: any): Promise<void>;
    getVoices(reqId: string): Promise<TTSVoice[]>;
    isVoiceDownloaded(voiceId: string, reqId: string): Promise<boolean>;
    downloadVoice(voiceId: string): Promise<void>;
    deleteVoice(voiceId: string): Promise<void>;

    // Feedback from Remote Provider (Main -> Worker)
    // These are called by Main when the local provider emits events
    onRemotePlayStart(provider: 'local' | 'native'): void;
    onRemotePlayEnded(provider: 'local' | 'native'): void;
    onRemotePlayError(provider: 'local' | 'native', error: string): void;
    onRemoteTimeUpdate(provider: 'local' | 'native', time: number, duration: number): void;
    onRemoteBoundary(provider: 'local' | 'native', charIndex: number): void;

    // Audio Feedback (Main -> Worker)
    // Called when the Blob audio player emits events
    onAudioEnded(): void;
    onAudioError(error: string): void;
    onAudioTimeUpdate(time: number, duration: number): void;
}

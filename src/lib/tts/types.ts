export type TTSStatus = 'playing' | 'paused' | 'stopped' | 'loading' | 'completed';

export interface TTSQueueItem {
    text: string;
    cfi: string | null;
    title?: string;
    author?: string;
    bookTitle?: string;
    coverUrl?: string;
    isPreroll?: boolean;
    isSkipped?: boolean;
    sourceIndices?: number[];
}

export interface DownloadInfo {
    voiceId: string;
    percent: number;
    status: string;
}

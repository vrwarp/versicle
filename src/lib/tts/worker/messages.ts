import type { TTSQueueItem, TTSStatus, DownloadInfo } from '../AudioPlayerService';
import type { AlignmentData } from '../SyncEngine';

// --- Main -> Worker Messages ---

export type MainToWorkerMessage =
    | { type: 'INIT'; isNative: boolean }
    | { type: 'PLAY' }
    | { type: 'PAUSE' }
    | { type: 'STOP' }
    | { type: 'NEXT' }
    | { type: 'PREV' }
    | { type: 'SEEK'; offset: number }
    | { type: 'SEEK_TO'; time: number }
    | { type: 'SET_BOOK'; bookId: string | null; initialProgress?: any }
    | { type: 'LOAD_SECTION'; index: number; autoPlay: boolean; title?: string }
    | { type: 'LOAD_SECTION_BY_ID'; sectionId: string; autoPlay: boolean; title?: string }
    | { type: 'SET_QUEUE'; items: TTSQueueItem[]; startIndex: number }
    | { type: 'JUMP_TO'; index: number }
    | { type: 'SET_SPEED'; speed: number }
    | { type: 'SET_VOICE'; voiceId: string }
    | { type: 'SET_PROVIDER'; providerId: string; config?: any }
    | { type: 'SET_PREROLL'; enabled: boolean }
    | { type: 'SET_BG_AUDIO'; mode: any }
    | { type: 'SET_BG_VOLUME'; volume: number }
    | { type: 'PREVIEW'; text: string }
    // Remote Provider Feedback (Main -> Worker)
    | { type: 'REMOTE_PLAY_ENDED'; provider: 'local' | 'native' }
    | { type: 'REMOTE_PLAY_ERROR'; provider: 'local' | 'native'; error: string }
    | { type: 'REMOTE_TIME_UPDATE'; provider: 'local' | 'native'; time: number; duration: number }
    | { type: 'REMOTE_PLAY_START'; provider: 'local' | 'native' }
    | { type: 'REMOTE_BOUNDARY'; provider: 'local' | 'native'; charIndex: number }
    | { type: 'LOCAL_VOICES_LIST'; voices: any[]; reqId: string }
    // Audio Player (Blob) Feedback
    | { type: 'AUDIO_ENDED' }
    | { type: 'AUDIO_ERROR'; error: string }
    | { type: 'AUDIO_TIME_UPDATE'; time: number; duration: number }
    // Provider Management Requests (UI -> Worker)
    | { type: 'DOWNLOAD_VOICE'; voiceId: string }
    | { type: 'DELETE_VOICE'; voiceId: string }
    | { type: 'CHECK_VOICE'; voiceId: string; reqId: string }
    | { type: 'GET_ALL_VOICES'; reqId: string };

// --- Worker -> Main Messages ---

export type WorkerToMainMessage =
    | { type: 'STATUS_UPDATE'; status: TTSStatus; cfi: string | null; index: number; queue: TTSQueueItem[] }
    | { type: 'ERROR'; message: string }
    | { type: 'DOWNLOAD_PROGRESS'; voiceId: string; percent: number; status: string }
    // Audio Playback Commands
    | { type: 'PLAY_BLOB'; blob: Blob; playbackRate: number }
    | { type: 'PLAY_LOCAL'; text: string; options: { voiceId: string; speed: number } }
    | { type: 'PRELOAD_LOCAL'; text: string; options: { voiceId: string; speed: number } }
    | { type: 'PLAY_NATIVE'; text: string; options: { voiceId: string; speed: number } }
    | { type: 'PRELOAD_NATIVE'; text: string; options: { voiceId: string; speed: number } }
    | { type: 'PAUSE_PLAYBACK' }
    | { type: 'RESUME_PLAYBACK' }
    | { type: 'STOP_PLAYBACK' }
    | { type: 'SET_PLAYBACK_RATE'; speed: number }
    // UI/Store Updates
    | { type: 'UPDATE_METADATA'; metadata: any }
    | { type: 'UPDATE_TTS_PROGRESS'; bookId: string; index: number; sectionIndex: number }
    | { type: 'ADD_COMPLETED_RANGE'; bookId: string; cfi: string }
    | { type: 'UPDATE_PLAYBACK_POSITION'; bookId: string; cfi: string }
    | { type: 'UPDATE_HISTORY'; bookId: string; cfi: string; text: string; completed: boolean }
    | { type: 'UPDATE_COST'; characters: number }
    // Provider Management Responses
    | { type: 'GET_LOCAL_VOICES'; reqId: string }
    | { type: 'CHECK_VOICE_RESULT'; reqId: string; isDownloaded: boolean }
    | { type: 'GET_ALL_VOICES_RESULT'; reqId: string; voices: any[] };

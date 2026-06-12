import { create } from 'zustand';
import type { TTSVoice } from '@lib/tts/providers/types';
import type { TTSStatus, TTSQueueItem } from '@lib/tts/AudioPlayerService';

/**
 * EPHEMERAL TTS playback state — the other half of the 5b split of the legacy
 * `tts-storage` god store (plan/overhaul/prep/phase5-tts-strangler.md §5b.4).
 *
 * Never persisted, never replicated into the worker: this store is the
 * main-thread mirror of the engine's PlaybackSnapshot stream (written
 * exclusively by TtsController.initialize()'s subscription) plus engine
 * runtime state (readiness, the loaded voice list, voice-download progress).
 *
 * Because playback state lives HERE and the replicated settings live in
 * `useTTSSettingsStore`, an engine broadcast can no longer re-enter the
 * settings replication slice — the per-sentence echo loop (S6) is dead by
 * construction (pinned in replication.test.ts).
 */
interface TTSPlaybackState {
    /** Current status of playback (engine mirror). */
    status: TTSStatus;
    /** Derived via isAudiblePlayback (loading/completed count as playing). */
    isPlaying: boolean;
    /** The CFI of the currently spoken sentence or segment (engine mirror). */
    activeCfi: string | null;
    /** Current index in the playback queue (engine mirror). */
    currentIndex: number;
    /** The playback queue (engine mirror). */
    queue: readonly TTSQueueItem[];
    /** The last error message, if any (engine mirror). */
    lastError: string | null;

    /** Whether the engine is ready to accept commands (worker booted + subscribed). */
    engineReady: boolean;

    /** List of available voices (loaded by TtsController.loadVoices). */
    voices: TTSVoice[];
    /** The resolved active voice (TtsController owns the fallback selection). */
    voice: TTSVoice | null;

    /** Download State (for Piper) */
    downloadProgress: number;
    downloadStatus: string | null;
    downloadingVoiceId: string | null;
    isDownloading: boolean;

    /** Actions (pure state writes). */
    clearError: () => void;
}

export const useTTSPlaybackStore = create<TTSPlaybackState>()((set) => ({
    status: 'stopped',
    isPlaying: false,
    activeCfi: null,
    currentIndex: 0,
    queue: [],
    lastError: null,

    engineReady: false,

    voices: [],
    voice: null,

    downloadProgress: 0,
    downloadStatus: null,
    downloadingVoiceId: null,
    isDownloading: false,

    clearError: () => {
        set({ lastError: null });
    },
}));

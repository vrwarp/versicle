/**
 * The C4 engine RPC contract (Phase 5b; plan/overhaul/prep/phase5-tts-strangler.md §5b.2):
 * ONE immutable {@link PlaybackSnapshot} stream replaces the four positional notification
 * paths the engine used to have (state-manager notify, setStatus notify, notifyError,
 * notifyDownloadProgress) and the 6-argument `PlaybackListener` tuple.
 *
 *  - `seq` is monotonic per engine instance: the worker handle drops out-of-order Comlink
 *    deliveries so consumers can never observe time running backwards.
 *  - `queueId` changes iff the queue's content identity changed; `queue` itself is included
 *    only in snapshots where it changed (and in the subscribe replay) — the broadcast diet
 *    that lets repeated status updates cross the worker boundary without re-cloning the
 *    queue (P23).
 *  - `error` is a one-shot field: it is non-null exactly on the snapshot that surfaces the
 *    failure (codes `TTS_*`, C10 alignment) and null again on the next publish.
 *
 * This module is worker-importable: type-only imports plus one pure function.
 */
import type { TTSQueueItem } from '~types/tts';
import type { TTSVoice } from '../providers/types';

/** The possible states of TTS playback (canonical home since 5b-PR2). */
export type TTSStatus = 'playing' | 'paused' | 'stopped' | 'loading' | 'completed';

/** Voice-data download progress (Piper). */
export interface DownloadInfo {
    voiceId: string;
    percent: number;
    status: string;
}

/** A playback error surfaced through the snapshot stream (C10 `TTS_*` codes). */
export interface PlaybackError {
    readonly code: string;
    readonly message: string;
}

/** The single immutable broadcast shape of the engine. */
export interface PlaybackSnapshot {
    /** Monotonic, engine-side; staleness detection across the worker boundary. */
    readonly seq: number;
    readonly status: TTSStatus;
    /** Changes iff queue content identity changes (P23's broadcast diet). */
    readonly queueId: string;
    /**
     * Included only when `queueId` changed since the previous published snapshot
     * (and on subscribe replay); omitted otherwise — consumers keep their cached
     * queue for the same `queueId`.
     */
    readonly queue?: ReadonlyArray<TTSQueueItem>;
    readonly index: number;
    readonly sectionIndex: number;
    readonly activeCfi: string | null;
    /** Non-null exactly on the publish that surfaces a failure. */
    readonly error: PlaybackError | null;
    /** Non-null exactly on download-progress publishes. */
    readonly download: DownloadInfo | null;
}

export type SnapshotListener = (snapshot: PlaybackSnapshot) => void;

/**
 * The one tested derivation of "the UI should look like audio is active" — the
 * former inline "treat loading as playing" comment in the store mirror, now an
 * explicit selector (named regression: useTTSStore initialize / flicker guard):
 *  - 'loading' counts as playing to prevent play/pause button flicker during
 *    transitions between sentences or while buffering;
 *  - 'completed' counts as playing to keep background audio and the immersive
 *    UI active after the final sentence.
 */
export function isAudiblePlayback(status: TTSStatus): boolean {
    return status === 'playing' || status === 'loading' || status === 'completed';
}

/**
 * The public engine surface the app talks to — a STANDALONE interface since 5b-PR2
 * (no longer a `Pick` of AudioPlayerService; the S8 coupling is gone). Both the
 * in-process `AudioPlayerService` and the worker-backed `WorkerEngineHandle`
 * implement it, so the app can be pointed at either via `getAudioPlayer()`.
 *
 * Commands are ACKs: a resolved promise means the command was accepted (enqueued),
 * not completed — results flow exclusively through the snapshot stream.
 */
export interface TtsEngine {
    readonly engineName: string;

    // --- Playback control ---
    play(): Promise<void>;
    pause(): Promise<void> | void;
    stop(): Promise<void> | void;
    preview(text: string): Promise<void>;
    setSpeed(speed: number): Promise<void> | void;
    setVoice(voiceId: string): Promise<void> | void;
    setLanguage(lang: string): void;
    setProviderById(providerId: string): Promise<void> | void;
    setPrerollEnabled(enabled: boolean): void;
    setBackgroundAudioMode(mode: 'silence' | 'noise' | 'off'): void;
    setBackgroundVolume(volume: number): void;
    clearPauseGesture(): void;

    // --- Navigation ---
    setBookId(bookId: string | null): void;
    loadSection(sectionIndex: number, autoPlay?: boolean): Promise<boolean | void>;
    loadSectionBySectionId(sectionId: string, autoPlay?: boolean, title?: string): Promise<void>;
    jumpTo(index: number): Promise<void> | void;
    seek(offset: number): Promise<void> | void;
    skipToNextSection(): Promise<boolean>;
    skipToPreviousSection(): Promise<boolean>;

    // --- Voices / init ---
    init(): Promise<void>;
    getVoices(): Promise<TTSVoice[]>;
    downloadVoice(voiceId: string): Promise<void>;
    deleteVoice(voiceId: string): Promise<void>;
    isVoiceDownloaded(voiceId: string): Promise<boolean>;

    // --- The snapshot stream ---
    /** Subscribe to playback snapshots; the latest snapshot (with queue) replays on the next tick. */
    subscribe(listener: SnapshotListener): () => void;
    /** The latest snapshot, synchronously (always carries the queue). */
    snapshot(): PlaybackSnapshot;
    /** Resolves when the engine is ready to accept commands. */
    whenReady(): Promise<void>;
}

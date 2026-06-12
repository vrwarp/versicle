/**
 * TtsController — the app-layer command facade over the TTS engine (Phase 5b;
 * plan/overhaul/prep/phase5-tts-strangler.md §5b.4).
 *
 * Engine commands used to live as `useTTSStore` actions that wrapped
 * `getAudioPlayer()` — engine plumbing inside a persisted settings store. This
 * controller absorbs all of them, so the stores are pure state and the engine is
 * reached from exactly one place:
 *
 *  - **Commands** (play/pause/stop/seek/jumpTo/preview/voice management/section
 *    navigation/dragnet invalidation): exposed as bound functions; UI components
 *    call them via the {@link useAudioCommands} hook.
 *  - **Engine → store mirror**: `initialize()` subscribes to the engine's
 *    PlaybackSnapshot stream and writes status/queue/index/cfi/error/download
 *    state into the EPHEMERAL `useTTSPlaybackStore` (5b-PR3 split) — including
 *    the tested `isAudiblePlayback` flicker derivation.
 *  - **Store → engine settings sync**: `initialize()` watches the PERSISTED
 *    `useTTSSettingsStore` (rate/voice via the active profile, language, preroll,
 *    background audio, provider, API keys, Bible-lexicon flag) and pushes
 *    changes — replacing the engine calls that used to run inside store setters
 *    and `onRehydrateStorage` (R9 complete).
 *  - **Voice resolution**: the active-voice fallback algorithm (saved profile
 *    voice → language match → English → first available) moved here from the
 *    legacy store's setActiveLanguage/loadVoices — it needs both the persisted
 *    profile and the runtime voice list, which now live in different stores.
 *
 * Because the playback mirror lives in a store that is never persisted and never
 * replicated, an engine broadcast cannot re-enter the settings replication slice:
 * the S6 echo loop is structurally dead (replication.test.ts pins it).
 *
 * `initialize()` runs as the `tts/initialize` boot task (src/app/boot/
 * deviceRegistration.ts) — by then the persisted store has rehydrated (including
 * the tts-storage → tts-settings migration), so the initial push replays the
 * persisted settings into the engine exactly like the old `onRehydrateStorage`
 * side effects did.
 */
import { getAudioPlayer } from './mainThreadAudioPlayer';
import { diagnostics } from '@data/repos/diagnostics';
import type { FlightSnapshot } from '~types/db';
import type { TtsEngine, FlightRecorderExport } from '@lib/tts/engine/TtsEngine';
import { isAudiblePlayback } from '@lib/tts/engine/TtsEngine';
import type { TTSVoice } from '@lib/tts/providers/types';
import { LexiconService } from '@lib/tts/LexiconService';
import {
    useTTSSettingsStore,
    selectActiveRate,
    selectActiveVoiceId,
} from '@store/useTTSSettingsStore';
import { useTTSPlaybackStore } from '@store/useTTSPlaybackStore';
import { ensureAiConsentForBook } from '@app/google/aiConsentPrompt';
import { createLogger } from '@lib/logger';

const logger = createLogger('TtsController');

export class TtsController {
    private readonly engine: TtsEngine;
    private initialized = false;
    /** Mirror of the last setBookId — the consent prompt's subject. */
    private currentBookId: string | null = null;

    constructor(engine: TtsEngine = getAudioPlayer()) {
        this.engine = engine;
    }

    /**
     * Boot task (`tts/initialize`): push the rehydrated settings to the engine,
     * wire the engine→store mirror, and start the store→engine settings sync.
     * Idempotent — subsequent calls are no-ops.
     */
    initialize(): void {
        if (this.initialized) return;
        this.initialized = true;

        const settings = useTTSSettingsStore.getState();

        // Replay the persisted settings into the engine (moved verbatim from the
        // legacy store's onRehydrateStorage side effects; actives derive from the
        // active profile since the split).
        this.engine.setBackgroundAudioMode(settings.backgroundAudioMode);
        this.engine.setBackgroundVolume(settings.whiteNoiseVolume);
        this.engine.setPrerollEnabled(settings.prerollEnabled);
        void this.engine.setSpeed(selectActiveRate(settings));
        const voiceId = selectActiveVoiceId(settings);
        if (voiceId) {
            void this.engine.setVoice(voiceId);
        }
        // Sync lexicon state (main-thread service).
        LexiconService.getInstance().setGlobalBibleLexiconEnabled(settings.isBibleLexiconEnabled);

        // Engine readiness: the worker handle resolves once the worker has booted
        // and subscribed. UI gates on this.
        void this.engine.whenReady().then(() => useTTSPlaybackStore.setState({ engineReady: true }));

        // Engine → store mirror (the single PlaybackSnapshot channel, 5b-PR2),
        // writing into the EPHEMERAL playback store (5b-PR3). The handle delivers
        // FULL snapshots (queue re-attached from its cache when a broadcast
        // omitted it), so the queue spread below only guards against partial
        // snapshots from injected test engines.
        this.engine.subscribe((snap) => {
            useTTSPlaybackStore.setState({
                status: snap.status,
                // The tested flicker selector: 'loading'/'completed' count as playing
                // (see isAudiblePlayback in @lib/tts/engine/TtsEngine).
                isPlaying: isAudiblePlayback(snap.status),
                activeCfi: snap.activeCfi,
                currentIndex: snap.index,
                ...(snap.queue ? { queue: snap.queue } : {}),
                lastError: snap.error?.message ?? null,
                ...(snap.download ? {
                    downloadProgress: snap.download.percent,
                    downloadStatus: snap.download.status,
                    downloadingVoiceId: snap.download.voiceId,
                    isDownloading: snap.download.percent < 100
                } : {})
            });
        });

        // Store → engine settings sync (replaces the engine calls that lived in
        // the legacy store's setters). Each push fires only when its field
        // actually changed. Engine-originated mirror writes land in the PLAYBACK
        // store, which has no subscription here — they cannot echo back as
        // commands (or as replication pushes).
        useTTSSettingsStore.subscribe((s, prev) => {
            if (s.activeLanguage !== prev.activeLanguage) {
                this.engine.setLanguage(s.activeLanguage);
                // Re-resolve the active voice against the loaded voice list (the
                // legacy setActiveLanguage fallback, now controller-owned).
                this.resolveActiveVoice();
            }
            const rate = selectActiveRate(s);
            if (rate !== selectActiveRate(prev)) {
                void this.engine.setSpeed(rate);
            }
            const voiceId = selectActiveVoiceId(s);
            if (voiceId !== selectActiveVoiceId(prev)) {
                if (voiceId) void this.engine.setVoice(voiceId);
                // Keep the resolved voice object in the playback store current.
                const voices = useTTSPlaybackStore.getState().voices;
                useTTSPlaybackStore.setState({ voice: voices.find((v) => v.id === voiceId) ?? null });
            }
            if (s.prerollEnabled !== prev.prerollEnabled) {
                this.engine.setPrerollEnabled(s.prerollEnabled);
            }
            if (s.backgroundAudioMode !== prev.backgroundAudioMode) {
                this.engine.setBackgroundAudioMode(s.backgroundAudioMode);
            }
            if (s.whiteNoiseVolume !== prev.whiteNoiseVolume) {
                this.engine.setBackgroundVolume(s.whiteNoiseVolume);
            }
            if (s.isBibleLexiconEnabled !== prev.isBibleLexiconEnabled) {
                LexiconService.getInstance().setGlobalBibleLexiconEnabled(s.isBibleLexiconEnabled);
            }
            if (s.providerId !== prev.providerId) {
                // Provider switch: re-init the provider and reload its voices
                // (the legacy setProviderId → loadVoices chain).
                void this.loadVoices();
            } else if (s.apiKeys !== prev.apiKeys
                && s.providerId in s.apiKeys
                && s.apiKeys[s.providerId as keyof typeof s.apiKeys] !== prev.apiKeys[s.providerId as keyof typeof prev.apiKeys]) {
                // API key committed for the ACTIVE provider: force a re-init
                // (the legacy setApiKey → setProviderId(providerId) chain).
                void this.loadVoices();
            }
        });
    }

    /**
     * The voice-fallback algorithm of the legacy setActiveLanguage: prefer the
     * profile's saved voice for the active language, else the first voice
     * matching the language; RETAIN the saved id when the list is not loaded
     * yet (the voice-recall regression). Warns when the loaded list has no
     * voice for the language at all.
     */
    private resolveActiveVoice(): void {
        const settings = useTTSSettingsStore.getState();
        const lang = settings.activeLanguage;
        const voices = useTTSPlaybackStore.getState().voices;
        const profileVoiceId = selectActiveVoiceId(settings);

        const languageVoices = voices.filter((v) => v.lang.startsWith(lang));
        const selected = languageVoices.find((v) => v.id === profileVoiceId) ?? languageVoices[0] ?? null;

        if (languageVoices.length === 0 && voices.length > 0) {
            // Warn user if no voices for this language
            import('@store/useToastStore').then(({ useToastStore }) => {
                useToastStore.getState().showToast(`No voices found for ${lang}. Audio playback may not work.`, 'error');
            });
        }

        useTTSPlaybackStore.setState({ voice: selected });
        if (selected) {
            // Record the resolution in the profile (triggers the voiceId watcher,
            // which pushes setVoice to the engine). When no list is loaded the
            // saved profile id is retained untouched.
            settings.setVoiceId(selected.id, lang);
            void this.engine.setVoice(selected.id);
        }
    }

    // --- Playback commands (bound: components destructure them from useAudioCommands) ---

    play = (): void => {
        // Ask-on-first-TTS-play per-book AI consent (P9; the gate is at the
        // egress boundary — playback itself NEVER blocks on the answer, the
        // dialog just resolves before the pipeline can reach the model).
        void this.withAiConsent(() => void this.engine.play());
    };

    /** Resolve the per-book AI consent prompt, then run; failures never block. */
    private async withAiConsent(run: () => void): Promise<void> {
        try {
            await ensureAiConsentForBook(this.currentBookId);
        } catch (e) {
            logger.warn('AI consent prompt failed; continuing without an answer', e);
        }
        run();
    }

    pause = (): void => {
        void this.engine.pause();
    };

    stop = (): void => {
        void this.engine.stop();
    };

    jumpTo = (index: number): void => {
        void this.engine.jumpTo(index);
    };

    seek = (seconds: number): void => {
        void this.engine.seek(seconds);
    };

    preview = (text: string): void => {
        void this.engine.preview(text);
    };

    // --- Book / section navigation ---

    setBookId = (bookId: string | null): void => {
        this.currentBookId = bookId;
        this.engine.setBookId(bookId);
    };

    loadSectionBySectionId = (sectionId: string, autoPlay = true, title?: string): void => {
        if (autoPlay) {
            // Autoplay is a play: same consent pre-flight as play().
            void this.withAiConsent(() =>
                void this.engine.loadSectionBySectionId(sectionId, autoPlay, title));
            return;
        }
        void this.engine.loadSectionBySectionId(sectionId, autoPlay, title);
    };

    skipToNextSection = (): Promise<boolean> => {
        return this.engine.skipToNextSection();
    };

    skipToPreviousSection = (): Promise<boolean> => {
        return this.engine.skipToPreviousSection();
    };

    // --- Diagnostics (S9: the LIVE buffer/stats and the snapshot capture go
    // over the engine handle — in production the WORKER-side flight recorder,
    // the one that actually sees engine traffic; never the main-thread module
    // singleton. The PERSISTED snapshots are plain IndexedDB rows shared by
    // both contexts, served from the diagnostics repo.) ---

    exportDiagnostics = (): Promise<FlightRecorderExport> => {
        return this.engine.exportDiagnostics();
    };

    triggerDiagnosticsSnapshot = (trigger: string, note?: string): Promise<string | null> => {
        return this.engine.triggerDiagnosticsSnapshot(trigger, note);
    };

    listDiagnosticSnapshots = async (): Promise<Omit<FlightSnapshot, 'eventsJSON'>[]> => {
        try {
            return await diagnostics.listSnapshots();
        } catch (e) {
            logger.error('Failed to list diagnostic snapshots', e);
            return [];
        }
    };

    deleteDiagnosticSnapshot = async (id: string): Promise<void> => {
        try {
            await diagnostics.deleteSnapshot(id);
        } catch { /* best effort */ }
    };

    clearDiagnosticSnapshots = async (): Promise<void> => {
        try {
            await diagnostics.clearSnapshots();
        } catch { /* best effort */ }
    };

    shareDiagnosticSnapshot = async (id: string): Promise<void> => {
        const snapshot = await diagnostics.getSnapshot(id);
        if (!snapshot) return;
        const { exportFile } = await import('@lib/export');
        const filename = `flight_${snapshot.trigger}_${new Date(snapshot.createdAt)
            .toISOString().slice(0, 16).replace(/:/g, '-')}.json`;
        await exportFile({
            filename,
            data: snapshot.eventsJSON,
            mimeType: 'application/json',
        });
    };

    // --- Voice management ---

    /**
     * (Re-)apply the configured provider on the engine, load its voice list into
     * the playback store, and re-select the best voice for the active language
     * (saved profile voice → language match → English → first). Moved verbatim
     * from the legacy `useTTSStore.loadVoices` action, with the resolved voice
     * landing in the playback store and the id in the settings profile.
     */
    loadVoices = async (): Promise<void> => {
        // Ensure provider is set on player (in case of fresh load). The id is plain
        // data on both engine paths; the main-thread backend constructs the live
        // provider (with API keys + active language) via the shared factory.
        const { providerId } = useTTSSettingsStore.getState();
        await this.engine.setProviderById(providerId);

        await this.engine.init();
        const voices = await this.engine.getVoices();
        useTTSPlaybackStore.setState({ voices });

        const settings = useTTSSettingsStore.getState();
        const currentVoice = useTTSPlaybackStore.getState().voice;
        const activeLang = settings.activeLanguage;
        const profileVoiceId = settings.profiles[activeLang]?.voiceId;

        let targetVoice: TTSVoice | null = null;

        // 1. If we have a current voice and it still exists in the new list, AND it matches the active language, keep it
        if (currentVoice && voices.find(v => v.id === currentVoice.id) && currentVoice.lang.startsWith(activeLang)) {
            targetVoice = currentVoice;
        }
        // 2. Try the profile's saved voiceId for the active language
        else if (profileVoiceId) {
            targetVoice = voices.find(v => v.id === profileVoiceId) || null;
        }

        // 3. Fallback to any voice matching the active language
        if (!targetVoice && voices.length > 0) {
            targetVoice = voices.find(v => v.lang.startsWith(activeLang)) || null;
        }

        // 4. Ultimate fallback to English, then the first available voice
        if (!targetVoice && voices.length > 0) {
            targetVoice = voices.find(v => v.lang.startsWith('en')) || voices[0];
        }

        if (targetVoice) {
            // Re-set voice to ensure player knows about it (idempotent — the
            // engine guards on identity).
            void this.engine.setVoice(targetVoice.id);
            useTTSPlaybackStore.setState({ voice: targetVoice });
            settings.setVoiceId(targetVoice.id, activeLang);
        }
    };

    downloadVoice = async (voiceId: string): Promise<void> => {
        try {
            useTTSPlaybackStore.setState({ isDownloading: true, downloadingVoiceId: voiceId, downloadStatus: 'Starting...' });
            await this.engine.downloadVoice(voiceId);
            useTTSPlaybackStore.setState({ isDownloading: false, downloadStatus: 'Ready', downloadProgress: 100 });
        } catch (e) {
            logger.warn('Voice download failed', e);
            useTTSPlaybackStore.setState({ isDownloading: false, downloadStatus: 'Failed', lastError: e instanceof Error ? e.message : 'Download failed' });
        }
    };

    deleteVoice = async (voiceId: string): Promise<void> => {
        await this.engine.deleteVoice(voiceId);
        useTTSPlaybackStore.setState({ isDownloading: false, downloadProgress: 0, downloadStatus: 'Not Downloaded', downloadingVoiceId: null });
    };

    checkVoiceDownloaded = (voiceId: string): Promise<boolean> => {
        return this.engine.isVoiceDownloaded(voiceId);
    };
}

let instance: TtsController | null = null;

/** The app-wide controller singleton (constructed over the production engine). */
export function getTtsController(): TtsController {
    if (!instance) {
        instance = new TtsController();
    }
    return instance;
}

/** Test-only: drop the singleton so the next getTtsController() builds fresh. */
export function resetTtsControllerForTests(): void {
    instance = null;
}

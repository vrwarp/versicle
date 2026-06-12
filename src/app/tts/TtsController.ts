/**
 * TtsController — the app-layer command facade over the TTS engine (Phase 5b-PR1;
 * plan/overhaul/prep/phase5-tts-strangler.md §5b.4).
 *
 * Engine commands used to live as `useTTSStore` actions that wrapped
 * `getAudioPlayer()` — engine plumbing inside a persisted settings store. This
 * controller absorbs all of them, so the store is pure state and the engine is
 * reached from exactly one place:
 *
 *  - **Commands** (play/pause/stop/seek/jumpTo/preview/voice management/section
 *    navigation/dragnet invalidation): exposed as bound functions; UI components
 *    call them via the {@link useAudioCommands} hook.
 *  - **Engine → store mirror**: `initialize()` subscribes to the engine's playback
 *    broadcasts and writes status/queue/index/cfi/error/download state into
 *    `useTTSStore` (including the "treat loading/completed as playing" flicker
 *    derivation the UI depends on).
 *  - **Store → engine settings sync**: `initialize()` watches the settings the
 *    engine consumes (rate, voice, language, preroll, background audio, provider,
 *    API keys, Bible-lexicon flag) and pushes changes — replacing the engine calls
 *    that used to run inside store setters and `onRehydrateStorage` (R9 complete:
 *    rehydration is pure; this boot task performs the engine pushes instead).
 *
 * `initialize()` runs as the `tts/initialize` boot task (src/app/boot/
 * deviceRegistration.ts) — by then the persisted store has rehydrated, so the
 * initial push replays the persisted settings into the engine exactly like the
 * old `onRehydrateStorage` side effects did.
 */
import { getAudioPlayer } from './mainThreadAudioPlayer';
import type { TtsEngine } from '@lib/tts/AudioPlayerService';
import type { TTSVoice } from '@lib/tts/providers/types';
import { LexiconService } from '@lib/tts/LexiconService';
import { useTTSStore } from '@store/useTTSStore';
import { createLogger } from '@lib/logger';

const logger = createLogger('TtsController');

export class TtsController {
    private readonly engine: TtsEngine;
    private initialized = false;

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

        const state = useTTSStore.getState();

        // Replay the persisted settings into the engine (moved verbatim from the
        // store's onRehydrateStorage side effects).
        this.engine.setBackgroundAudioMode(state.backgroundAudioMode);
        this.engine.setBackgroundVolume(state.whiteNoiseVolume);
        this.engine.setPrerollEnabled(state.prerollEnabled);
        this.engine.setSpeed(state.rate);
        if (state.voice) {
            this.engine.setVoice(state.voice.id);
        }
        // Sync lexicon state (main-thread service).
        LexiconService.getInstance().setGlobalBibleLexiconEnabled(state.isBibleLexiconEnabled);

        // Engine readiness: the worker handle resolves once the worker has booted
        // and subscribed. UI gates on this.
        void this.engine.whenReady().then(() => useTTSStore.setState({ engineReady: true }));

        // Engine → store mirror.
        this.engine.subscribe((status, activeCfi, currentIndex, queue, error, downloadInfo) => {
            useTTSStore.setState({
                status,
                // Treat 'loading' as playing to prevent UI flicker (play/pause button)
                // during transitions between sentences or while buffering.
                // Treat 'completed' as playing to keep background audio and UI active (immersive mode).
                isPlaying: status === 'playing' || status === 'loading' || status === 'completed',
                activeCfi,
                currentIndex,
                queue,
                lastError: error,
                ...(downloadInfo ? {
                    downloadProgress: downloadInfo.percent,
                    downloadStatus: downloadInfo.status,
                    downloadingVoiceId: downloadInfo.voiceId,
                    isDownloading: downloadInfo.percent < 100
                } : {})
            });
        });

        // Store → engine settings sync (replaces the engine calls that lived in
        // the store's setters). Each push fires only when its field actually
        // changed, so engine-originated mirror writes cannot echo back as
        // commands.
        useTTSStore.subscribe((s, prev) => {
            if (s.activeLanguage !== prev.activeLanguage) {
                this.engine.setLanguage(s.activeLanguage);
            }
            if (s.rate !== prev.rate) {
                void this.engine.setSpeed(s.rate);
            }
            if (s.voice?.id !== prev.voice?.id && s.voice) {
                void this.engine.setVoice(s.voice.id);
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

    // --- Playback commands (bound: components destructure them from useAudioCommands) ---

    play = (): void => {
        void this.engine.play();
    };

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
        this.engine.setBookId(bookId);
    };

    loadSectionBySectionId = (sectionId: string, autoPlay = true, title?: string): void => {
        void this.engine.loadSectionBySectionId(sectionId, autoPlay, title);
    };

    skipToNextSection = (): Promise<boolean> => {
        return this.engine.skipToNextSection();
    };

    skipToPreviousSection = (): Promise<boolean> => {
        return this.engine.skipToPreviousSection();
    };

    /**
     * Invalidate any pending pause→play "Dragnet" capture (deliberate navigation
     * is not a resume gesture). Called synchronously by the reader on section
     * navigation — see useTTS / the ReaderView TOC handler.
     */
    clearPauseGesture = (): void => {
        this.engine.clearPauseGesture();
    };

    // --- Voice management ---

    /**
     * (Re-)apply the configured provider on the engine, load its voice list into
     * the store, and re-select the best voice for the active language (saved
     * profile voice → language match → English → first). Moved verbatim from the
     * legacy `useTTSStore.loadVoices` action.
     */
    loadVoices = async (): Promise<void> => {
        const store = useTTSStore;
        // Ensure provider is set on player (in case of fresh load). The id is plain
        // data on both engine paths; the main-thread backend constructs the live
        // provider (with API keys + active language) via the shared factory.
        const { providerId } = store.getState();
        await this.engine.setProviderById(providerId);

        await this.engine.init();
        const voices = await this.engine.getVoices();
        store.setState({ voices });

        // If current voice is not in new list, pick default
        const currentVoice = store.getState().voice;
        const activeLang = store.getState().activeLanguage;
        const profileVoiceId = store.getState().profiles[activeLang]?.voiceId;

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
            store.getState().setVoice(targetVoice);
        }
    };

    downloadVoice = async (voiceId: string): Promise<void> => {
        try {
            useTTSStore.setState({ isDownloading: true, downloadingVoiceId: voiceId, downloadStatus: 'Starting...' });
            await this.engine.downloadVoice(voiceId);
            useTTSStore.setState({ isDownloading: false, downloadStatus: 'Ready', downloadProgress: 100 });
        } catch (e) {
            logger.warn('Voice download failed', e);
            useTTSStore.setState({ isDownloading: false, downloadStatus: 'Failed', lastError: e instanceof Error ? e.message : 'Download failed' });
        }
    };

    deleteVoice = async (voiceId: string): Promise<void> => {
        await this.engine.deleteVoice(voiceId);
        useTTSStore.setState({ isDownloading: false, downloadProgress: 0, downloadStatus: 'Not Downloaded', downloadingVoiceId: null });
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

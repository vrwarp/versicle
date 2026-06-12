/**
 * TtsController unit tests (Phase 5b) — the command facade between the UI, the
 * split stores (persisted useTTSSettingsStore / ephemeral useTTSPlaybackStore)
 * and the engine.
 *
 * The engine is INJECTED as a fake (no module mock of the composition root):
 * the controller is the only production `getAudioPlayer()` consumer, and these
 * tests pin the responsibilities it absorbed from the legacy store:
 *   1. the engine→store playback mirror into the EPHEMERAL store (incl. the
 *      loading/completed-as-playing flicker derivation, regression:
 *      useTTSStore initialize),
 *   2. the settings→engine sync that used to live inside store setters,
 *   3. the engine command sequences (loadVoices/downloadVoice/…),
 *   4. the voice-fallback algorithm (regression: useTTSStore_voice_recall).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PlaybackSnapshot, SnapshotListener, TtsEngine } from '@lib/tts/engine/TtsEngine';
import type { TTSVoice } from '@lib/tts/providers/types';
import { useTTSSettingsStore } from '@store/useTTSSettingsStore';
import { useTTSPlaybackStore } from '@store/useTTSPlaybackStore';
import { TtsController } from './TtsController';
import { LexiconService } from '@lib/tts/LexiconService';

vi.mock('@lib/tts/LexiconService', () => {
    const instance = { setGlobalBibleLexiconEnabled: vi.fn() };
    return { LexiconService: { getInstance: vi.fn(() => instance) } };
});

function makeFakeEngine() {
    let listener: SnapshotListener | undefined;
    let seq = 0;
    const voices: TTSVoice[] = [];
    const engine = {
        engineName: 'FakeEngine',
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        preview: vi.fn().mockResolvedValue(undefined),
        setSpeed: vi.fn().mockResolvedValue(undefined),
        setVoice: vi.fn().mockResolvedValue(undefined),
        setLanguage: vi.fn(),
        setProviderById: vi.fn().mockResolvedValue(undefined),
        init: vi.fn().mockResolvedValue(undefined),
        getVoices: vi.fn(async () => voices),
        downloadVoice: vi.fn().mockResolvedValue(undefined),
        deleteVoice: vi.fn().mockResolvedValue(undefined),
        isVoiceDownloaded: vi.fn().mockResolvedValue(false),
        subscribe: vi.fn((l: SnapshotListener) => { listener = l; return () => { listener = undefined; }; }),
        setBookId: vi.fn(),
        whenReady: vi.fn().mockResolvedValue(undefined),
        loadSection: vi.fn().mockResolvedValue(undefined),
        loadSectionBySectionId: vi.fn().mockResolvedValue(undefined),
        jumpTo: vi.fn().mockResolvedValue(undefined),
        seek: vi.fn().mockResolvedValue(undefined),
        skipToNextSection: vi.fn().mockResolvedValue(true),
        skipToPreviousSection: vi.fn().mockResolvedValue(true),
        setBackgroundAudioMode: vi.fn(),
        setBackgroundVolume: vi.fn(),
        setPrerollEnabled: vi.fn(),
    };
    /** Fire a snapshot into the controller mirror (full snapshots, like the handle). */
    const fire = (partial: Partial<PlaybackSnapshot>) => {
        const snapshot: PlaybackSnapshot = {
            seq: ++seq,
            status: 'stopped',
            queueId: `q${seq}`,
            queue: [],
            index: 0,
            sectionIndex: -1,
            activeCfi: null,
            error: null,
            download: null,
            ...partial,
        };
        listener?.(snapshot);
    };
    return {
        engine: engine as unknown as TtsEngine,
        raw: engine,
        fire,
        setVoices: (v: TTSVoice[]) => { voices.length = 0; voices.push(...v); },
    };
}

const VOICE_EN = { id: 'v-en', name: 'English Voice', lang: 'en-US', provider: 'local' } as TTSVoice;
const VOICE_ZH = { id: 'v-zh', name: 'Chinese Voice', lang: 'zh-CN', provider: 'local' } as TTSVoice;

const settings = () => useTTSSettingsStore.getState();
const playback = () => useTTSPlaybackStore.getState();

describe('TtsController', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useTTSSettingsStore.setState({
            activeLanguage: 'en',
            profiles: { en: { voiceId: null, rate: 1, minSentenceLength: 36 } },
            providerId: 'webspeech',
            apiKeys: { google: '', openai: '', lemonfox: '' },
            prerollEnabled: false,
            backgroundAudioMode: 'silence',
            whiteNoiseVolume: 0.1,
            isBibleLexiconEnabled: true,
        });
        useTTSPlaybackStore.setState({
            status: 'stopped',
            isPlaying: false,
            activeCfi: null,
            currentIndex: 0,
            queue: [],
            lastError: null,
            engineReady: false,
            voices: [],
            voice: null,
            isDownloading: false,
            downloadProgress: 0,
            downloadStatus: null,
            downloadingVoiceId: null,
        });
    });

    describe('initialize: rehydrated-settings replay (the old onRehydrateStorage side effects)', () => {
        it('pushes persisted background/preroll/speed/voice settings and syncs the lexicon flag', () => {
            useTTSSettingsStore.setState({
                backgroundAudioMode: 'noise',
                whiteNoiseVolume: 0.4,
                prerollEnabled: true,
                profiles: { en: { voiceId: 'v-en', rate: 1.5, minSentenceLength: 36 } },
                isBibleLexiconEnabled: false,
            });
            const { engine, raw } = makeFakeEngine();
            new TtsController(engine).initialize();

            expect(raw.setBackgroundAudioMode).toHaveBeenCalledWith('noise');
            expect(raw.setBackgroundVolume).toHaveBeenCalledWith(0.4);
            expect(raw.setPrerollEnabled).toHaveBeenCalledWith(true);
            expect(raw.setSpeed).toHaveBeenCalledWith(1.5);
            expect(raw.setVoice).toHaveBeenCalledWith('v-en');
            expect(LexiconService.getInstance().setGlobalBibleLexiconEnabled).toHaveBeenCalledWith(false);
        });

        it('marks engineReady once the engine reports ready', async () => {
            const { engine } = makeFakeEngine();
            new TtsController(engine).initialize();
            await vi.waitFor(() => expect(playback().engineReady).toBe(true));
        });

        it('is idempotent: a second initialize() does not double-subscribe', () => {
            const { engine, raw } = makeFakeEngine();
            const controller = new TtsController(engine);
            controller.initialize();
            controller.initialize();
            expect(raw.subscribe).toHaveBeenCalledTimes(1);
        });
    });

    // Regression: the engine→store mirror previously wired by useTTSStore.initialize(),
    // now writing into the ephemeral useTTSPlaybackStore (5b split).
    describe('regression: useTTSStore initialize (engine→playback-store mirror)', () => {
        it('mirrors engine broadcasts, deriving isPlaying for loading/completed (flicker guard)', () => {
            const { engine, fire } = makeFakeEngine();
            new TtsController(engine).initialize();

            fire({ status: 'playing', activeCfi: 'cfi-1', index: 2 });
            expect(playback().isPlaying).toBe(true);
            expect(playback().status).toBe('playing');
            expect(playback().activeCfi).toBe('cfi-1');
            expect(playback().currentIndex).toBe(2);

            fire({ status: 'paused' });
            expect(playback().isPlaying).toBe(false);
            expect(playback().status).toBe('paused');

            // 'loading' must read as playing (prevents play/pause button flicker).
            fire({ status: 'loading' });
            expect(playback().isPlaying).toBe(true);

            // 'completed' must read as playing (keeps background audio + UI active).
            fire({ status: 'completed' });
            expect(playback().isPlaying).toBe(true);

            fire({ status: 'stopped' });
            expect(playback().isPlaying).toBe(false);
        });

        it('merges download info only when present (error broadcasts keep download state)', () => {
            const { engine, fire } = makeFakeEngine();
            new TtsController(engine).initialize();

            fire({ download: { voiceId: 'v1', percent: 40, status: 'Downloading' } });
            expect(playback().downloadProgress).toBe(40);
            expect(playback().isDownloading).toBe(true);
            expect(playback().downloadingVoiceId).toBe('v1');

            // A broadcast WITHOUT download info must not clobber it.
            fire({ error: { code: 'TTS_PLAYBACK_ERROR', message: 'boom' } });
            expect(playback().downloadProgress).toBe(40);
            expect(playback().lastError).toBe('boom');

            fire({ download: { voiceId: 'v1', percent: 100, status: 'Ready' } });
            expect(playback().isDownloading).toBe(false);
        });

        it('the mirror never touches the persisted settings store (echo-loop guard)', () => {
            const { engine, fire } = makeFakeEngine();
            new TtsController(engine).initialize();
            const settingsSpy = vi.fn();
            const unsub = useTTSSettingsStore.subscribe(settingsSpy);

            fire({ status: 'playing', index: 1, queue: [{ text: 'x', cfi: 'c' }] });
            fire({ status: 'paused', index: 1 });

            expect(settingsSpy).not.toHaveBeenCalled();
            unsub();
        });
    });

    describe('settings→engine sync (the engine calls that used to live in store setters)', () => {
        it('pushes rate changes as setSpeed (active language only)', () => {
            const { engine, raw } = makeFakeEngine();
            new TtsController(engine).initialize();
            raw.setSpeed.mockClear();

            settings().setRate(1.5);
            expect(raw.setSpeed).toHaveBeenCalledWith(1.5);

            raw.setSpeed.mockClear();
            settings().setRate(2.0, 'zh'); // inactive language: profile-only write
            expect(raw.setSpeed).not.toHaveBeenCalled();
        });

        it('pushes voice changes as setVoice and resolves the playback-store voice object', () => {
            useTTSPlaybackStore.setState({ voices: [VOICE_EN, VOICE_ZH] });
            const { engine, raw } = makeFakeEngine();
            new TtsController(engine).initialize();
            raw.setVoice.mockClear();

            settings().setVoiceId('v-en');
            expect(raw.setVoice).toHaveBeenCalledWith('v-en');
            expect(playback().voice).toEqual(VOICE_EN);
        });

        it('pushes language + profile rate/voice when the active language switches', () => {
            useTTSSettingsStore.setState({
                profiles: {
                    en: { voiceId: 'v-en', rate: 1, minSentenceLength: 36 },
                    zh: { voiceId: 'v-zh', rate: 1.5, minSentenceLength: 6 },
                },
            });
            useTTSPlaybackStore.setState({ voices: [VOICE_EN, VOICE_ZH] });
            const { engine, raw } = makeFakeEngine();
            new TtsController(engine).initialize();
            raw.setSpeed.mockClear();
            raw.setVoice.mockClear();

            settings().setActiveLanguage('zh');

            expect(raw.setLanguage).toHaveBeenCalledWith('zh');
            expect(raw.setSpeed).toHaveBeenCalledWith(1.5);
            expect(raw.setVoice).toHaveBeenCalledWith('v-zh');
            expect(playback().voice).toEqual(VOICE_ZH);
        });

        it('pushes preroll/background-audio/volume toggles', () => {
            const { engine, raw } = makeFakeEngine();
            new TtsController(engine).initialize();

            settings().setPrerollEnabled(true);
            expect(raw.setPrerollEnabled).toHaveBeenLastCalledWith(true);

            settings().setBackgroundAudioMode('off');
            expect(raw.setBackgroundAudioMode).toHaveBeenLastCalledWith('off');

            settings().setWhiteNoiseVolume(0.7);
            expect(raw.setBackgroundVolume).toHaveBeenLastCalledWith(0.7);
        });

        it('syncs the Bible-lexicon flag to LexiconService', () => {
            const { engine } = makeFakeEngine();
            new TtsController(engine).initialize();
            vi.mocked(LexiconService.getInstance().setGlobalBibleLexiconEnabled).mockClear();

            settings().setBibleLexiconEnabled(false);
            expect(LexiconService.getInstance().setGlobalBibleLexiconEnabled).toHaveBeenCalledWith(false);
        });

        // Regression: useTTSStore_platform 'routes the configured providerId to the engine'.
        it('a provider switch routes the id to the engine and reloads voices', async () => {
            const { engine, raw } = makeFakeEngine();
            new TtsController(engine).initialize();

            settings().setProviderId('google');

            await vi.waitFor(() => {
                expect(raw.setProviderById).toHaveBeenCalledWith('google');
                expect(raw.getVoices).toHaveBeenCalled();
            });
            expect(raw.init).toHaveBeenCalled();
        });

        // Regression: the legacy setApiKey → setProviderId(providerId) re-init chain.
        it('an API-key commit for the ACTIVE provider re-initializes it; other keys do not', async () => {
            useTTSSettingsStore.setState({ providerId: 'google' });
            const { engine, raw } = makeFakeEngine();
            new TtsController(engine).initialize();
            raw.setProviderById.mockClear();

            settings().setApiKey('openai', 'irrelevant-key');
            await new Promise((r) => setTimeout(r, 0));
            expect(raw.setProviderById).not.toHaveBeenCalled();

            settings().setApiKey('google', 'fresh-key');
            await vi.waitFor(() => expect(raw.setProviderById).toHaveBeenCalledWith('google'));
        });

        it('engine-originated mirror writes do not echo back as engine commands', () => {
            const { engine, raw, fire } = makeFakeEngine();
            new TtsController(engine).initialize();
            raw.setSpeed.mockClear();
            raw.setVoice.mockClear();
            raw.setProviderById.mockClear();

            fire({ status: 'playing', activeCfi: 'cfi-1', index: 1 });
            fire({ status: 'paused', activeCfi: 'cfi-1', index: 1 });

            expect(raw.setSpeed).not.toHaveBeenCalled();
            expect(raw.setVoice).not.toHaveBeenCalled();
            expect(raw.setProviderById).not.toHaveBeenCalled();
        });
    });

    // Regression: useTTSStore_voice_recall — the saved profile voice must survive
    // language re-application while the runtime voice list is empty, and resolve
    // once voices exist. The algorithm moved from the store to the controller in
    // the 5b split (it needs both stores).
    describe('regression: useTTSStore_voice_recall', () => {
        it('does NOT wipe the profile voiceId when voices are not loaded yet', () => {
            useTTSSettingsStore.setState({
                activeLanguage: 'zh',
                profiles: { zh: { voiceId: 'saved-voice-id', rate: 1, minSentenceLength: 6 } },
            });
            useTTSPlaybackStore.setState({ voices: [] });
            const { engine } = makeFakeEngine();
            new TtsController(engine).initialize();

            // Language re-application (e.g. the book-language sync host command).
            settings().setActiveLanguage('zh');

            expect(settings().profiles['zh'].voiceId).toBe('saved-voice-id');
        });

        it('picks a default voice when the saved id is not in the loaded list', () => {
            useTTSSettingsStore.setState({
                profiles: { en: { voiceId: 'non-existent-voice', rate: 1, minSentenceLength: 36 } },
            });
            useTTSPlaybackStore.setState({ voices: [VOICE_EN] });
            const { engine } = makeFakeEngine();
            new TtsController(engine).initialize();

            settings().setActiveLanguage('zh'); // away …
            settings().setActiveLanguage('en'); // … and back, with voices loaded

            expect(settings().profiles['en'].voiceId).toBe('v-en');
            expect(playback().voice).toEqual(VOICE_EN);
        });

        it('keeps the saved voiceId when it IS in the loaded list', () => {
            const saved = { id: 'saved-voice-id', name: 'Saved Voice', lang: 'en-US', provider: 'local' } as TTSVoice;
            useTTSSettingsStore.setState({
                activeLanguage: 'zh',
                profiles: {
                    zh: { voiceId: null, rate: 1, minSentenceLength: 6 },
                    en: { voiceId: 'saved-voice-id', rate: 1, minSentenceLength: 36 },
                },
            });
            useTTSPlaybackStore.setState({ voices: [saved, VOICE_EN] });
            const { engine } = makeFakeEngine();
            new TtsController(engine).initialize();

            settings().setActiveLanguage('en');

            expect(settings().profiles['en'].voiceId).toBe('saved-voice-id');
            expect(playback().voice).toEqual(saved);
        });
    });

    describe('voice management commands', () => {
        // Regression: useTTSStore_platform 'loadVoices re-applies the current providerId'.
        it('loadVoices re-applies the current providerId, inits, and stores the voice list', async () => {
            const { engine, raw, setVoices } = makeFakeEngine();
            setVoices([VOICE_EN, VOICE_ZH]);
            const controller = new TtsController(engine);

            await controller.loadVoices();

            expect(raw.setProviderById).toHaveBeenCalledWith('webspeech');
            expect(raw.init).toHaveBeenCalled();
            expect(playback().voices).toEqual([VOICE_EN, VOICE_ZH]);
        });

        it('loadVoices picks the active-language voice and records it in the profile', async () => {
            const { engine, raw, setVoices } = makeFakeEngine();
            setVoices([VOICE_ZH, VOICE_EN]);
            const controller = new TtsController(engine);

            await controller.loadVoices();

            expect(playback().voice).toEqual(VOICE_EN);
            expect(settings().profiles['en'].voiceId).toBe('v-en');
            expect(raw.setVoice).toHaveBeenCalledWith('v-en');
        });

        it('loadVoices prefers the saved profile voice when it exists in the list', async () => {
            useTTSSettingsStore.setState({
                profiles: { en: { voiceId: 'v-en', rate: 1, minSentenceLength: 36 } },
            });
            const second = { id: 'v-en-2', name: 'Other English', lang: 'en-GB', provider: 'local' } as TTSVoice;
            const { engine, setVoices } = makeFakeEngine();
            setVoices([second, VOICE_EN]);

            await new TtsController(engine).loadVoices();

            expect(playback().voice?.id).toBe('v-en');
        });

        it('downloadVoice tracks progress state and surfaces failures', async () => {
            const { engine, raw } = makeFakeEngine();
            const controller = new TtsController(engine);

            await controller.downloadVoice('v-piper');
            expect(raw.downloadVoice).toHaveBeenCalledWith('v-piper');
            expect(playback().downloadStatus).toBe('Ready');
            expect(playback().downloadProgress).toBe(100);

            raw.downloadVoice.mockRejectedValueOnce(new Error('offline'));
            await controller.downloadVoice('v-piper');
            expect(playback().downloadStatus).toBe('Failed');
            expect(playback().lastError).toBe('offline');
            expect(playback().isDownloading).toBe(false);
        });

        it('deleteVoice resets the download state', async () => {
            useTTSPlaybackStore.setState({ isDownloading: true, downloadProgress: 80, downloadStatus: 'Downloading', downloadingVoiceId: 'v-piper' });
            const { engine, raw } = makeFakeEngine();

            await new TtsController(engine).deleteVoice('v-piper');

            expect(raw.deleteVoice).toHaveBeenCalledWith('v-piper');
            expect(playback()).toMatchObject({
                isDownloading: false,
                downloadProgress: 0,
                downloadStatus: 'Not Downloaded',
                downloadingVoiceId: null,
            });
        });
    });

    describe('playback + navigation commands route to the engine', () => {
        it('forwards the simple commands', () => {
            const { engine, raw } = makeFakeEngine();
            const c = new TtsController(engine);

            c.play(); expect(raw.play).toHaveBeenCalled();
            c.pause(); expect(raw.pause).toHaveBeenCalled();
            c.stop(); expect(raw.stop).toHaveBeenCalled();
            c.jumpTo(3); expect(raw.jumpTo).toHaveBeenCalledWith(3);
            c.seek(-15); expect(raw.seek).toHaveBeenCalledWith(-15);
            c.preview('hello'); expect(raw.preview).toHaveBeenCalledWith('hello');
            c.setBookId('book-1'); expect(raw.setBookId).toHaveBeenCalledWith('book-1');
            c.loadSectionBySectionId('sec-1', false, 'Title');
            expect(raw.loadSectionBySectionId).toHaveBeenCalledWith('sec-1', false, 'Title');
        });

        it('commands stay bound when destructured (useAudioCommands contract)', async () => {
            const { engine, raw } = makeFakeEngine();
            const { play, skipToNextSection } = new TtsController(engine);

            play();
            await expect(skipToNextSection()).resolves.toBe(true);
            expect(raw.play).toHaveBeenCalled();
            expect(raw.skipToNextSection).toHaveBeenCalled();
        });
    });
});

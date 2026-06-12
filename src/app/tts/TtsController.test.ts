/**
 * TtsController unit tests (Phase 5b-PR1) — the command facade between the UI,
 * the pure `useTTSStore`, and the engine.
 *
 * The engine is INJECTED as a fake (no module mock of the composition root):
 * the controller is the only production `getAudioPlayer()` consumer, and these
 * tests pin the three responsibilities it absorbed from the store:
 *   1. the engine→store playback mirror (incl. the loading/completed-as-playing
 *      flicker derivation, regression: useTTSStore initialize),
 *   2. the store→engine settings sync that used to live inside store setters,
 *   3. the engine command sequences (loadVoices/downloadVoice/…).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PlaybackListener, TtsEngine } from '@lib/tts/AudioPlayerService';
import type { TTSVoice } from '@lib/tts/providers/types';
import { useTTSStore } from '@store/useTTSStore';
import { TtsController } from './TtsController';
import { LexiconService } from '@lib/tts/LexiconService';

vi.mock('@lib/tts/LexiconService', () => {
    const instance = { setGlobalBibleLexiconEnabled: vi.fn() };
    return { LexiconService: { getInstance: vi.fn(() => instance) } };
});

function makeFakeEngine() {
    let listener: PlaybackListener | undefined;
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
        subscribe: vi.fn((l: PlaybackListener) => { listener = l; return () => { listener = undefined; }; }),
        setBookId: vi.fn(),
        clearPauseGesture: vi.fn(),
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
    return {
        engine: engine as unknown as TtsEngine,
        raw: engine,
        fire: (...args: Parameters<PlaybackListener>) => listener?.(...args),
        setVoices: (v: TTSVoice[]) => { voices.length = 0; voices.push(...v); },
    };
}

const VOICE_EN = { id: 'v-en', name: 'English Voice', lang: 'en-US', provider: 'local' } as TTSVoice;
const VOICE_ZH = { id: 'v-zh', name: 'Chinese Voice', lang: 'zh-CN', provider: 'local' } as TTSVoice;

describe('TtsController', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useTTSStore.setState({
            isPlaying: false,
            engineReady: false,
            status: 'stopped',
            activeLanguage: 'en',
            profiles: { en: { voiceId: null, rate: 1, pitch: 1, volume: 1 } },
            rate: 1,
            pitch: 1,
            voice: null,
            voices: [],
            providerId: 'local',
            apiKeys: { google: '', openai: '', lemonfox: '' },
            prerollEnabled: false,
            backgroundAudioMode: 'silence',
            whiteNoiseVolume: 0.1,
            isBibleLexiconEnabled: true,
            isDownloading: false,
            downloadProgress: 0,
            downloadStatus: null,
            downloadingVoiceId: null,
            lastError: null,
        });
    });

    describe('initialize: rehydrated-settings replay (the old onRehydrateStorage side effects)', () => {
        it('pushes persisted background/preroll/speed/voice settings and syncs the lexicon flag', () => {
            useTTSStore.setState({
                backgroundAudioMode: 'noise',
                whiteNoiseVolume: 0.4,
                prerollEnabled: true,
                rate: 1.5,
                voice: VOICE_EN,
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
            await vi.waitFor(() => expect(useTTSStore.getState().engineReady).toBe(true));
        });

        it('is idempotent: a second initialize() does not double-subscribe', () => {
            const { engine, raw } = makeFakeEngine();
            const controller = new TtsController(engine);
            controller.initialize();
            controller.initialize();
            expect(raw.subscribe).toHaveBeenCalledTimes(1);
        });
    });

    // Regression: the engine→store mirror previously wired by useTTSStore.initialize().
    describe('regression: useTTSStore initialize (engine→store mirror)', () => {
        it('mirrors engine broadcasts, deriving isPlaying for loading/completed (flicker guard)', () => {
            const { engine, fire } = makeFakeEngine();
            new TtsController(engine).initialize();

            fire('playing', 'cfi-1', 2, [], null);
            expect(useTTSStore.getState().isPlaying).toBe(true);
            expect(useTTSStore.getState().status).toBe('playing');
            expect(useTTSStore.getState().activeCfi).toBe('cfi-1');
            expect(useTTSStore.getState().currentIndex).toBe(2);

            fire('paused', null, 0, [], null);
            expect(useTTSStore.getState().isPlaying).toBe(false);
            expect(useTTSStore.getState().status).toBe('paused');

            // 'loading' must read as playing (prevents play/pause button flicker).
            fire('loading', null, 0, [], null);
            expect(useTTSStore.getState().isPlaying).toBe(true);

            // 'completed' must read as playing (keeps background audio + UI active).
            fire('completed', null, 0, [], null);
            expect(useTTSStore.getState().isPlaying).toBe(true);

            fire('stopped', null, 0, [], null);
            expect(useTTSStore.getState().isPlaying).toBe(false);
        });

        it('merges download info only when present (error broadcasts keep download state)', () => {
            const { engine, fire } = makeFakeEngine();
            new TtsController(engine).initialize();

            fire('stopped', null, 0, [], null, { voiceId: 'v1', percent: 40, status: 'Downloading' });
            expect(useTTSStore.getState().downloadProgress).toBe(40);
            expect(useTTSStore.getState().isDownloading).toBe(true);
            expect(useTTSStore.getState().downloadingVoiceId).toBe('v1');

            // A broadcast WITHOUT download info must not clobber it.
            fire('stopped', null, 0, [], 'boom');
            expect(useTTSStore.getState().downloadProgress).toBe(40);
            expect(useTTSStore.getState().lastError).toBe('boom');

            fire('stopped', null, 0, [], null, { voiceId: 'v1', percent: 100, status: 'Ready' });
            expect(useTTSStore.getState().isDownloading).toBe(false);
        });
    });

    describe('store→engine settings sync (the engine calls that used to live in store setters)', () => {
        it('pushes rate changes as setSpeed (active language only)', () => {
            const { engine, raw } = makeFakeEngine();
            new TtsController(engine).initialize();
            raw.setSpeed.mockClear();

            useTTSStore.getState().setRate(1.5);
            expect(raw.setSpeed).toHaveBeenCalledWith(1.5);

            raw.setSpeed.mockClear();
            useTTSStore.getState().setRate(2.0, 'zh'); // inactive language: profile-only write
            expect(raw.setSpeed).not.toHaveBeenCalled();
        });

        it('pushes voice changes as setVoice', () => {
            const { engine, raw } = makeFakeEngine();
            new TtsController(engine).initialize();
            raw.setVoice.mockClear();

            useTTSStore.getState().setVoice(VOICE_EN);
            expect(raw.setVoice).toHaveBeenCalledWith('v-en');
        });

        it('pushes language + profile rate/voice when the active language switches', () => {
            useTTSStore.setState({
                profiles: {
                    en: { voiceId: 'v-en', rate: 1, pitch: 1, volume: 1 },
                    zh: { voiceId: 'v-zh', rate: 1.5, pitch: 1, volume: 1 },
                },
                voices: [VOICE_EN, VOICE_ZH],
            });
            const { engine, raw } = makeFakeEngine();
            new TtsController(engine).initialize();
            raw.setSpeed.mockClear();
            raw.setVoice.mockClear();

            useTTSStore.getState().setActiveLanguage('zh');

            expect(raw.setLanguage).toHaveBeenCalledWith('zh');
            expect(raw.setSpeed).toHaveBeenCalledWith(1.5);
            expect(raw.setVoice).toHaveBeenCalledWith('v-zh');
        });

        it('pushes preroll/background-audio/volume toggles', () => {
            const { engine, raw } = makeFakeEngine();
            new TtsController(engine).initialize();

            useTTSStore.getState().setPrerollEnabled(true);
            expect(raw.setPrerollEnabled).toHaveBeenLastCalledWith(true);

            useTTSStore.getState().setBackgroundAudioMode('off');
            expect(raw.setBackgroundAudioMode).toHaveBeenLastCalledWith('off');

            useTTSStore.getState().setWhiteNoiseVolume(0.7);
            expect(raw.setBackgroundVolume).toHaveBeenLastCalledWith(0.7);
        });

        it('syncs the Bible-lexicon flag to LexiconService', () => {
            const { engine } = makeFakeEngine();
            new TtsController(engine).initialize();
            vi.mocked(LexiconService.getInstance().setGlobalBibleLexiconEnabled).mockClear();

            useTTSStore.getState().setBibleLexiconEnabled(false);
            expect(LexiconService.getInstance().setGlobalBibleLexiconEnabled).toHaveBeenCalledWith(false);
        });

        // Regression: useTTSStore_platform 'routes the configured providerId to the engine'.
        it('a provider switch routes the id to the engine and reloads voices', async () => {
            const { engine, raw } = makeFakeEngine();
            new TtsController(engine).initialize();

            useTTSStore.getState().setProviderId('google');

            await vi.waitFor(() => {
                expect(raw.setProviderById).toHaveBeenCalledWith('google');
                expect(raw.getVoices).toHaveBeenCalled();
            });
            expect(raw.init).toHaveBeenCalled();
        });

        // Regression: the legacy setApiKey → setProviderId(providerId) re-init chain.
        it('an API-key commit for the ACTIVE provider re-initializes it; other keys do not', async () => {
            useTTSStore.setState({ providerId: 'google' });
            const { engine, raw } = makeFakeEngine();
            new TtsController(engine).initialize();
            raw.setProviderById.mockClear();

            useTTSStore.getState().setApiKey('openai', 'irrelevant-key');
            await new Promise((r) => setTimeout(r, 0));
            expect(raw.setProviderById).not.toHaveBeenCalled();

            useTTSStore.getState().setApiKey('google', 'fresh-key');
            await vi.waitFor(() => expect(raw.setProviderById).toHaveBeenCalledWith('google'));
        });

        it('engine-originated mirror writes do not echo back as engine commands', () => {
            const { engine, raw, fire } = makeFakeEngine();
            new TtsController(engine).initialize();
            raw.setSpeed.mockClear();
            raw.setVoice.mockClear();
            raw.setProviderById.mockClear();

            fire('playing', 'cfi-1', 1, [], null);
            fire('paused', 'cfi-1', 1, [], null);

            expect(raw.setSpeed).not.toHaveBeenCalled();
            expect(raw.setVoice).not.toHaveBeenCalled();
            expect(raw.setProviderById).not.toHaveBeenCalled();
        });
    });

    describe('voice management commands', () => {
        // Regression: useTTSStore_platform 'loadVoices re-applies the current providerId'.
        it('loadVoices re-applies the current providerId, inits, and stores the voice list', async () => {
            const { engine, raw, setVoices } = makeFakeEngine();
            setVoices([VOICE_EN, VOICE_ZH]);
            const controller = new TtsController(engine);

            await controller.loadVoices();

            expect(raw.setProviderById).toHaveBeenCalledWith('local');
            expect(raw.init).toHaveBeenCalled();
            expect(useTTSStore.getState().voices).toEqual([VOICE_EN, VOICE_ZH]);
        });

        it('loadVoices picks the active-language voice and records it in the profile', async () => {
            const { engine, raw, setVoices } = makeFakeEngine();
            setVoices([VOICE_ZH, VOICE_EN]);
            const controller = new TtsController(engine);

            await controller.loadVoices();

            expect(useTTSStore.getState().voice).toEqual(VOICE_EN);
            expect(useTTSStore.getState().profiles['en'].voiceId).toBe('v-en');
            expect(raw.setVoice).toHaveBeenCalledWith('v-en');
        });

        it('loadVoices prefers the saved profile voice when it exists in the list', async () => {
            useTTSStore.setState({
                profiles: { en: { voiceId: 'v-en', rate: 1, pitch: 1, volume: 1 } },
            });
            const second = { id: 'v-en-2', name: 'Other English', lang: 'en-GB', provider: 'local' } as TTSVoice;
            const { engine, setVoices } = makeFakeEngine();
            setVoices([second, VOICE_EN]);

            await new TtsController(engine).loadVoices();

            expect(useTTSStore.getState().voice?.id).toBe('v-en');
        });

        it('downloadVoice tracks progress state and surfaces failures', async () => {
            const { engine, raw } = makeFakeEngine();
            const controller = new TtsController(engine);

            await controller.downloadVoice('v-piper');
            expect(raw.downloadVoice).toHaveBeenCalledWith('v-piper');
            expect(useTTSStore.getState().downloadStatus).toBe('Ready');
            expect(useTTSStore.getState().downloadProgress).toBe(100);

            raw.downloadVoice.mockRejectedValueOnce(new Error('offline'));
            await controller.downloadVoice('v-piper');
            expect(useTTSStore.getState().downloadStatus).toBe('Failed');
            expect(useTTSStore.getState().lastError).toBe('offline');
            expect(useTTSStore.getState().isDownloading).toBe(false);
        });

        it('deleteVoice resets the download state', async () => {
            useTTSStore.setState({ isDownloading: true, downloadProgress: 80, downloadStatus: 'Downloading', downloadingVoiceId: 'v-piper' });
            const { engine, raw } = makeFakeEngine();

            await new TtsController(engine).deleteVoice('v-piper');

            expect(raw.deleteVoice).toHaveBeenCalledWith('v-piper');
            expect(useTTSStore.getState()).toMatchObject({
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
            c.clearPauseGesture(); expect(raw.clearPauseGesture).toHaveBeenCalled();
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

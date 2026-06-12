import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { TTSVoice } from '@lib/tts/providers/types';
import type { TTSProviderId, TTSApiKeyProviderId } from '@lib/tts/providers/registry';
import { getAudioPlayer } from '@app/tts/mainThreadAudioPlayer';
import type { TTSStatus, TTSQueueItem } from '@lib/tts/AudioPlayerService';
import { DEFAULT_ALWAYS_MERGE, DEFAULT_SENTENCE_STARTERS } from '@lib/tts/TextSegmenter';
import { LexiconService } from '@lib/tts/LexiconService';
import { normalizeLanguageCode } from '@lib/language-utils';

export interface TTSProfile {
    voiceId: string | null;
    rate: number;
    pitch: number;
    volume: number;
    minSentenceLength?: number;
}

export const getDefaultMinSentenceLength = (lang: string): number => lang.startsWith('zh') ? 6 : 36;

/**
 * State interface for the Text-to-Speech (TTS) store.
 */
interface TTSState {
    /** Active language for TTS profile selection. */
    activeLanguage: string;
    /** Per-language TTS profiles. */
    profiles: Record<string, TTSProfile>;

    /** Flag indicating if TTS is currently playing. */
    isPlaying: boolean;
    /** Whether the engine is ready to accept commands (worker booted + subscribed). */
    engineReady: boolean;
    /** Current status of playback. */
    status: TTSStatus;
    /** Speech rate (speed). Default is 1.0. */
    rate: number;
    /** Speech pitch. Default is 1.0. */
    pitch: number;
    /** The selected voice for speech synthesis. */
    voice: TTSVoice | null;
    /** List of available voices */
    voices: TTSVoice[];
    /** The CFI of the currently spoken sentence or segment. */
    activeCfi: string | null;
    /** Current index in the playback queue */
    currentIndex: number;
    /** The playback queue */
    queue: readonly TTSQueueItem[];
    /** The last error message, if any */
    lastError: string | null;

    /** Download State (for Piper) */
    downloadProgress: number;
    downloadStatus: string | null;
    downloadingVoiceId: string | null;
    isDownloading: boolean;

    /** Provider configuration (id union derives from the provider registry). */
    providerId: TTSProviderId;
    apiKeys: Record<TTSApiKeyProviderId, string>;

    /** Custom abbreviations for sentence segmentation */
    customAbbreviations: string[];
    /** Words that should always trigger a merge (e.g. "Mr.") */
    alwaysMerge: string[];
    /** Words that indicate a new sentence start (preventing merge) */
    sentenceStarters: string[];
    /** Minimum sentence length (in characters) to enforce by merging short sentences */
    minSentenceLength: number;

    /** Whether to show cost warning dialogs */
    enableCostWarning: boolean;

    /** Whether to enable chapter pre-roll announcements */
    prerollEnabled: boolean;

    /** Whether to enable text sanitization (remove URLs, page numbers, etc.) */
    sanitizationEnabled: boolean;

    /** Whether to enable Bible abbreviations and lexicon globally. */
    isBibleLexiconEnabled: boolean;

    /** Local Provider Settings */
    backgroundAudioMode: 'silence' | 'noise' | 'off';
    whiteNoiseVolume: number;

    /** Actions */
    setBackgroundAudioMode: (mode: 'silence' | 'noise' | 'off') => void;
    setWhiteNoiseVolume: (volume: number) => void;
    play: () => void;
    pause: () => void;
    stop: () => void;
    setRate: (rate: number, lang?: string) => void;
    setPitch: (pitch: number, lang?: string) => void;
    setVoice: (voice: TTSVoice | null, lang?: string) => void;
    setProviderId: (id: TTSProviderId) => void;
    setApiKey: (provider: TTSApiKeyProviderId, key: string) => void;
    setCustomAbbreviations: (abbrevs: string[]) => void;
    setAlwaysMerge: (words: string[]) => void;
    setSentenceStarters: (words: string[]) => void;
    setMinSentenceLength: (length: number, lang?: string) => void;
    setEnableCostWarning: (enable: boolean) => void;
    setPrerollEnabled: (enable: boolean) => void;
    setSanitizationEnabled: (enable: boolean) => void;
    setBibleLexiconEnabled: (enable: boolean) => void;

    setActiveLanguage: (lang: string) => void;

    loadVoices: () => Promise<void>;
    downloadVoice: (voiceId: string) => Promise<void>;
    deleteVoice: (voiceId: string) => Promise<void>;
    checkVoiceDownloaded: (voiceId: string) => Promise<boolean>;
    jumpTo: (index: number) => void;
    seek: (seconds: number) => void;
    clearError: () => void;
    /**
     * Initializes the store subscription to the audio player.
     * Should be called once at app startup.
     */
    initialize: () => void;
}

/**
 * Zustand store for managing Text-to-Speech configuration and playback state.
 */
export const useTTSStore = create<TTSState>()(
    persist(
        (set, get) => {
            return {
                isPlaying: false,
                engineReady: false,
                status: 'stopped',
                rate: 1.0,
                pitch: 1.0,
                voice: null,
                voices: [],
                activeCfi: null,
                currentIndex: 0,
                queue: [],
                lastError: null,
                downloadProgress: 0,
                downloadStatus: null,
                downloadingVoiceId: null,
                isDownloading: false,
                providerId: 'local',
                apiKeys: {
                    google: '',
                    openai: '',
                    lemonfox: ''
                },
                enableCostWarning: true,
                prerollEnabled: false,
                sanitizationEnabled: true,
                isBibleLexiconEnabled: true, // Default to true
                backgroundAudioMode: 'silence',
                whiteNoiseVolume: 0.1,

                activeLanguage: 'en',
                profiles: {
                    en: { voiceId: null, rate: 1.0, pitch: 1.0, volume: 1.0, minSentenceLength: 36 },
                },

                setActiveLanguage: (rawLang) => {
                    const lang = normalizeLanguageCode(rawLang);
                    const state = get();
                    // When we change the language context, we also update the active properties
                    // and fetch the voice objects for the underlying service
                    const profile = state.profiles[lang] || { voiceId: null, rate: 1.0, pitch: 1.0, volume: 1.0, minSentenceLength: getDefaultMinSentenceLength(lang) };
                    
                    // Filter voices for this language
                    const languageVoices = state.voices.filter(v => v.lang.startsWith(lang));
                    
                    let selectedVoice = languageVoices.find(v => v.id === profile.voiceId) || null;
                    
                    if (!selectedVoice && languageVoices.length > 0) {
                        // Pick a default matching voice if the profile one is missing
                        selectedVoice = languageVoices[0];
                    }

                    // Use the newly selected voice ID if we found one, 
                    // otherwise RETAIN the existing profile voiceId if we don't have voices loaded yet.
                    const finalVoiceId = selectedVoice ? selectedVoice.id : profile.voiceId;

                    if (languageVoices.length === 0 && state.voices.length > 0) {
                        // Warn user if no voices for this language
                        import('./useToastStore').then(({ useToastStore }) => {
                            useToastStore.getState().showToast(`No voices found for ${lang}. Audio playback may not work.`, 'error');
                        });
                    }

                    set((s) => ({
                        activeLanguage: lang,
                        rate: profile.rate,
                        pitch: profile.pitch,
                        voice: selectedVoice,
                        minSentenceLength: profile.minSentenceLength ?? getDefaultMinSentenceLength(lang),
                        profiles: {
                            ...s.profiles,
                            [lang]: {
                                ...profile,
                                voiceId: finalVoiceId
                            }
                        }
                    }));

                    // Update the single active audio player properties
                    const player = getAudioPlayer();
                    player.setSpeed(profile.rate);
                    player.setLanguage(lang);
                    if (selectedVoice) {
                        player.setVoice(selectedVoice.id);
                    }
                },

                customAbbreviations: [
                    'Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.', 'Gen.', 'Rep.', 'Sen.', 'St.', 'vs.', 'Jr.', 'Sr.',
                    'e.g.', 'i.e.'
                ],
                alwaysMerge: DEFAULT_ALWAYS_MERGE,
                sentenceStarters: DEFAULT_SENTENCE_STARTERS,
                minSentenceLength: 36,

                initialize: () => {
                    const player = getAudioPlayer();
                    // Engine readiness: in-process resolves immediately; the worker handle
                    // resolves once the worker has booted and subscribed. UI can gate on this.
                    void player.whenReady().then(() => set({ engineReady: true }));
                    // Subscribe to player updates
                    player.subscribe((status, activeCfi, currentIndex, queue, error, downloadInfo) => {
                        set(() => ({
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
                        }));
                    });
                },

                play: () => {
                    getAudioPlayer().play();
                },
                pause: () => {
                    getAudioPlayer().pause();
                },
                stop: () => {
                    getAudioPlayer().stop();
                },
                setRate: (rate, lang?: string) => {
                    const targetLang = lang || get().activeLanguage;
                    const isActive = targetLang === get().activeLanguage;
                    
                    if (isActive) {
                        getAudioPlayer().setSpeed(rate);
                    }

                    set((state) => ({
                        ...(isActive ? { rate } : {}),
                        profiles: {
                            ...state.profiles,
                            [targetLang]: { ...(state.profiles[targetLang] || { voiceId: state.voice?.id || null, rate: 1.0, pitch: 1.0, volume: 1.0 }), rate }
                        }
                    }));
                },
                setPitch: (pitch, lang?: string) => {
                    const targetLang = lang || get().activeLanguage;
                    const isActive = targetLang === get().activeLanguage;

                    set((state) => ({
                        ...(isActive ? { pitch } : {}),
                        profiles: {
                            ...state.profiles,
                            [targetLang]: { ...(state.profiles[targetLang] || { voiceId: state.voice?.id || null, rate: 1.0, pitch: 1.0, volume: 1.0 }), pitch }
                        }
                    }));
                },
                setVoice: (voice, lang?: string) => {
                    const targetLang = lang || get().activeLanguage;
                    const isActive = targetLang === get().activeLanguage;

                    if (isActive && voice) {
                        getAudioPlayer().setVoice(voice.id);
                    }

                    set((state) => ({
                        ...(isActive ? { voice } : {}),
                        profiles: {
                            ...state.profiles,
                            [targetLang]: { ...(state.profiles[targetLang] || { voiceId: null, rate: state.rate, pitch: state.pitch, volume: 1.0 }), voiceId: voice?.id || null }
                        }
                    }));
                },
                setProviderId: (id) => {
                    set({ providerId: id });
                    // Reload voices for new provider (this will re-init the provider)
                    get().loadVoices();
                },
                setApiKey: (provider, key) => {
                    set((state) => ({
                        apiKeys: { ...state.apiKeys, [provider]: key }
                    }));
                    // Update current provider if it matches
                    const { providerId } = get();
                    if (providerId === provider) {
                        // Force re-init of provider
                        get().setProviderId(providerId);
                    }
                },
                setCustomAbbreviations: (abbrevs) => {
                    set({ customAbbreviations: abbrevs });
                },
                setAlwaysMerge: (words) => {
                    set({ alwaysMerge: words });
                },
                setSentenceStarters: (words) => {
                    set({ sentenceStarters: words });
                },
                setMinSentenceLength: (length, lang?: string) => {
                    const targetLang = lang || get().activeLanguage;
                    const isActive = targetLang === get().activeLanguage;

                    set((state) => ({
                        ...(isActive ? { minSentenceLength: length } : {}),
                        profiles: {
                            ...state.profiles,
                            [targetLang]: {
                                ...(state.profiles[targetLang] || { voiceId: state.voice?.id || null, rate: 1.0, pitch: 1.0, volume: 1.0 }),
                                minSentenceLength: length
                            }
                        }
                    }));
                },
                setEnableCostWarning: (enable) => {
                    set({ enableCostWarning: enable });
                },
                setPrerollEnabled: (enable) => {
                    getAudioPlayer().setPrerollEnabled(enable);
                    set({ prerollEnabled: enable });
                },
                setSanitizationEnabled: (enable) => {
                    set({ sanitizationEnabled: enable });
                },
                setBibleLexiconEnabled: (enable) => {
                    set({ isBibleLexiconEnabled: enable });
                    LexiconService.getInstance().setGlobalBibleLexiconEnabled(enable);
                },
                setBackgroundAudioMode: (mode) => {
                    set({ backgroundAudioMode: mode });
                    getAudioPlayer().setBackgroundAudioMode(mode);
                },
                setWhiteNoiseVolume: (volume) => {
                    set({ whiteNoiseVolume: volume });
                    getAudioPlayer().setBackgroundVolume(volume);
                },
                loadVoices: async () => {
                    const player = getAudioPlayer();
                    // Ensure provider is set on player (in case of fresh load). The id is plain
                    // data on both engine paths; the main-thread backend constructs the live
                    // provider (with API keys + active language) via the shared factory.
                    const { providerId } = get();
                    await player.setProviderById(providerId);

                    await player.init();
                    const voices = await player.getVoices();
                    set({ voices });

                    // If current voice is not in new list, pick default
                    const currentVoice = get().voice;
                    const activeLang = get().activeLanguage;
                    const profileVoiceId = get().profiles[activeLang]?.voiceId;

                    let targetVoice = null;

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
                        // Re-set voice to ensure player knows about it
                        player.setVoice(targetVoice.id);
                        set({ voice: targetVoice });
                    }
                },
                downloadVoice: async (voiceId) => {
                    const player = getAudioPlayer();
                    try {
                        set({ isDownloading: true, downloadingVoiceId: voiceId, downloadStatus: 'Starting...' });
                        await player.downloadVoice(voiceId);
                        set({ isDownloading: false, downloadStatus: 'Ready', downloadProgress: 100 });
                    } catch (e) {
                        set({ isDownloading: false, downloadStatus: 'Failed', lastError: e instanceof Error ? e.message : 'Download failed' });
                    }
                },
                deleteVoice: async (voiceId) => {
                    const player = getAudioPlayer();
                    await player.deleteVoice(voiceId);
                    set({ isDownloading: false, downloadProgress: 0, downloadStatus: 'Not Downloaded', downloadingVoiceId: null });
                },
                checkVoiceDownloaded: async (voiceId) => {
                    return await getAudioPlayer().isVoiceDownloaded(voiceId);
                },
                jumpTo: (index) => {
                    getAudioPlayer().jumpTo(index);
                },
                seek: (seconds) => {
                    getAudioPlayer().seek(seconds);
                },
                clearError: () => {
                    set({ lastError: null });
                },
            };
        },
        {
            name: 'tts-storage',
            version: 3,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            migrate: (persistedState: any, version: number) => {
                if (version < 2) {
                    // Migrate flat fields into profiles
                    persistedState.activeLanguage = 'en';
                    persistedState.profiles = {
                        en: {
                            voiceId: persistedState.voice?.id || null,
                            rate: persistedState.rate || 1.0,
                            pitch: persistedState.pitch || 1.0,
                            volume: 1.0,
                            minSentenceLength: persistedState.minSentenceLength ?? getDefaultMinSentenceLength('en'),
                        }
                    };
                }
                if (version < 3) {
                    if (persistedState.profiles) {
                        for (const lang in persistedState.profiles) {
                            if (persistedState.profiles[lang].minSentenceLength === undefined) {
                                persistedState.profiles[lang].minSentenceLength = persistedState.minSentenceLength ?? getDefaultMinSentenceLength(lang);
                            }
                        }
                    }
                }
                return persistedState;
            },
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                activeLanguage: state.activeLanguage,
                profiles: state.profiles,
                rate: state.rate,
                pitch: state.pitch,
                voice: state.voice,
                providerId: state.providerId,
                apiKeys: state.apiKeys,
                customAbbreviations: state.customAbbreviations,
                alwaysMerge: state.alwaysMerge,
                sentenceStarters: state.sentenceStarters,
                minSentenceLength: state.minSentenceLength,
                enableCostWarning: state.enableCostWarning,
                prerollEnabled: state.prerollEnabled,
                sanitizationEnabled: state.sanitizationEnabled,
                isBibleLexiconEnabled: state.isBibleLexiconEnabled,
                backgroundAudioMode: state.backgroundAudioMode,
                whiteNoiseVolume: state.whiteNoiseVolume,
            }),
            onRehydrateStorage: () => (state) => {
                if (state) {
                    // Ensure active profile exists on rehydration if missing
                    if (!state.profiles) {
                        state.profiles = { en: { voiceId: null, rate: 1.0, pitch: 1.0, volume: 1.0 } };
                        state.activeLanguage = 'en';
                    }

                    const player = getAudioPlayer();
                    player.setBackgroundAudioMode(state.backgroundAudioMode);
                    player.setBackgroundVolume(state.whiteNoiseVolume);
                    player.setPrerollEnabled(state.prerollEnabled);
                    player.setSpeed(state.rate);
                    if (state.voice) {
                        player.setVoice(state.voice.id);
                    }
                    // Sync lexicon state
                    LexiconService.getInstance().setGlobalBibleLexiconEnabled(state.isBibleLexiconEnabled);
                }
            },
        }
    )
);

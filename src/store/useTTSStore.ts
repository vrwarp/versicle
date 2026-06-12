import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { TTSVoice } from '@lib/tts/providers/types';
import type { TTSProviderId, TTSApiKeyProviderId } from '@lib/tts/providers/registry';
import type { TTSStatus, TTSQueueItem } from '@lib/tts/AudioPlayerService';
import { DEFAULT_ALWAYS_MERGE, DEFAULT_SENTENCE_STARTERS } from '@lib/tts/TextSegmenter';
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
 *
 * Since Phase 5b-PR1 every action here is a PURE STATE WRITE: engine commands
 * (play/pause/voice loading/section navigation/…) live on the TtsController
 * facade (src/app/tts/TtsController.ts), which also owns the engine→store
 * mirror subscription and the store→engine settings synchronization. UI
 * components issue commands via the useAudioCommands() hook and READ state
 * from this store.
 */
interface TTSState {
    /** Active language for TTS profile selection. */
    activeLanguage: string;
    /** Per-language TTS profiles. */
    profiles: Record<string, TTSProfile>;

    /** Flag indicating if TTS is currently playing (engine mirror). */
    isPlaying: boolean;
    /** Whether the engine is ready to accept commands (worker booted + subscribed). */
    engineReady: boolean;
    /** Current status of playback (engine mirror). */
    status: TTSStatus;
    /** Speech rate (speed). Default is 1.0. */
    rate: number;
    /** Speech pitch. Default is 1.0. */
    pitch: number;
    /** The selected voice for speech synthesis. */
    voice: TTSVoice | null;
    /** List of available voices (loaded by TtsController.loadVoices). */
    voices: TTSVoice[];
    /** The CFI of the currently spoken sentence or segment (engine mirror). */
    activeCfi: string | null;
    /** Current index in the playback queue (engine mirror). */
    currentIndex: number;
    /** The playback queue (engine mirror). */
    queue: readonly TTSQueueItem[];
    /** The last error message, if any (engine mirror). */
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

    /** Actions (pure state writes — see module docstring). */
    setBackgroundAudioMode: (mode: 'silence' | 'noise' | 'off') => void;
    setWhiteNoiseVolume: (volume: number) => void;
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

    clearError: () => void;
}

/**
 * Zustand store for managing Text-to-Speech configuration and the mirrored
 * playback state. Engine commands do NOT live here (Phase 5b-PR1) — see
 * src/app/tts/TtsController.ts.
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
                    // When we change the language context, we also update the active properties.
                    // The TtsController pushes the resulting rate/voice/language to the engine.
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
                },

                customAbbreviations: [
                    'Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.', 'Gen.', 'Rep.', 'Sen.', 'St.', 'vs.', 'Jr.', 'Sr.',
                    'e.g.', 'i.e.'
                ],
                alwaysMerge: DEFAULT_ALWAYS_MERGE,
                sentenceStarters: DEFAULT_SENTENCE_STARTERS,
                minSentenceLength: 36,

                setRate: (rate, lang?: string) => {
                    const targetLang = lang || get().activeLanguage;
                    const isActive = targetLang === get().activeLanguage;

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
                },
                setApiKey: (provider, key) => {
                    set((state) => ({
                        apiKeys: { ...state.apiKeys, [provider]: key }
                    }));
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
                    set({ prerollEnabled: enable });
                },
                setSanitizationEnabled: (enable) => {
                    set({ sanitizationEnabled: enable });
                },
                setBibleLexiconEnabled: (enable) => {
                    set({ isBibleLexiconEnabled: enable });
                },
                setBackgroundAudioMode: (mode) => {
                    set({ backgroundAudioMode: mode });
                },
                setWhiteNoiseVolume: (volume) => {
                    set({ whiteNoiseVolume: volume });
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
                    // Ensure active profile exists on rehydration if missing.
                    // Engine + LexiconService side effects that used to run here moved
                    // to TtsController.initialize() (the tts/initialize boot task) —
                    // rehydration is now a pure state concern (R9 complete).
                    if (!state.profiles) {
                        state.profiles = { en: { voiceId: null, rate: 1.0, pitch: 1.0, volume: 1.0 } };
                        state.activeLanguage = 'en';
                    }
                }
            },
        }
    )
);

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Capacitor } from '@capacitor/core';
import type { TTSProviderId, TTSApiKeyProviderId } from '@lib/tts/providers/registry';
import { DEFAULT_ALWAYS_MERGE, DEFAULT_SENTENCE_STARTERS } from '@lib/tts/TextSegmenter';
import { normalizeLanguageCode } from '@lib/language-utils';

/**
 * Per-language TTS profile — the SOLE representation of voice/rate/length
 * preferences since the 5b store split (the flat `rate`/`pitch`/`voice`/
 * `minSentenceLength` mirrors died with `tts-storage`; active values are
 * derived via the selectors below). `pitch`/`volume` were dropped from the
 * profile shape: nothing ever applied them (phase5-tts-strangler.md §5b.4 —
 * recorded in the migration acceptance suite).
 */
export interface TTSProfile {
    voiceId: string | null;
    rate: number;
    minSentenceLength?: number;
}

export const getDefaultMinSentenceLength = (lang: string): number => lang.startsWith('zh') ? 6 : 36;

/**
 * The platform's device provider id (the post-split successor of `'local'`).
 * Defensive against partial Capacitor mocks in tests (the store default
 * evaluates at module load).
 */
export const platformDeviceProviderId = (): TTSProviderId =>
    typeof Capacitor?.isNativePlatform === 'function' && Capacitor.isNativePlatform()
        ? 'capacitor'
        : 'webspeech';

/**
 * PERSISTED TTS settings (`tts-settings` v1) — one half of the 5b split of the
 * legacy `tts-storage` god store (plan/overhaul/prep/phase5-tts-strangler.md
 * §5b.4). Pure user configuration: no engine mirror, no runtime voice list, no
 * download state — those live in the ephemeral `useTTSPlaybackStore`. Every
 * action is a pure state write; engine synchronization is the TtsController's
 * job.
 */
interface TTSSettingsState {
    /** Active language for TTS profile selection. */
    activeLanguage: string;
    /** Per-language TTS profiles (sole representation — selectors derive actives). */
    profiles: Record<string, TTSProfile>;

    /**
     * Provider configuration. Post-split id space: the device pair persists as
     * 'webspeech'/'capacitor' (the legacy `'local'` alias is mapped per platform
     * by the tts-storage migration and remains accepted on the engine path).
     */
    providerId: TTSProviderId;
    apiKeys: Record<TTSApiKeyProviderId, string>;

    /** Custom abbreviations for sentence segmentation */
    customAbbreviations: string[];
    /** Words that should always trigger a merge (e.g. "Mr.") */
    alwaysMerge: string[];
    /** Words that indicate a new sentence start (preventing merge) */
    sentenceStarters: string[];

    /** Whether to enable chapter pre-roll announcements */
    prerollEnabled: boolean;
    /** Whether to enable text sanitization (remove URLs, page numbers, etc.) */
    sanitizationEnabled: boolean;
    /** Whether to enable Bible abbreviations and lexicon globally. */
    isBibleLexiconEnabled: boolean;

    /** Local Provider Settings */
    backgroundAudioMode: 'silence' | 'noise' | 'off';
    whiteNoiseVolume: number;

    /** Actions (pure state writes). */
    setActiveLanguage: (lang: string) => void;
    setRate: (rate: number, lang?: string) => void;
    setVoiceId: (voiceId: string | null, lang?: string) => void;
    setMinSentenceLength: (length: number, lang?: string) => void;
    setProviderId: (id: TTSProviderId) => void;
    setApiKey: (provider: TTSApiKeyProviderId, key: string) => void;
    setCustomAbbreviations: (abbrevs: string[]) => void;
    setAlwaysMerge: (words: string[]) => void;
    setSentenceStarters: (words: string[]) => void;
    setPrerollEnabled: (enable: boolean) => void;
    setSanitizationEnabled: (enable: boolean) => void;
    setBibleLexiconEnabled: (enable: boolean) => void;
    setBackgroundAudioMode: (mode: 'silence' | 'noise' | 'off') => void;
    setWhiteNoiseVolume: (volume: number) => void;
}

const DEFAULT_PROFILE = (lang: string): TTSProfile => ({
    voiceId: null,
    rate: 1.0,
    minSentenceLength: getDefaultMinSentenceLength(lang),
});

// --- Selectors (the derived "active" values that used to be flat state) ---

export const selectActiveProfile = (s: Pick<TTSSettingsState, 'profiles' | 'activeLanguage'>): TTSProfile =>
    s.profiles[s.activeLanguage] ?? DEFAULT_PROFILE(s.activeLanguage);

export const selectActiveRate = (s: Pick<TTSSettingsState, 'profiles' | 'activeLanguage'>): number =>
    selectActiveProfile(s).rate;

export const selectActiveVoiceId = (s: Pick<TTSSettingsState, 'profiles' | 'activeLanguage'>): string | null =>
    selectActiveProfile(s).voiceId;

export const selectActiveMinSentenceLength = (s: Pick<TTSSettingsState, 'profiles' | 'activeLanguage'>): number =>
    selectActiveProfile(s).minSentenceLength ?? getDefaultMinSentenceLength(s.activeLanguage);

// ---------------------------------------------------------------------------
// tts-storage (v1/v2/v3) → tts-settings (v1) migration — THE Phase 5 user-data
// format change (one-in-flight rule; sequenced after P3's IDB v25 window).
// ---------------------------------------------------------------------------

/** Shape of a parsed legacy `tts-storage` persist envelope (any version). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LegacyEnvelope = { state: any; version?: number };

/**
 * Run the LEGACY tts-storage migration chain (v1→v2→v3 — copied verbatim from
 * the deleted useTTSStore) and map the result to the `tts-settings` v1 state.
 *
 *  - flat `rate`/`pitch`/`voice`/`minSentenceLength` fold into profiles (v<2)
 *    and are then DROPPED (selectors derive the actives);
 *  - profile `pitch`/`volume` are dropped (nothing applies them);
 *  - `enableCostWarning` is dropped (zero readers since CostEstimator died);
 *  - `providerId: 'local'` maps to the platform device id;
 *  - the `tts-storage` key is NEVER deleted here (one-release rollback path;
 *    P9 retires it).
 *
 * Exported for the captured-blob acceptance suite.
 */
export function migrateLegacyTtsStorage(
    raw: string | null,
    platformProviderId: TTSProviderId = platformDeviceProviderId(),
): Partial<TTSSettingsState> | null {
    if (!raw) return null;
    let envelope: LegacyEnvelope;
    try {
        envelope = JSON.parse(raw);
    } catch {
        return null;
    }
    const legacy = envelope?.state;
    if (!legacy || typeof legacy !== 'object') return null;
    const version = envelope.version ?? 0;

    // Legacy chain step v<2: fold flat fields into profiles (verbatim).
    if (version < 2) {
        legacy.activeLanguage = 'en';
        legacy.profiles = {
            en: {
                voiceId: legacy.voice?.id || null,
                rate: legacy.rate || 1.0,
                pitch: legacy.pitch || 1.0,
                volume: 1.0,
                minSentenceLength: legacy.minSentenceLength ?? getDefaultMinSentenceLength('en'),
            }
        };
    }
    // Legacy chain step v<3: backfill minSentenceLength per profile (verbatim).
    if (version < 3) {
        if (legacy.profiles) {
            for (const lang in legacy.profiles) {
                if (legacy.profiles[lang].minSentenceLength === undefined) {
                    legacy.profiles[lang].minSentenceLength = legacy.minSentenceLength ?? getDefaultMinSentenceLength(lang);
                }
            }
        }
    }

    // Map to the new shape: profiles stripped to {voiceId, rate, minSentenceLength}.
    const profiles: Record<string, TTSProfile> = {};
    for (const [lang, p] of Object.entries(legacy.profiles ?? {})) {
        const profile = p as { voiceId?: string | null; rate?: number; minSentenceLength?: number };
        profiles[lang] = {
            voiceId: profile.voiceId ?? null,
            rate: profile.rate ?? 1.0,
            minSentenceLength: profile.minSentenceLength ?? getDefaultMinSentenceLength(lang),
        };
    }

    return {
        activeLanguage: legacy.activeLanguage ?? 'en',
        profiles: Object.keys(profiles).length > 0 ? profiles : { en: DEFAULT_PROFILE('en') },
        providerId: legacy.providerId === 'local' ? platformProviderId : (legacy.providerId ?? platformProviderId),
        apiKeys: { google: '', openai: '', lemonfox: '', ...(legacy.apiKeys ?? {}) },
        customAbbreviations: legacy.customAbbreviations ?? undefined,
        alwaysMerge: legacy.alwaysMerge ?? undefined,
        sentenceStarters: legacy.sentenceStarters ?? undefined,
        prerollEnabled: legacy.prerollEnabled ?? false,
        sanitizationEnabled: legacy.sanitizationEnabled ?? true,
        isBibleLexiconEnabled: legacy.isBibleLexiconEnabled ?? true,
        backgroundAudioMode: legacy.backgroundAudioMode ?? 'silence',
        whiteNoiseVolume: legacy.whiteNoiseVolume ?? 0.1,
    };
}

/**
 * Storage adapter: on the FIRST read (no `tts-settings` key yet) it migrates the
 * legacy `tts-storage` blob in place of returning null, and persists the result
 * under the new key. The legacy key is left untouched for one release.
 */
const migratingStorage = createJSONStorage<Partial<TTSSettingsState>>(() => ({
    getItem: (name: string): string | null => {
        const existing = localStorage.getItem(name);
        if (existing !== null) return existing;

        const migrated = migrateLegacyTtsStorage(localStorage.getItem('tts-storage'));
        if (!migrated) return null;

        const envelope = JSON.stringify({ state: migrated, version: 1 });
        localStorage.setItem(name, envelope);
        return envelope;
    },
    setItem: (name: string, value: string) => localStorage.setItem(name, value),
    removeItem: (name: string) => localStorage.removeItem(name),
}));

/**
 * Zustand store for the persisted TTS settings. Engine commands and the
 * engine→store mirror do NOT live here — see src/app/tts/TtsController.ts and
 * `useTTSPlaybackStore`.
 */
export const useTTSSettingsStore = create<TTSSettingsState>()(
    persist(
        (set, get) => {
            const upsertProfile = (lang: string, patch: Partial<TTSProfile>) => {
                set((state) => ({
                    profiles: {
                        ...state.profiles,
                        [lang]: { ...(state.profiles[lang] ?? DEFAULT_PROFILE(lang)), ...patch },
                    },
                }));
            };

            return {
                activeLanguage: 'en',
                profiles: {
                    en: DEFAULT_PROFILE('en'),
                },
                providerId: platformDeviceProviderId(),
                apiKeys: {
                    google: '',
                    openai: '',
                    lemonfox: ''
                },
                customAbbreviations: [
                    'Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.', 'Gen.', 'Rep.', 'Sen.', 'St.', 'vs.', 'Jr.', 'Sr.',
                    'e.g.', 'i.e.'
                ],
                alwaysMerge: DEFAULT_ALWAYS_MERGE,
                sentenceStarters: DEFAULT_SENTENCE_STARTERS,
                prerollEnabled: false,
                sanitizationEnabled: true,
                isBibleLexiconEnabled: true, // Default to true
                backgroundAudioMode: 'silence',
                whiteNoiseVolume: 0.1,

                setActiveLanguage: (rawLang) => {
                    const lang = normalizeLanguageCode(rawLang);
                    const profile = get().profiles[lang] ?? DEFAULT_PROFILE(lang);
                    set((state) => ({
                        activeLanguage: lang,
                        profiles: { ...state.profiles, [lang]: profile },
                    }));
                },
                setRate: (rate, lang?: string) => {
                    upsertProfile(lang || get().activeLanguage, { rate });
                },
                setVoiceId: (voiceId, lang?: string) => {
                    upsertProfile(lang || get().activeLanguage, { voiceId });
                },
                setMinSentenceLength: (length, lang?: string) => {
                    upsertProfile(lang || get().activeLanguage, { minSentenceLength: length });
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
            };
        },
        {
            name: 'tts-settings',
            version: 1,
            storage: migratingStorage,
            partialize: (state) => ({
                activeLanguage: state.activeLanguage,
                profiles: state.profiles,
                providerId: state.providerId,
                apiKeys: state.apiKeys,
                customAbbreviations: state.customAbbreviations,
                alwaysMerge: state.alwaysMerge,
                sentenceStarters: state.sentenceStarters,
                prerollEnabled: state.prerollEnabled,
                sanitizationEnabled: state.sanitizationEnabled,
                isBibleLexiconEnabled: state.isBibleLexiconEnabled,
                backgroundAudioMode: state.backgroundAudioMode,
                whiteNoiseVolume: state.whiteNoiseVolume,
            }),
            onRehydrateStorage: () => (state) => {
                if (state) {
                    // Pure state fix-up only (engine side effects live in
                    // TtsController.initialize — R9 complete).
                    if (!state.profiles) {
                        state.profiles = { en: DEFAULT_PROFILE('en') };
                        state.activeLanguage = 'en';
                    }
                }
            },
        }
    )
);

/**
 * tts-storage captured-blob regression suite (phase5-tts-strangler.md §5b.4 step 3).
 *
 * Loads each committed localStorage blob (v1/v2 hand-derived era variants, v3 captured from
 * the live store by scripts/capture-tts-storage.ts), boots the CURRENT `useTTSStore` against
 * it and pins the legacy migration chain (persist migrate, versions 1→2→3):
 *
 *  - API keys survive (the paid-key datum the 5b-PR5 settings split must not lose),
 *  - per-language profiles survive (incl. the zh minSentenceLength),
 *  - the v1 flat fields fold into profiles, v2 profiles get minSentenceLength backfilled,
 *  - the `tts-storage` key itself is never deleted by rehydration.
 *
 * This is the regression FLOOR for 5b-PR5 (tts-storage v3 → tts-settings v1): that PR's
 * migration suite extends these cases (provider-id platform mapping, dropped fields,
 * old-key retention for one release) on the same fixtures.
 *
 * Side-effect ports (engine handle, LexiconService) are stubbed; persistence shape,
 * partialize, version and migrate come from the real store module.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import v1Blob from './tts-storage.v1.json';
import v2Blob from './tts-storage.v2.json';
import v3Blob from './tts-storage.v3.json';

vi.mock('@app/tts/mainThreadAudioPlayer', () => ({
    getAudioPlayer: () => ({
        whenReady: () => Promise.resolve(),
        subscribe: () => () => {},
        play: () => {},
        pause: () => {},
        stop: () => {},
        setSpeed: () => {},
        setLanguage: () => {},
        setVoice: () => {},
        setProviderById: async () => {},
        init: async () => {},
        getVoices: async () => [],
        downloadVoice: async () => {},
        deleteVoice: async () => {},
        isVoiceDownloaded: async () => false,
        setBackgroundAudioMode: () => {},
        setBackgroundVolume: () => {},
        setPrerollEnabled: () => {},
        jumpTo: () => {},
        seek: () => {},
    }),
}));

vi.mock('@lib/tts/LexiconService', () => ({
    LexiconService: {
        getInstance: () => ({ setGlobalBibleLexiconEnabled: () => {} }),
    },
}));

/** Seed a fixture blob and boot a FRESH store module against it. */
async function bootStoreWith(blob: unknown) {
    localStorage.setItem('tts-storage', JSON.stringify(blob));
    vi.resetModules();
    const { useTTSStore } = await import('@store/useTTSStore');
    // localStorage rehydration is synchronous, but give onRehydrateStorage a tick.
    await new Promise((r) => setTimeout(r, 0));
    return useTTSStore.getState();
}

describe('tts-storage captured-blob fixtures (legacy migration chain)', () => {
    beforeEach(() => {
        localStorage.removeItem('tts-storage');
    });

    it('v3 (captured from the live store) rehydrates losslessly', async () => {
        const state = await bootStoreWith(v3Blob);

        expect(state.apiKeys.google).toBe('AIza-FIXTURE-google-key-not-real');
        expect(state.providerId).toBe('piper');
        expect(state.profiles.en).toMatchObject({ voiceId: 'en_US-lessac-medium', minSentenceLength: 36 });
        expect(state.profiles.zh).toMatchObject({
            voiceId: 'zh_CN-huayan-medium',
            rate: 1.25,
            minSentenceLength: 6,
        });
        expect(state.customAbbreviations).toContain('Rev.');
        expect(state.customAbbreviations).toContain('Gal.');
        expect(state.voice?.id).toBe('en_US-lessac-medium');

        expect(localStorage.getItem('tts-storage')).toBeTruthy();
    });

    it('v1 (flat pre-profiles era) folds the flat fields into an en profile', async () => {
        const state = await bootStoreWith(v1Blob);

        // migrate version<2: flat rate/voice/minSentenceLength → profiles.en, activeLanguage 'en'.
        expect(state.activeLanguage).toBe('en');
        expect(state.profiles.en).toMatchObject({
            voiceId: 'Google US English',
            rate: 1.1,
            pitch: 1,
            minSentenceLength: 20,
        });
        // Untouched persisted fields survive the chain.
        expect(state.providerId).toBe('google');
        expect(state.apiKeys.google).toBe('AIza-FIXTURE-v1-google-key');
        expect(state.prerollEnabled).toBe(true);
        expect(state.customAbbreviations).toEqual(['Mr.', 'Dr.']);

        expect(localStorage.getItem('tts-storage')).toBeTruthy();
    });

    it('v2 (profiles without minSentenceLength) backfills minSentenceLength per profile', async () => {
        const state = await bootStoreWith(v2Blob);

        // migrate version<3: every profile missing minSentenceLength gets the flat value (12).
        expect(state.profiles.en).toMatchObject({ voiceId: 'v-en-webspeech', minSentenceLength: 12 });
        expect(state.profiles.zh).toMatchObject({
            voiceId: 'v-zh-webspeech',
            rate: 1.5,
            minSentenceLength: 12,
        });
        expect(state.activeLanguage).toBe('zh');
        expect(state.apiKeys.openai).toBe('sk-FIXTURE-v2-openai-key');
        expect(state.backgroundAudioMode).toBe('noise');
        expect(state.whiteNoiseVolume).toBe(0.25);

        expect(localStorage.getItem('tts-storage')).toBeTruthy();
    });
});

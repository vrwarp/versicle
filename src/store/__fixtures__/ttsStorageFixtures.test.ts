/**
 * tts-storage → tts-settings migration ACCEPTANCE suite (5b-PR3; the Phase 5
 * user-data format change — phase5-tts-strangler.md §5b.4 steps 1–3).
 *
 * Loads each committed localStorage blob (v1/v2 hand-derived era variants, v3
 * captured from the live pre-split store at the gate PR), boots the CURRENT
 * `useTTSSettingsStore` against it and pins the full chain — legacy migrate
 * (v1→v2→v3) followed by the split mapping (v3 → `tts-settings` v1):
 *
 *  - API keys survive (the paid-key datum the split must not lose),
 *  - per-language profiles survive (incl. the zh minSentenceLength),
 *  - `providerId: 'local'` maps to the platform device id (webspeech on web,
 *    capacitor on native),
 *  - dropped fields are ABSENT from the new key (`enableCostWarning`, the flat
 *    rate/pitch/voice/minSentenceLength mirrors, profile `pitch`/`volume`),
 *  - the `tts-settings` v1 envelope is written,
 *  - the legacy `tts-storage` key is NEVER deleted (one-release rollback path;
 *    P9 retires it).
 *
 * The fixtures are CHECKED IN AND REVIEWED artifacts — never regenerated in CI
 * (the capture script ran at the gate PR against the pre-split store and was
 * deleted with it; provenance in README.md).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import v1Blob from './tts-storage.v1.json';
import v2Blob from './tts-storage.v2.json';
import v3Blob from './tts-storage.v3.json';

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: vi.fn(() => false),
        getPlatform: vi.fn(() => 'web'),
    },
}));

import { Capacitor } from '@capacitor/core';
import { migrateLegacyTtsStorage } from '@store/useTTSSettingsStore';

/** Seed a fixture blob and boot a FRESH settings-store module against it. */
async function bootStoreWith(blob: unknown) {
    localStorage.removeItem('tts-storage');
    localStorage.removeItem('tts-settings');
    localStorage.setItem('tts-storage', JSON.stringify(blob));
    vi.resetModules();
    const { useTTSSettingsStore } = await import('@store/useTTSSettingsStore');
    // localStorage rehydration is synchronous, but give onRehydrateStorage a tick.
    await new Promise((r) => setTimeout(r, 0));
    return useTTSSettingsStore.getState();
}

/** The persisted tts-settings envelope written during the boot above. */
function persistedSettings(): { state: Record<string, unknown>; version: number } {
    const raw = localStorage.getItem('tts-settings');
    expect(raw, 'tts-settings must be written by the migration').toBeTruthy();
    return JSON.parse(raw!);
}

describe('tts-storage → tts-settings captured-blob acceptance (5b-PR3 migration)', () => {
    beforeEach(() => {
        localStorage.removeItem('tts-storage');
        localStorage.removeItem('tts-settings');
        vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    });

    it('v3 (captured from the live store): keys + profiles survive, dropped fields are absent', async () => {
        const state = await bootStoreWith(v3Blob);

        // The paid API key survives.
        expect(state.apiKeys.google).toBe('AIza-FIXTURE-google-key-not-real');
        // Non-'local' provider ids pass through unchanged.
        expect(state.providerId).toBe('piper');
        // Per-language profiles survive, incl. the zh minSentenceLength.
        expect(state.profiles.en).toMatchObject({ voiceId: 'en_US-lessac-medium', minSentenceLength: 36 });
        expect(state.profiles.zh).toMatchObject({
            voiceId: 'zh_CN-huayan-medium',
            rate: 1.25,
            minSentenceLength: 6,
        });
        expect(state.customAbbreviations).toContain('Rev.');
        expect(state.customAbbreviations).toContain('Gal.');

        // Dropped fields are ABSENT from the persisted new shape.
        const { state: persisted, version } = persistedSettings();
        expect(version).toBe(1);
        expect(persisted).not.toHaveProperty('enableCostWarning');
        expect(persisted).not.toHaveProperty('rate');
        expect(persisted).not.toHaveProperty('pitch');
        expect(persisted).not.toHaveProperty('voice');
        expect(persisted).not.toHaveProperty('minSentenceLength');
        const profiles = persisted.profiles as Record<string, Record<string, unknown>>;
        expect(profiles.en).not.toHaveProperty('pitch');
        expect(profiles.en).not.toHaveProperty('volume');

        // The legacy key is retained for one release (rollback path).
        expect(localStorage.getItem('tts-storage')).toBeTruthy();
    });

    it('v1 (flat pre-profiles era): the legacy chain folds flat fields, then the split maps', async () => {
        const state = await bootStoreWith(v1Blob);

        // migrate version<2: flat rate/voice/minSentenceLength → profiles.en, activeLanguage 'en'.
        expect(state.activeLanguage).toBe('en');
        expect(state.profiles.en).toMatchObject({
            voiceId: 'Google US English',
            rate: 1.1,
            minSentenceLength: 20,
        });
        // Untouched persisted fields survive the chain.
        expect(state.providerId).toBe('google');
        expect(state.apiKeys.google).toBe('AIza-FIXTURE-v1-google-key');
        expect(state.prerollEnabled).toBe(true);
        expect(state.customAbbreviations).toEqual(['Mr.', 'Dr.']);

        expect(localStorage.getItem('tts-storage')).toBeTruthy();
    });

    it("v2 (profiles without minSentenceLength): backfills per profile and maps 'local' to webspeech on web", async () => {
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

        // The 'local' provider id split: platform-mapped (web → webspeech).
        expect(state.providerId).toBe('webspeech');

        expect(localStorage.getItem('tts-storage')).toBeTruthy();
    });

    it("maps 'local' to capacitor on NATIVE platforms (the other half of the id split)", () => {
        const migrated = migrateLegacyTtsStorage(JSON.stringify(v2Blob), 'capacitor');
        expect(migrated?.providerId).toBe('capacitor');
    });

    it('a fresh install (no legacy key) boots platform defaults', async () => {
        localStorage.removeItem('tts-storage');
        localStorage.removeItem('tts-settings');
        vi.resetModules();
        const { useTTSSettingsStore } = await import('@store/useTTSSettingsStore');
        await new Promise((r) => setTimeout(r, 0));

        const state = useTTSSettingsStore.getState();
        expect(state.providerId).toBe('webspeech'); // platform default on web
        expect(state.profiles.en).toBeDefined();
    });

    it('an existing tts-settings key wins over the legacy blob (migration runs once)', async () => {
        localStorage.setItem('tts-settings', JSON.stringify({
            state: { activeLanguage: 'zh', providerId: 'google' },
            version: 1,
        }));
        localStorage.setItem('tts-storage', JSON.stringify(v3Blob));
        vi.resetModules();
        const { useTTSSettingsStore } = await import('@store/useTTSSettingsStore');
        await new Promise((r) => setTimeout(r, 0));

        const state = useTTSSettingsStore.getState();
        expect(state.activeLanguage).toBe('zh');
        expect(state.providerId).toBe('google'); // NOT piper from the legacy blob
    });
});

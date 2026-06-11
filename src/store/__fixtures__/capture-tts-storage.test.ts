/**
 * tts-storage v3 fixture CAPTURE (phase5-tts-strangler.md §5b.4 step 3 — gate PR).
 *
 * Runs the CURRENT app store in vitest-jsdom, drives `useTTSStore` through the
 * design-doc checklist (Google API key, piper provider + voice profiles, zh profile
 * {voiceId, rate:1.25, minSentenceLength:6}, custom abbreviations) and dumps
 * `localStorage['tts-storage']` into tts-storage.v3.json (re-serialized pretty for
 * review; content verbatim).
 *
 * Gated behind CAPTURE_TTS_STORAGE=1 — run via `node scripts/capture-tts-storage.ts`.
 * In normal suite runs this file reports one skipped test. The committed fixture is a
 * REVIEWED artifact (like the P2 Y.Doc fixtures): never regenerated in CI;
 * ttsStorageFixtures.test.ts pins the migration chain against it.
 *
 * Only side-effect PORTS are stubbed (the engine handle + LexiconService): persistence
 * shape, partialize and versioning come from the real store module.
 */
import { describe, it, expect, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

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

describe.runIf(process.env.CAPTURE_TTS_STORAGE === '1')('tts-storage v3 fixture capture', () => {
    it('drives the live useTTSStore and dumps localStorage["tts-storage"]', async () => {
        localStorage.removeItem('tts-storage');
        const { useTTSStore } = await import('@store/useTTSStore');
        const store = useTTSStore.getState();

        // 1. Paid cloud API key (the must-not-lose datum of the 5b-PR5 migration).
        store.setApiKey('google', 'AIza-FIXTURE-google-key-not-real');
        // 2. Piper provider with a downloaded-voice profile flagged on the en profile.
        store.setProviderId('piper');
        useTTSStore.getState().setVoice(
            { id: 'en_US-lessac-medium', name: 'Lessac (en_US)', lang: 'en-US', provider: 'piper' },
        );
        // 3. zh profile {voiceId, rate:1.25, minSentenceLength:6}.
        useTTSStore.getState().setVoice(
            { id: 'zh_CN-huayan-medium', name: 'Huayan (zh_CN)', lang: 'zh-CN', provider: 'piper' },
            'zh',
        );
        useTTSStore.getState().setRate(1.25, 'zh');
        useTTSStore.getState().setMinSentenceLength(6, 'zh');
        // 4. Custom abbreviations on top of the defaults.
        useTTSStore.getState().setCustomAbbreviations([
            ...useTTSStore.getState().customAbbreviations,
            'Rev.',
            'Gal.',
        ]);

        // Let the async provider-switch chain settle before reading the blob.
        await new Promise((r) => setTimeout(r, 10));

        const raw = localStorage.getItem('tts-storage');
        expect(raw).toBeTruthy();
        const blob = JSON.parse(raw!) as { version: number };
        expect(blob.version).toBe(3);

        // jsdom rewrites import.meta.url to a non-file scheme; vitest runs from the repo root.
        const out = join(process.cwd(), 'src/store/__fixtures__/tts-storage.v3.json');
        writeFileSync(out, `${JSON.stringify(blob, null, 2)}\n`);
        console.log(`captured ${out}`);
    });
});

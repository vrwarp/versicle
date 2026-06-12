/**
 * ProviderDescriptor registry tests (Phase 5a-PR1).
 *
 * The registry is the single source of truth for provider ids, construction, UI
 * options, and capability routing — these tests pin the derived surfaces the rest
 * of the app depends on (store union, settings options, descriptor-driven guards,
 * and the 'local' alias that defers the webspeech/capacitor id split to 5b).
 */
import { describe, it, expect } from 'vitest';

// No module mocks (vi.mock is being retired from providers/): jsdom IS the web
// platform for Capacitor, every alias test passes its platform explicitly, and no
// live provider is ever built here — capability guards run against plain fakes.
import {
    PROVIDERS,
    resolveDescriptor,
    selectableProviders,
    asVoiceDownloadable,
    asLocaleAware,
} from './registry';
import type { ITTSProvider } from './types';

const PROVIDER_IDS = PROVIDERS.map((d) => d.id);

function fakeProvider(id: string): ITTSProvider {
    return {
        id,
        init: async () => {},
        getVoices: async () => [],
        play: async () => {},
        preload: async () => {},
        pause: () => {},
        stop: () => {},
        dispose: () => {},
        on: () => () => {},
    };
}

describe('provider registry', () => {
    it('registers exactly the six descriptors with unique ids', () => {
        expect([...PROVIDER_IDS].sort()).toEqual(
            ['capacitor', 'google', 'lemonfox', 'openai', 'piper', 'webspeech'],
        );
        expect(new Set(PROVIDER_IDS).size).toBe(PROVIDERS.length);
    });

    it('has no speed/pitch capability — the P0 speed-at-sink policy is not opt-out', () => {
        for (const d of PROVIDERS) {
            expect(Object.keys(d.capabilities).sort()).toEqual(['downloadableVoices', 'localeAware']);
        }
    });

    it('every requiresApiKey descriptor carries an apiKeyLabel for the settings UI', () => {
        for (const d of PROVIDERS as readonly import('./registry').ProviderDescriptor[]) {
            if (d.requiresApiKey) {
                expect(d.apiKeyLabel, d.id).toBeTruthy();
            } else {
                expect(d.apiKeyLabel, d.id).toBeUndefined();
            }
        }
    });

    describe("the 'local' alias (id split deferred to 5b — zero format change in 5a)", () => {
        it("resolves 'local' to webspeech on web and capacitor on native", () => {
            expect(resolveDescriptor('local', 'web').id).toBe('webspeech');
            expect(resolveDescriptor('local', 'native').id).toBe('capacitor');
        });

        it('resolves registered ids directly', () => {
            expect(resolveDescriptor('piper').id).toBe('piper');
            expect(resolveDescriptor('google').id).toBe('google');
        });

        it('falls back to the platform device provider for unknown ids (legacy factory default)', () => {
            expect(resolveDescriptor('definitely-not-a-provider', 'web').id).toBe('webspeech');
            expect(resolveDescriptor('definitely-not-a-provider', 'native').id).toBe('capacitor');
        });
    });

    describe('selectableProviders (settings UI source)', () => {
        it("offers the device provider under the persisted 'local' id, in stable order", () => {
            const web = selectableProviders('web');
            expect(web.map((o) => o.id)).toEqual(['local', 'piper', 'google', 'openai', 'lemonfox']);
            expect(web[0].displayName).toBe('Web Speech (Local)');

            const native = selectableProviders('native');
            expect(native.map((o) => o.id)).toEqual(['local', 'piper', 'google', 'openai', 'lemonfox']);
            expect(native[0].displayName).toBe('System Speech (Local)');
        });

        it('never offers webspeech/capacitor as separate ids before the 5b split', () => {
            for (const platform of ['web', 'native'] as const) {
                const ids = selectableProviders(platform).map((o) => o.id) as string[];
                expect(ids).not.toContain('webspeech');
                expect(ids).not.toContain('capacitor');
            }
        });
    });

    describe('descriptor-driven capability guards (no as-any probing)', () => {
        it('narrows piper to VoiceDownloadable and LocaleAware', () => {
            const piper = fakeProvider('piper');
            expect(asVoiceDownloadable(piper)).toBe(piper);
            expect(asLocaleAware(piper)).toBe(piper);
        });

        it('returns null for non-capable providers — including unknown ids', () => {
            for (const id of ['local', 'google', 'openai', 'lemonfox', 'mock-cloud']) {
                expect(asVoiceDownloadable(fakeProvider(id)), id).toBeNull();
                expect(asLocaleAware(fakeProvider(id)), id).toBeNull();
            }
        });
    });
});

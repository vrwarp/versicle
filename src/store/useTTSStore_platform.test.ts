import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveDescriptor } from '@lib/tts/providers/registry';
import { storeProviderBuildContext } from '@app/tts/providerBuildContext';
import { useTTSStore } from './useTTSStore';
import { Capacitor } from '@capacitor/core';

/** The production composition: registry descriptor + store-backed build context. */
const buildProviderById = (id: string) =>
    resolveDescriptor(id).build(storeProviderBuildContext(id));

// Mock Capacitor
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(),
    getPlatform: vi.fn()
  }
}));

// Mock Providers with identifiable property
vi.mock('@lib/tts/providers/WebSpeechProvider', () => ({
  WebSpeechProvider: class {
    _type = 'WebSpeech';
    id = 'local';
  }
}));

vi.mock('@lib/tts/providers/CapacitorTTSProvider', () => ({
  CapacitorTTSProvider: class {
    _type = 'Capacitor';
    id = 'local';
  }
}));

vi.mock('@lib/tts/providers/GoogleTTSProvider', () => ({
    GoogleTTSProvider: class {
        _type = 'Google';
        id = 'google';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        constructor(apiKey?: any) { this.apiKey = apiKey; }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        apiKey: any;
    }
}));

vi.mock('@lib/tts/providers/OpenAIProvider', () => ({
    OpenAIProvider: class {
        _type = 'OpenAI';
        id = 'openai';
    }
}));

// NOTE: the providerId → engine routing (setProviderById / loadVoices chains)
// moved to the TtsController facade at Phase 5b-PR1 — those assertions live in
// src/app/tts/TtsController.test.ts. What remains here is the registry/factory
// platform detection plus the store-backed build context.

describe('Provider selection (factory platform detection + store build context)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset store state
        useTTSStore.setState({
            activeLanguage: 'en',
            profiles: {
                en: { voiceId: null, rate: 1, pitch: 1, volume: 1 }
            },
            providerId: 'local',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            apiKeys: { google: 'g-key', openai: '' } as any,
            backgroundAudioMode: 'silence',
            whiteNoiseVolume: 0.1,
            rate: 1,
            pitch: 1,
            voice: null,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            voices: [{ id: 'test-en', name: 'Test English', lang: 'en-US', provider: 'local' } as any]
        });
    });

    // The platform branching that used to live in the store now lives in the registry
    // ('local' alias resolution); the store read lives in the app-layer context source.
    it('factory: builds WebSpeechProvider on web for the local provider', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (Capacitor.isNativePlatform as any).mockReturnValue(false);

        const provider = buildProviderById('local');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((provider as any)._type).toBe('WebSpeech');
    });

    it('factory: builds CapacitorTTSProvider on native for the local provider', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (Capacitor.isNativePlatform as any).mockReturnValue(true);

        const provider = buildProviderById('local');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((provider as any)._type).toBe('Capacitor');
    });

    it('factory: injects the stored API key for cloud providers', () => {
        const provider = buildProviderById('google');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((provider as any)._type).toBe('Google');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((provider as any).apiKey).toBe('g-key');
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTTSStore } from './useTTSStore';
import { buildProviderById } from '@lib/tts/providerFactory';
import { Capacitor } from '@capacitor/core';

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

// Mock AudioPlayerService using vi.hoisted to share mock functions
const { mockSetProviderById, mockInit, mockGetVoices, mockSubscribe, mockSetVoice, mockWhenReady } = vi.hoisted(() => {
    return {
        mockSetProviderById: vi.fn(),
        mockInit: vi.fn().mockResolvedValue(undefined),
        mockGetVoices: vi.fn().mockResolvedValue([]),
        mockSubscribe: vi.fn(),
        mockSetVoice: vi.fn(),
        mockWhenReady: vi.fn().mockResolvedValue(undefined),
    }
});

vi.mock('@app/tts/mainThreadAudioPlayer', () => {
    return {
        getAudioPlayer: vi.fn(() => ({
            setProviderById: mockSetProviderById,
            init: mockInit,
            getVoices: mockGetVoices,
            subscribe: mockSubscribe,
            setVoice: mockSetVoice,
            whenReady: mockWhenReady,
        })),
        resetAudioPlayerForTests: vi.fn(),
    };
});

describe('Provider selection (store routing + factory platform detection)', () => {
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

    it('routes the configured providerId to the engine as plain data (setProviderById)', async () => {
        useTTSStore.getState().setProviderId('local');
        await Promise.resolve();

        expect(mockSetProviderById).toHaveBeenCalledWith('local');
    });

    it('routes a cloud providerId through the same uniform call', async () => {
        useTTSStore.getState().setProviderId('google');
        await Promise.resolve();

        expect(mockSetProviderById).toHaveBeenCalledWith('google');
    });

    it('loadVoices re-applies the current providerId', async () => {
        await useTTSStore.getState().loadVoices();

        expect(mockSetProviderById).toHaveBeenCalledWith('local');
        expect(mockInit).toHaveBeenCalled();
    });

    // The platform branching that used to live in the store now lives in the single factory.
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

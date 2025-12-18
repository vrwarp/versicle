import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTTSStore } from './useTTSStore';
import { Capacitor } from '@capacitor/core';

// Mock Capacitor
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(),
    getPlatform: vi.fn()
  }
}));

// Mock Providers with identifiable property
vi.mock('../lib/tts/providers/WebSpeechProvider', () => ({
  WebSpeechProvider: class {
    _type = 'WebSpeech';
    id = 'local';
    init = vi.fn().mockResolvedValue(undefined);
    getVoices = vi.fn().mockResolvedValue([]);
    synthesize = vi.fn();
    stop = vi.fn();
    on = vi.fn();
    setConfig = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(config: any) { this.config = config; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: any;
  }
}));

vi.mock('../lib/tts/providers/CapacitorTTSProvider', () => ({
  CapacitorTTSProvider: class {
    _type = 'Capacitor';
    id = 'local';
    init = vi.fn().mockResolvedValue(undefined);
    getVoices = vi.fn().mockResolvedValue([]);
    synthesize = vi.fn();
    stop = vi.fn();
    on = vi.fn();
  }
}));

vi.mock('../lib/tts/providers/GoogleTTSProvider', () => ({
    GoogleTTSProvider: class {
        _type = 'Google';
        id = 'google';
        init = vi.fn().mockResolvedValue(undefined);
        getVoices = vi.fn().mockResolvedValue([]);
        synthesize = vi.fn();
    }
}));

vi.mock('../lib/tts/providers/OpenAIProvider', () => ({
    OpenAIProvider: class {
        _type = 'OpenAI';
        id = 'openai';
        init = vi.fn().mockResolvedValue(undefined);
        getVoices = vi.fn().mockResolvedValue([]);
        synthesize = vi.fn();
    }
}));

// Mock AudioPlayerService using vi.hoisted to share mock functions
const { mockSetProvider, mockInit, mockGetVoices, mockSubscribe, mockSetVoice, mockSetLocalProviderConfig } = vi.hoisted(() => {
    return {
        mockSetProvider: vi.fn(),
        mockInit: vi.fn().mockResolvedValue(undefined),
        mockGetVoices: vi.fn().mockResolvedValue([]),
        mockSubscribe: vi.fn(),
        mockSetVoice: vi.fn(),
        mockSetLocalProviderConfig: vi.fn(),
    }
});

vi.mock('../lib/tts/AudioPlayerService', () => {
    return {
        AudioPlayerService: {
            getInstance: vi.fn(() => ({
                setProvider: mockSetProvider,
                init: mockInit,
                getVoices: mockGetVoices,
                subscribe: mockSubscribe,
                setVoice: mockSetVoice,
                setLocalProviderConfig: mockSetLocalProviderConfig,
            }))
        }
    };
});

describe('useTTSStore Platform Detection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset store state
        useTTSStore.setState({
            providerId: 'local',
            apiKeys: { google: '', openai: '' },
            backgroundAudioMode: 'silence',
            whiteNoiseVolume: 0.1
        });
    });

    it('should use WebSpeechProvider on web platform when selecting local provider', async () => {
        // Mock non-native
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (Capacitor.isNativePlatform as any).mockReturnValue(false);

        // Trigger provider set
        useTTSStore.getState().setProviderId('local');

        expect(mockSetProvider).toHaveBeenCalled();
        const providerArg = mockSetProvider.mock.calls[0][0];
        expect(providerArg._type).toBe('WebSpeech');
    });

    it('should use CapacitorTTSProvider on native platform when selecting local provider', async () => {
        // Mock native
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (Capacitor.isNativePlatform as any).mockReturnValue(true);

        // Trigger provider set
        useTTSStore.getState().setProviderId('local');

        expect(mockSetProvider).toHaveBeenCalled();
        const providerArg = mockSetProvider.mock.calls[0][0];
        // This assertion is expected to fail before the fix
        expect(providerArg._type).toBe('Capacitor');
    });

    it('should use CapacitorTTSProvider on native platform during loadVoices', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (Capacitor.isNativePlatform as any).mockReturnValue(true);

        // Call loadVoices which also sets provider
        await useTTSStore.getState().loadVoices();

        expect(mockSetProvider).toHaveBeenCalled();
        const providerArg = mockSetProvider.mock.calls[0][0];
        // This assertion is expected to fail before the fix
        expect(providerArg._type).toBe('Capacitor');
    });
});

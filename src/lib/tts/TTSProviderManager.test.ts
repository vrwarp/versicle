import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TTSProviderManager } from './TTSProviderManager';
import type { ITTSProvider, TTSProviderEvent } from './providers/types';
import { CapacitorTTSProvider } from './providers/CapacitorTTSProvider';
import { WebSpeechProvider } from './providers/WebSpeechProvider';

// Mock concrete providers
vi.mock('./providers/CapacitorTTSProvider');
vi.mock('./providers/WebSpeechProvider');
vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: vi.fn().mockReturnValue(false),
        getPlatform: vi.fn().mockReturnValue('web')
    }
}));

describe('TTSProviderManager', () => {
    let manager: TTSProviderManager;
    let mockProvider: ITTSProvider;
    let eventCallback: (e: TTSProviderEvent) => void;

    beforeEach(() => {
        eventCallback = () => {};
        mockProvider = {
            id: 'mock',
            play: vi.fn(),
            pause: vi.fn(),
            resume: vi.fn(),
            stop: vi.fn(),
            preload: vi.fn(),
            getVoices: vi.fn().mockResolvedValue([]),
            init: vi.fn().mockResolvedValue(undefined),
            on: vi.fn((cb) => { eventCallback = cb; })
        };
        manager = new TTSProviderManager(mockProvider);
    });

    it('should initialize with given provider', async () => {
        await manager.init();
        expect(mockProvider.init).toHaveBeenCalled();
    });

    it('should proxy play calls', async () => {
        await manager.play('text', { voiceId: 'v1', speed: 1.0 });
        expect(mockProvider.play).toHaveBeenCalledWith('text', { voiceId: 'v1', speed: 1.0 });
    });

    it('should handle provider fallback on error', async () => {
        const failingProvider = { ...mockProvider, id: 'cloud' };
        failingProvider.play = vi.fn().mockRejectedValue(new Error('Network error'));

        manager = new TTSProviderManager(failingProvider);

        // Mock fallback provider
        const localProviderInstance = {
            ...mockProvider,
            id: 'local',
            play: vi.fn().mockResolvedValue(undefined),
            init: vi.fn().mockResolvedValue(undefined)
        };
        (WebSpeechProvider as unknown as jest.Mock).mockImplementation(function() { return localProviderInstance; });
        (CapacitorTTSProvider as unknown as jest.Mock).mockImplementation(function() { return localProviderInstance; });

        const errorSpy = vi.fn();
        manager.on(errorSpy);

        await manager.play('text', { voiceId: 'v1', speed: 1.0 });

        expect(failingProvider.play).toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
        expect(localProviderInstance.init).toHaveBeenCalled();
        expect(localProviderInstance.play).toHaveBeenCalled();
        expect(manager.getProviderId()).toBe('local');
    });

    it('should proxy events from provider', () => {
        const listener = vi.fn();
        manager.on(listener);

        eventCallback({ type: 'start' });
        expect(listener).toHaveBeenCalledWith({ type: 'start' });

        eventCallback({ type: 'end' });
        expect(listener).toHaveBeenCalledWith({ type: 'end' });
    });

    it('should support switching providers', async () => {
        const newProvider = { ...mockProvider, id: 'new' };
        await manager.setProvider(newProvider);

        expect(mockProvider.stop).toHaveBeenCalled();
        expect(newProvider.init).toHaveBeenCalled();
        expect(manager.getProviderId()).toBe('new');
    });
});

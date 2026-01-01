import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TTSProviderManager } from './TTSProviderManager';

// Mock Providers
vi.mock('./providers/WebSpeechProvider', () => {
  return {
    WebSpeechProvider: class {
      id = 'local';
      init = vi.fn().mockResolvedValue(undefined);
      play = vi.fn().mockResolvedValue(undefined);
      stop = vi.fn();
      on = vi.fn();
      getVoices = vi.fn().mockResolvedValue([]);
    }
  };
});

vi.mock('./providers/CapacitorTTSProvider', () => {
    return {
        CapacitorTTSProvider: class {
            id = 'local';
            init = vi.fn().mockResolvedValue(undefined);
            play = vi.fn().mockResolvedValue(undefined);
            stop = vi.fn();
            on = vi.fn();
            getVoices = vi.fn().mockResolvedValue([]);
        }
    }
});

describe('TTSProviderManager', () => {
    let manager: TTSProviderManager;
    let events = {
        onStart: vi.fn(),
        onEnd: vi.fn(),
        onError: vi.fn(),
        onTimeUpdate: vi.fn(),
        onMeta: vi.fn(),
        onDownloadProgress: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        manager = new TTSProviderManager(events);
    });

    it('should initialize with a provider', async () => {
        await manager.init();
        expect(manager.getId()).toBe('local'); // Default mock
    });

    it('should propagate events', async () => {
        // Access inner provider to trigger events
        // @ts-expect-error Access private
        const provider = manager.provider;

        // Simulate start
        // The mock 'on' calls the listener? No, we need to manually trigger it.
        // But our mock setup doesn't store the listener. We need to improve the mock.

        // Let's rely on the fact that constructor calls provider.on
        expect(provider.on).toHaveBeenCalled();
        const listener = provider.on.mock.calls[0][0];

        listener({ type: 'start' });
        expect(events.onStart).toHaveBeenCalled();

        listener({ type: 'end' });
        expect(events.onEnd).toHaveBeenCalled();

        listener({ type: 'error', error: { message: 'oops' } });
        expect(events.onError).toHaveBeenCalledWith({ message: 'oops', type: undefined });
    });

    it('should switch to local on play error', async () => {
        // Mock a failing provider
        const failingProvider = {
             id: 'cloud',
             init: vi.fn(),
             play: vi.fn().mockRejectedValue(new Error('fail')),
             stop: vi.fn(),
             on: vi.fn(),
             getVoices: vi.fn(),
             preload: vi.fn(),
             pause: vi.fn(),
             // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;

        manager.setProvider(failingProvider);

        const switchSpy = vi.spyOn(manager, 'switchToLocal');

        await manager.play('text', { voiceId: 'v', speed: 1 });

        expect(switchSpy).toHaveBeenCalled();
        expect(events.onError).toHaveBeenCalledWith(expect.objectContaining({ type: 'fallback' }));
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TTSProviderManager } from './TTSProviderManager';

// Mock Capacitor
vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: vi.fn(() => false),
        getPlatform: vi.fn(() => 'web')
    }
}));

// Mock Providers
const mockProviderOn = vi.fn();
const mockProviderInit = vi.fn();
const mockProviderPlay = vi.fn();
const mockProviderStop = vi.fn();

class MockProvider {
    id = 'mock';
    on = mockProviderOn;
    init = mockProviderInit;
    play = mockProviderPlay;
    stop = mockProviderStop;
    pause = vi.fn();
    getVoices = vi.fn();
    preload = vi.fn();
}

// Correctly mock the constructors
vi.mock('./providers/WebSpeechProvider', () => {
    return {
        WebSpeechProvider: class {
            constructor() { return new MockProvider(); }
        }
    };
});
vi.mock('./providers/CapacitorTTSProvider', () => {
    return {
        CapacitorTTSProvider: class {
            constructor() { return new MockProvider(); }
        }
    };
});

describe('TTSProviderManager', () => {
    let manager: TTSProviderManager;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let events: any;

    beforeEach(() => {
        vi.clearAllMocks();
        events = {
            onStart: vi.fn(),
            onEnd: vi.fn(),
            onError: vi.fn(),
            onTimeUpdate: vi.fn(),
            onBoundary: vi.fn(),
            onMeta: vi.fn(),
            onDownloadProgress: vi.fn(),
        };
        manager = new TTSProviderManager(events);
    });

    it('should initialize with correct provider', () => {
        expect(manager).toBeDefined();
        expect(mockProviderOn).toHaveBeenCalled();
    });

    it('should proxy play calls', async () => {
        await manager.play('text', { voiceId: 'v1', speed: 1 });
        expect(mockProviderPlay).toHaveBeenCalledWith('text', { voiceId: 'v1', speed: 1 });
    });

    it('should handle events correctly', () => {
        // Retrieve the callback passed to provider.on
        // mockProviderOn is called in constructor.
        const callback = mockProviderOn.mock.calls[0][0];

        // Simulate start event
        callback({ type: 'start' });
        expect(events.onStart).toHaveBeenCalled();

        // Simulate end event
        callback({ type: 'end' });
        expect(events.onEnd).toHaveBeenCalled();
    });

    it('should handle cloud fallback', async () => {
        // Setup manager with a cloud provider (mocked by forcing id='cloud')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (manager as any).provider.id = 'cloud';

        // Retrieve the callback (still from the original provider attached in constructor)
        const callback = mockProviderOn.mock.calls[0][0];

        // Simulate error
        callback({ type: 'error', error: 'Network Error' });

        expect(events.onError).toHaveBeenCalledWith(expect.objectContaining({ type: 'fallback' }));
        expect(mockProviderStop).toHaveBeenCalled();
    });
});

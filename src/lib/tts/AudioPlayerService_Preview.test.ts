import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';

// Mock WebSpeechProvider
vi.mock('./providers/WebSpeechProvider', () => {
    return {
        WebSpeechProvider: class {
            id = 'local';
            init = vi.fn();
            getVoices = vi.fn().mockResolvedValue([]);
            synthesize = vi.fn().mockReturnValue({ isNative: true });
            on = vi.fn();
            stop = vi.fn();
            pause = vi.fn();
            resume = vi.fn();
        }
    };
});

// Mock AudioElementPlayer
vi.mock('./AudioElementPlayer', () => {
    return {
        AudioElementPlayer: class {
            playBlob = vi.fn().mockResolvedValue(undefined);
            setRate = vi.fn();
            setOnEnded = vi.fn();
            setOnError = vi.fn();
            setOnTimeUpdate = vi.fn();
            stop = vi.fn();
        }
    };
});

// Mock other dependencies
vi.mock('./CostEstimator', () => ({
    CostEstimator: {
        getInstance: () => ({ track: vi.fn() })
    }
}));

vi.mock('./LexiconService', () => ({
    LexiconService: {
        getInstance: () => ({
             getRules: vi.fn().mockResolvedValue([]),
             applyLexicon: vi.fn().mockImplementation((t) => t),
             getRulesHash: vi.fn().mockResolvedValue('hash')
        })
    }
}));

vi.mock('./MediaSessionManager', () => ({
    MediaSessionManager: class {
        setMetadata = vi.fn();
        setPlaybackState = vi.fn();
        setPositionState = vi.fn();
    }
}));

vi.mock('../../db/DBService', () => ({
    dbService: {
        updatePlaybackState: vi.fn(),
        getBookMetadata: vi.fn().mockResolvedValue(null)
    }
}));

describe('AudioPlayerService Preview', () => {
    let service: AudioPlayerService;
    let mockProvider: any;

    beforeEach(() => {
        // Reset Singleton
        // @ts-ignore
        AudioPlayerService.instance = undefined;
        vi.clearAllMocks();

        service = AudioPlayerService.getInstance();
        // Access the private provider instance directly
        mockProvider = service['provider'];
    });

    it('should handle preview correctly with local provider', async () => {
        const text = 'Preview text';
        const listener = vi.fn();
        service.subscribe(listener);

        // Initial state
        expect(service['status']).toBe('stopped');

        await service.preview(text);

        expect(mockProvider.synthesize).toHaveBeenCalledWith(text, '', 1.0, expect.any(AbortSignal));
        expect(service['status']).toBe('playing');
        expect(service['isPreviewing']).toBe(true);

        // Wait for async events
        await new Promise(r => setTimeout(r, 0));
        listener.mockClear();

        await service.preview(text);

        // During preview:
        // We expect status to be playing at the end
        expect(service['status']).toBe('playing');
        expect(listener).toHaveBeenCalled();
        const calls = listener.mock.calls.map(c => c[0]);
        // Should contain 'playing'
        expect(calls).toContain('playing');
    });

    it('should reset isPreviewing when playback ends (local)', async () => {
         const text = 'Preview text';
         await service.preview(text);

         expect(service['isPreviewing']).toBe(true);

         // Simulate end event from provider
         const onCallback = mockProvider.on.mock.calls[0][0];
         onCallback({ type: 'end' });

         expect(service['isPreviewing']).toBe(false);
         expect(service['status']).toBe('stopped');
    });

    it('should handle rapid preview calls correctly', async () => {
        const text1 = 'Preview 1';
        const text2 = 'Preview 2';

        const p1 = service.preview(text1);
        const p2 = service.preview(text2);

        await Promise.all([p1, p2]);

        // Expect 1 call because the first one should be aborted and return early
        expect(mockProvider.synthesize).toHaveBeenCalledTimes(1);
        expect(service['status']).toBe('playing');
        expect(service['isPreviewing']).toBe(true);
    });
});

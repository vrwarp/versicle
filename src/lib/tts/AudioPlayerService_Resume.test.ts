import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';

// --- Mocks ---

const resumeSpy = vi.fn();
const synthesizeSpy = vi.fn().mockResolvedValue(undefined);
const pauseSpy = vi.fn();
const stopSpy = vi.fn();

vi.mock('./providers/WebSpeechProvider', () => {
  return {
    WebSpeechProvider: class {
      id = 'local';
      init = vi.fn().mockResolvedValue(undefined);
      getVoices = vi.fn().mockResolvedValue([]);
      play = synthesizeSpy;
      stop = stopSpy;
      pause = pauseSpy;
      resume = resumeSpy;
      on = vi.fn();
      preload = vi.fn();
    }
  };
});

// Mock TTSCache
vi.mock('./TTSCache', () => {
  return {
    TTSCache: class {
      generateKey = vi.fn().mockResolvedValue('key');
      get = vi.fn().mockResolvedValue(null);
      put = vi.fn().mockResolvedValue(undefined);
    }
  };
});

// Mock CostEstimator
vi.mock('./CostEstimator', () => {
    return {
        CostEstimator: {
            getInstance: vi.fn(() => ({
                track: vi.fn()
            }))
        }
    }
});

// Mock useTTSStore
vi.mock('../../store/useTTSStore', () => ({
    useTTSStore: {
        getState: vi.fn(() => ({
            lastPauseTime: null,
            setLastPauseTime: vi.fn(),
        }))
    }
}));

// Mock DBService
vi.mock('../../db/DBService', () => ({
  dbService: {
    getBookMetadata: vi.fn().mockResolvedValue({}),
    updatePlaybackState: vi.fn().mockResolvedValue(undefined),
    getTTSState: vi.fn().mockResolvedValue(null),
    saveTTSState: vi.fn(),
    getSections: vi.fn().mockResolvedValue([]),
    getContentAnalysis: vi.fn(),
    getTTSContent: vi.fn(),
    updateReadingHistory: vi.fn(),
  }
}));

describe('AudioPlayerService - Resume Speed Bug', () => {
    let service: AudioPlayerService;

    beforeEach(() => {
        // Reset singleton logic if possible, or just re-get.
        // Since it's a singleton, we need to be careful.
        // The existing test resets it via @ts-expect-error.
        // @ts-expect-error Resetting singleton
        AudioPlayerService.instance = undefined;
        service = AudioPlayerService.getInstance();

        // Clear spies
        resumeSpy.mockClear();
        synthesizeSpy.mockClear();
        pauseSpy.mockClear();
        stopSpy.mockClear();
    });

    it('restarts the sentence with new speed if speed changes while paused', async () => {
        // 1. Setup queue and play
        await service.setQueue([{ text: "Sentence 1", cfi: "cfi1" }]);

        await service.play();
        expect(synthesizeSpy).toHaveBeenCalledTimes(1);
        // Default speed is 1.0
        expect(synthesizeSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ speed: 1.0 }));

        // 2. Pause
        await service.pause();
        expect(pauseSpy).toHaveBeenCalled();
        // @ts-expect-error Check status
        expect(service.status).toBe('paused');

        // 3. Change speed while paused
        await service.setSpeed(2.0);

        // 4. Resume
        await service.resume();

        // 5. Verify behavior
        // It should call synthesizeSpy() with speed 2.0 because speed changed
        expect(synthesizeSpy).toHaveBeenCalledTimes(2);
        expect(synthesizeSpy).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ speed: 2.0 }));
        expect(resumeSpy).not.toHaveBeenCalled();
    });
});

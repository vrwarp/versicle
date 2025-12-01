import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioPlayerService } from './AudioPlayerService';

// --- Mocks ---

const resumeSpy = vi.fn();
const synthesizeSpy = vi.fn().mockResolvedValue({ isNative: true });
const pauseSpy = vi.fn();
const stopSpy = vi.fn();

vi.mock('./providers/WebSpeechProvider', () => {
  return {
    WebSpeechProvider: class {
      id = 'local';
      init = vi.fn().mockResolvedValue(undefined);
      getVoices = vi.fn().mockResolvedValue([]);
      synthesize = synthesizeSpy;
      stop = stopSpy;
      pause = pauseSpy;
      resume = resumeSpy;
      on = vi.fn();
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
        service.setQueue([{ text: "Sentence 1", cfi: "cfi1" }]);

        await service.play();
        expect(synthesizeSpy).toHaveBeenCalledTimes(1);
        // Default speed is 1.0
        expect(synthesizeSpy).toHaveBeenCalledWith(expect.any(String), expect.any(String), 1.0);

        // 2. Pause
        service.pause();
        expect(pauseSpy).toHaveBeenCalled();
        // @ts-expect-error Check status
        expect(service.status).toBe('paused');

        // 3. Change speed while paused
        service.setSpeed(2.0);

        // 4. Resume
        await service.resume();

        // 5. Verify behavior
        // BUG: Currently it calls resumeSpy() and NOT synthesizeSpy()
        // EXPECTED FIX: It should call synthesizeSpy() with speed 2.0

        if (synthesizeSpy.mock.calls.length > 1) {
            // It called synthesize again
            const lastCall = synthesizeSpy.mock.calls[synthesizeSpy.mock.calls.length - 1];
            expect(lastCall[2]).toBe(2.0);
            console.log("Passed: Synthesize called with new speed.");
        } else {
            console.log("Failed: Synthesize NOT called. Called resumeSpy instead.");
            expect(resumeSpy).toHaveBeenCalled();
        }

        // Use standard expect to fail the test until fixed
        expect(synthesizeSpy).toHaveBeenCalledTimes(2);
        expect(synthesizeSpy.mock.calls[1][2]).toBe(2.0);
    });
});

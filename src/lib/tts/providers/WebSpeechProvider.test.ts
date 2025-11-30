import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSpeechProvider } from './WebSpeechProvider';

describe('WebSpeechProvider', () => {
  let provider: WebSpeechProvider;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockSynth: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockUtterance: any;

  beforeEach(() => {
    mockSynth = {
      getVoices: vi.fn().mockReturnValue([]),
      speak: vi.fn(),
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      paused: false,
      speaking: false,
    };

    mockUtterance = {
        voice: null,
        rate: 1,
        onstart: null,
        onend: null,
        onerror: null,
        onboundary: null
    };

    global.window.speechSynthesis = mockSynth;

    // Mock SpeechSynthesisUtterance constructor using a regular function so it can be new-ed
    global.SpeechSynthesisUtterance = vi.fn(function() {
        return mockUtterance;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

    provider = new WebSpeechProvider();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('init', () => {
    it('should resolve immediately if voices are already loaded', async () => {
      mockSynth.getVoices.mockReturnValue([{ name: 'Voice 1', lang: 'en-US' }]);
      await provider.init();
      expect(mockSynth.getVoices).toHaveBeenCalled();
    });

    it('should wait for onvoiceschanged if voices are not loaded', async () => {
       mockSynth.getVoices.mockReturnValueOnce([]).mockReturnValueOnce([{ name: 'Voice 1' }]);

       const initPromise = provider.init();

       // simulate voices changed
       if (mockSynth.onvoiceschanged) {
           mockSynth.onvoiceschanged();
       } else {
           // If onvoiceschanged wasn't set (because sync call returned voices?), but here we mocked [] first.
           // The implementation checks voices.length immediately.
           // If 0, it sets onvoiceschanged.
       }

       await initPromise;
       expect(mockSynth.getVoices).toHaveBeenCalled();
    });
  });

  describe('getVoices', () => {
      it('should return formatted voices', async () => {
          const rawVoices = [{ name: 'Voice 1', lang: 'en-US' }];
          mockSynth.getVoices.mockReturnValue(rawVoices);

          const voices = await provider.getVoices();
          expect(voices).toEqual([{
              id: 'Voice 1',
              name: 'Voice 1',
              lang: 'en-US',
              provider: 'local',
              originalVoice: rawVoices[0]
          }]);
      });
  });

  describe('synthesize', () => {
      it('should speak and emit events', async () => {
          const rawVoices = [{ name: 'Voice 1', lang: 'en-US' }];
          mockSynth.getVoices.mockReturnValue(rawVoices);
          await provider.init();

          const callback = vi.fn();
          provider.on(callback);

          const result = await provider.synthesize('test text', 'Voice 1', 1.5);

          expect(mockSynth.cancel).toHaveBeenCalled();
          expect(global.SpeechSynthesisUtterance).toHaveBeenCalledWith('test text');
          expect(mockUtterance.voice).toBe(rawVoices[0]);
          expect(mockUtterance.rate).toBe(1.5);
          expect(mockSynth.speak).toHaveBeenCalledWith(mockUtterance);
          expect(result).toEqual({ isNative: true });

          // Test events
          if (mockUtterance.onstart) mockUtterance.onstart();
          expect(callback).toHaveBeenCalledWith({ type: 'start' });

          if (mockUtterance.onend) mockUtterance.onend();
          expect(callback).toHaveBeenCalledWith({ type: 'end' });
      });

      it('should handle errors', async () => {
          const rawVoices = [{ name: 'Voice 1', lang: 'en-US' }];
          mockSynth.getVoices.mockReturnValue(rawVoices);
          await provider.init();

          const callback = vi.fn();
          provider.on(callback);

          await provider.synthesize('text', 'Voice 1', 1.0);

          const errorEvent = { error: 'some error' };
          if (mockUtterance.onerror) mockUtterance.onerror(errorEvent);

          expect(callback).toHaveBeenCalledWith({ type: 'error', error: errorEvent });
      });
  });

  describe('playback controls', () => {
      it('stop should cancel synthesis', () => {
          provider.stop();
          expect(mockSynth.cancel).toHaveBeenCalled();
      });

      it('pause should pause synthesis if speaking', () => {
          mockSynth.speaking = true;
          provider.pause();
          expect(mockSynth.pause).toHaveBeenCalled();
      });

      it('resume should resume synthesis if paused', () => {
          mockSynth.paused = true;
          provider.resume();
          expect(mockSynth.resume).toHaveBeenCalled();
      });
  });
});

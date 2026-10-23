import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSpeechProvider } from './WebSpeechProvider';

describe('WebSpeechProvider', () => {
  let provider: WebSpeechProvider;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockSynth: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockUtterance: any;

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    const listeners: Record<string, Function[]> = {};

    mockSynth = {
      getVoices: vi.fn().mockReturnValue([]),
      speak: vi.fn(),
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      paused: false,
      speaking: false,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
      addEventListener: vi.fn((event: string, callback: Function) => {
         if (!listeners[event]) listeners[event] = [];
         listeners[event].push(callback);
      }),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
      removeEventListener: vi.fn((event: string, callback: Function) => {
         if (listeners[event]) {
             listeners[event] = listeners[event].filter(cb => cb !== callback);
         }
      }),
      // Helper to trigger events
      dispatchEvent: (event: string) => {
          if (listeners[event]) {
              listeners[event].forEach(cb => cb());
          }
      }
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

    it('should resolve on timeout if voices never load', async () => {
      vi.useFakeTimers();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const initPromise = provider.init();
      vi.runAllTimers();
      await initPromise;
      expect(console.warn).toHaveBeenCalledWith('WebSpeechProvider: Voice loading timed out or no voices available.');
      vi.useRealTimers();
    });

    it('should wait for onvoiceschanged if voices are not loaded', async () => {
       mockSynth.getVoices.mockReturnValueOnce([]).mockReturnValueOnce([{ name: 'Voice 1' }]);

       const initPromise = provider.init();

       // simulate voices changed using dispatchEvent helper
       mockSynth.dispatchEvent('voiceschanged');

       await initPromise;
       expect(mockSynth.getVoices).toHaveBeenCalled();
       expect(mockSynth.addEventListener).toHaveBeenCalledWith('voiceschanged', expect.any(Function));
       expect(mockSynth.removeEventListener).toHaveBeenCalledWith('voiceschanged', expect.any(Function));
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
              provider: 'local'
          }]);
      });
  });

  describe('play', () => {
      it('should speak and emit events', async () => {
          const rawVoices = [{ name: 'Voice 1', lang: 'en-US' }];
          mockSynth.getVoices.mockReturnValue(rawVoices);
          await provider.init();

          const callback = vi.fn();
          provider.on(callback);

          const playPromise = provider.play('test text', { voiceId: 'Voice 1', speed: 1.5 });

          // Verify setup before resolution
          expect(mockSynth.cancel).toHaveBeenCalled();
          expect(global.SpeechSynthesisUtterance).toHaveBeenCalledWith('test text');
          expect(mockUtterance.voice).toBe(rawVoices[0]);
          expect(mockUtterance.rate).toBe(1.5);
          expect(mockSynth.speak).toHaveBeenCalledWith(mockUtterance);

          // Trigger onstart to resolve promise
          if (mockUtterance.onstart) mockUtterance.onstart();

          await expect(playPromise).resolves.toBeUndefined();
          expect(callback).toHaveBeenCalledWith({ type: 'start' });

          // Test events
          if (mockUtterance.onend) mockUtterance.onend();
          expect(callback).toHaveBeenCalledWith({ type: 'end' });
      });

      it('rejects a failure to start through the promise ONLY (single-shot, 5a-PR2)', async () => {
          const rawVoices = [{ name: 'Voice 1', lang: 'en-US' }];
          mockSynth.getVoices.mockReturnValue(rawVoices);
          await provider.init();

          const callback = vi.fn();
          provider.on(callback);

          const playPromise = provider.play('text', { voiceId: 'Voice 1', speed: 1.0 });

          const errorEvent = { error: 'some error' };
          if (mockUtterance.onerror) mockUtterance.onerror(errorEvent);

          // The rejection is the one and only signal for a start failure — a
          // double-signal would make the engine's fallback fire twice.
          await expect(playPromise).rejects.toThrow('SpeechSynthesisError: some error');
          expect(callback).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
      });

      it('emits mid-playback failures (after start) as an error event', async () => {
          const rawVoices = [{ name: 'Voice 1', lang: 'en-US' }];
          mockSynth.getVoices.mockReturnValue(rawVoices);
          await provider.init();

          const callback = vi.fn();
          provider.on(callback);

          const playPromise = provider.play('text', { voiceId: 'Voice 1', speed: 1.0 });
          if (mockUtterance.onstart) mockUtterance.onstart();
          await playPromise;

          const errorEvent = { error: 'audio-hardware', type: 'error' };
          if (mockUtterance.onerror) mockUtterance.onerror(errorEvent);

          expect(callback).toHaveBeenCalledWith({
              type: 'error',
              error: {
                  error: 'audio-hardware',
                  message: 'SpeechSynthesisError: audio-hardware',
                  type: 'error',
              },
          });
      });
  });

  describe('regression: playEarcon on a suspended context', () => {
      it('resumes once and swallows a rejected resume() (no unhandled rejection)', async () => {
          const resume = vi.fn().mockRejectedValue(new Error('InvalidStateError'));
          const ctx = {
              state: 'suspended',
              currentTime: 0,
              resume,
              close: vi.fn().mockResolvedValue(undefined),
              destination: {},
              createOscillator: vi.fn(() => ({
                  type: 'sine',
                  frequency: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
                  connect: vi.fn(),
                  start: vi.fn(),
                  stop: vi.fn(),
                  onended: null,
              })),
              createGain: vi.fn(() => ({
                  gain: {
                      setValueAtTime: vi.fn(),
                      linearRampToValueAtTime: vi.fn(),
                      exponentialRampToValueAtTime: vi.fn(),
                      setTargetAtTime: vi.fn(),
                      cancelScheduledValues: vi.fn(),
                  },
                  connect: vi.fn(),
                  disconnect: vi.fn(),
              })),
          };
          vi.stubGlobal('AudioContext', vi.fn(function () { return ctx; }));
          try {
              provider.playEarcon('bookmark_captured');
              // Let the rejected promise settle; an unswallowed rejection fails the run.
              await new Promise((r) => setTimeout(r, 0));
              expect(resume).toHaveBeenCalledTimes(1);
          } finally {
              vi.unstubAllGlobals();
          }
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

      it('dispose cancels synthesis and detaches listeners (no events after dispose)', async () => {
          mockSynth.getVoices.mockReturnValue([{ name: 'Voice 1', lang: 'en-US' }]);
          await provider.init();

          const events: string[] = [];
          provider.on((e) => events.push(e.type));

          provider.dispose();
          expect(mockSynth.cancel).toHaveBeenCalled();

          // Driving the (now-detached) provider must not reach the listener.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (provider as any).emit({ type: 'start' });
          expect(events).toEqual([]);
      });
  });
});

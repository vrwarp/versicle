import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSpeechProvider } from './WebSpeechProvider';

describe('WebSpeechProvider', () => {
  let provider: WebSpeechProvider;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockSynth: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockUtterance: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockAudio: any;

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

    // Mock Audio
    mockAudio = {
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
        currentTime: 0,
        loop: false,
        paused: true
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.Audio = vi.fn(function() { return mockAudio; }) as any;

    provider = new WebSpeechProvider();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('Watchdog', () => {
      beforeEach(() => {
          vi.useFakeTimers();
      });

      it('should trigger error if no event received within timeout', async () => {
          const rawVoices = [{ name: 'Voice 1', lang: 'en-US' }];
          mockSynth.getVoices.mockReturnValue(rawVoices);
          await provider.init();

          const callback = vi.fn();
          provider.on(callback);

          await provider.synthesize('test text', 'Voice 1', 1.0);

          // Simulate start event to start watchdog
          if (mockUtterance.onstart) mockUtterance.onstart();

          // Clear calls to ignore 'start'
          callback.mockClear();

          // Advance time past watchdog timeout (5000ms)
          vi.advanceTimersByTime(5001);

          // Expect error emitted
          // The error object might be wrapped differently or just match object equality
          const errorCall = callback.mock.calls.find(args => args[0].type === 'error');
          expect(errorCall).toBeDefined();
          // The emit payload is { type: 'error', error: { error: 'watchdog_timeout' } }
          // Or is it? Let's check the code: emit('error', { error: 'watchdog_timeout' })
          // The code does: this.emit('error', { error: 'watchdog_timeout' });
          // The emit method: callback({ type, ...data });
          // So it becomes { type: 'error', error: 'watchdog_timeout' }.
          // NOT { type: 'error', error: { error: 'watchdog_timeout' } }.
          expect(errorCall![0].error).toBe('watchdog_timeout');

          // Expect synthesis to be cancelled
          expect(mockSynth.cancel).toHaveBeenCalled();
      });

      it('should reset watchdog on boundary event', async () => {
          const rawVoices = [{ name: 'Voice 1', lang: 'en-US' }];
          mockSynth.getVoices.mockReturnValue(rawVoices);
          await provider.init();

          const callback = vi.fn();
          provider.on(callback);

          await provider.synthesize('test text', 'Voice 1', 1.0);

          if (mockUtterance.onstart) mockUtterance.onstart();

          // Advance time partially
          vi.advanceTimersByTime(4000);

          // Trigger boundary
          if (mockUtterance.onboundary) mockUtterance.onboundary({ charIndex: 5 });

          // Advance time again, but total from start > 5000, but < 5000 from boundary
          vi.advanceTimersByTime(2000);

          // Expect no error yet
          const errorCalls = callback.mock.calls.filter(args => args[0].type === 'error');
          expect(errorCalls.length).toBe(0);

          // Clear previous calls (start, boundary) to make assertion cleaner or just check specific call
          callback.mockClear();

          // Advance past new timeout
          vi.advanceTimersByTime(3001);

          const errorCall2 = callback.mock.calls.find(args => args[0].type === 'error');
          expect(errorCall2).toBeDefined();
          expect(errorCall2![0].error).toBe('watchdog_timeout');
      });

      it('should stop watchdog on end event', async () => {
          const rawVoices = [{ name: 'Voice 1', lang: 'en-US' }];
          mockSynth.getVoices.mockReturnValue(rawVoices);
          await provider.init();

          const callback = vi.fn();
          provider.on(callback);

          await provider.synthesize('test text', 'Voice 1', 1.0);

          if (mockUtterance.onstart) mockUtterance.onstart();

          // Trigger end
          if (mockUtterance.onend) mockUtterance.onend();

          // Advance time well past timeout
          vi.advanceTimersByTime(10000);

          // Expect no error
          const errorCalls = callback.mock.calls.filter(args => args[0].type === 'error');
          expect(errorCalls.length).toBe(0);
      });
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

          // Check silent audio
          expect(mockAudio.play).toHaveBeenCalled();

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
          expect(mockAudio.pause).toHaveBeenCalled();
      });
  });

  describe('playback controls', () => {
      it('stop should cancel synthesis and pause silent audio', () => {
          provider.stop();
          expect(mockSynth.cancel).toHaveBeenCalled();
          expect(mockAudio.pause).toHaveBeenCalled();
      });

      it('pause should pause synthesis and silent audio if speaking', () => {
          mockSynth.speaking = true;
          provider.pause();
          expect(mockSynth.pause).toHaveBeenCalled();
          expect(mockAudio.pause).toHaveBeenCalled();
      });

      it('resume should resume synthesis and silent audio if paused', () => {
          mockSynth.paused = true;
          mockAudio.paused = true;
          provider.resume();
          expect(mockSynth.resume).toHaveBeenCalled();
          expect(mockAudio.play).toHaveBeenCalled();
      });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BackgroundAudio } from './BackgroundAudio';

describe('BackgroundAudio', () => {
  let backgroundAudio: BackgroundAudio;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockAudio: any;

  beforeEach(() => {
    vi.useFakeTimers();
    // Mock Audio
    mockAudio = {
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
        currentTime: 0,
        loop: false,
        paused: true,
        volume: 1,
        src: '',
        getAttribute: vi.fn((attr) => {
             if (attr === 'src') return mockAudio.src;
             return null;
        }),
        load: vi.fn()
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.Audio = vi.fn(function() { return mockAudio; }) as any;

    backgroundAudio = new BackgroundAudio();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('play', () => {
      it('should play silence when mode is silence', () => {
          backgroundAudio.play('silence');
          expect(mockAudio.src).toContain('silence');
          expect(mockAudio.play).toHaveBeenCalled();
          expect(mockAudio.loop).toBe(true);
      });

      it('should play noise when mode is noise', () => {
          backgroundAudio.play('noise');
          expect(mockAudio.src).toContain('white-noise');
          expect(mockAudio.play).toHaveBeenCalled();
      });

      it('should stop when mode is off', () => {
          mockAudio.paused = false;
          backgroundAudio.play('off');
          expect(mockAudio.pause).toHaveBeenCalled();
          expect(mockAudio.currentTime).toBe(0);
      });

      it('should switch tracks if mode changes', () => {
          backgroundAudio.play('silence');
          expect(mockAudio.src).toContain('silence');

          backgroundAudio.play('noise');
          expect(mockAudio.src).toContain('white-noise');
      });

      it('should not restart if mode is same and already playing', () => {
          backgroundAudio.play('silence');
          mockAudio.play.mockClear();
          mockAudio.paused = false;

          backgroundAudio.play('silence');
          expect(mockAudio.play).not.toHaveBeenCalled();
      });

       it('should cancel pending debounce when play is called', () => {
          backgroundAudio.stopWithDebounce(1000);
          backgroundAudio.play('silence');

          vi.advanceTimersByTime(1500);
          expect(mockAudio.pause).not.toHaveBeenCalled();
      });
  });

  describe('stopWithDebounce', () => {
      it('should delay stop', () => {
          backgroundAudio.play('silence');
          mockAudio.play.mockClear();
          mockAudio.paused = false;

          backgroundAudio.stopWithDebounce(500);
          expect(mockAudio.pause).not.toHaveBeenCalled();

          vi.advanceTimersByTime(501);
          expect(mockAudio.pause).toHaveBeenCalled();
      });
  });

  describe('forceStop', () => {
      it('should stop immediately', () => {
          backgroundAudio.play('silence');
          backgroundAudio.forceStop();
          expect(mockAudio.pause).toHaveBeenCalled();
          expect(mockAudio.currentTime).toBe(0);
      });

      it('should cancel pending debounce', () => {
          backgroundAudio.stopWithDebounce(1000);
          backgroundAudio.forceStop();
          mockAudio.pause.mockClear();

          vi.advanceTimersByTime(1500);
          expect(mockAudio.pause).not.toHaveBeenCalled();
      });
  });

  describe('setVolume', () => {
      it('should set volume for white noise', () => {
          backgroundAudio.setVolume(0.5);
          backgroundAudio.play('noise');
          expect(mockAudio.volume).toBe(0.5);
      });

      it('should ignore volume for silence', () => {
          backgroundAudio.setVolume(0.5);
          backgroundAudio.play('silence');
          expect(mockAudio.volume).toBe(1.0);
      });

      it('should update volume if already playing noise', () => {
            backgroundAudio.play('noise');
            backgroundAudio.setVolume(0.2);
            expect(mockAudio.volume).toBe(0.2);
      });
  });
});

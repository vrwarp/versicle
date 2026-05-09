import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BackgroundAudio } from './BackgroundAudio';

describe('BackgroundAudio', () => {
  let backgroundAudio: BackgroundAudio;
  let mockAudio1: any;
  let mockAudio2: any;

  beforeEach(() => {
    vi.useFakeTimers();
    // Mock Audio
    const createMockAudio = () => ({
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
        currentTime: 0,
        loop: false,
        paused: true,
        volume: 1,
        src: '',
        getAttribute: vi.fn(function(this: any, attr) {
             if (attr === 'src') return this.src;
             return null;
        }),
        load: vi.fn(),
        error: null
    });
    mockAudio1 = createMockAudio();
    mockAudio2 = createMockAudio();
    
    let callCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.Audio = vi.fn(function() { 
        callCount++;
        return callCount === 1 ? mockAudio1 : mockAudio2;
    }) as any;

    backgroundAudio = new BackgroundAudio();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('play', () => {
      it('should play silence when mode is silence', () => {
          backgroundAudio.play('silence');
          expect(mockAudio1.src).toContain('silence');
          expect(mockAudio1.play).toHaveBeenCalled();
          expect(mockAudio1.loop).toBe(true);

          expect(mockAudio2.play).not.toHaveBeenCalled();
          vi.advanceTimersByTime(5000);
          expect(mockAudio2.play).toHaveBeenCalled();
      });

      it('should play noise when mode is noise', () => {
          backgroundAudio.play('noise');
          expect(mockAudio1.src).toContain('sub_bass');
          expect(mockAudio1.play).toHaveBeenCalled();
          
          expect(mockAudio2.play).not.toHaveBeenCalled();
          vi.advanceTimersByTime(5000);
          expect(mockAudio2.play).toHaveBeenCalled();
      });

      it('should stop when mode is off', () => {
          mockAudio1.paused = false;
          backgroundAudio.play('off');
          expect(mockAudio1.pause).toHaveBeenCalled();
          expect(mockAudio2.pause).toHaveBeenCalled();
          expect(mockAudio1.currentTime).toBe(0);
      });

      it('should switch tracks if mode changes', () => {
          backgroundAudio.play('silence');
          expect(mockAudio1.src).toContain('silence');

          backgroundAudio.play('noise');
          expect(mockAudio1.src).toContain('sub_bass');
          expect(mockAudio2.src).toContain('sub_bass');
      });

      it('should not restart if mode is same and already playing', () => {
          backgroundAudio.play('silence');
          mockAudio1.play.mockClear();
          mockAudio1.paused = false;

          backgroundAudio.play('silence');
          expect(mockAudio1.play).not.toHaveBeenCalled();
      });

       it('should cancel pending debounce when play is called', () => {
          backgroundAudio.stopWithDebounce(1000);
          backgroundAudio.play('silence');

          vi.advanceTimersByTime(1500);
          expect(mockAudio1.pause).not.toHaveBeenCalled();
      });
  });

  describe('stopWithDebounce', () => {
      it('should delay stop', () => {
          backgroundAudio.play('silence');
          mockAudio1.play.mockClear();
          mockAudio1.paused = false;

          backgroundAudio.stopWithDebounce(500);
          expect(mockAudio1.pause).not.toHaveBeenCalled();

          vi.advanceTimersByTime(501);
          expect(mockAudio1.pause).toHaveBeenCalled();
          expect(mockAudio2.pause).toHaveBeenCalled();
      });
  });

  describe('forceStop', () => {
      it('should stop immediately', () => {
          backgroundAudio.play('silence');
          backgroundAudio.forceStop();
          expect(mockAudio1.pause).toHaveBeenCalled();
          expect(mockAudio2.pause).toHaveBeenCalled();
          expect(mockAudio1.currentTime).toBe(0);
      });

      it('should cancel pending debounce', () => {
          backgroundAudio.stopWithDebounce(1000);
          backgroundAudio.forceStop();
          mockAudio1.pause.mockClear();

          vi.advanceTimersByTime(1500);
          expect(mockAudio1.pause).not.toHaveBeenCalled();
      });
  });

  describe('setVolume', () => {
      it('should set volume for white noise', () => {
          backgroundAudio.setVolume(0.5);
          backgroundAudio.play('noise');
          expect(mockAudio1.volume).toBe(0.125);
          expect(mockAudio2.volume).toBe(0.125);
      });

      it('should ignore volume for silence', () => {
          backgroundAudio.setVolume(0.5);
          backgroundAudio.play('silence');
          expect(mockAudio1.volume).toBe(1.0);
          expect(mockAudio2.volume).toBe(1.0);
      });

      it('should update volume if already playing noise', () => {
            backgroundAudio.play('noise');
            backgroundAudio.setVolume(0.2);
            expect(mockAudio1.volume).toBeCloseTo(0.008);
            expect(mockAudio2.volume).toBeCloseTo(0.008);
      });
  });
});

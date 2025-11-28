
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioElementPlayer } from './AudioElementPlayer';

describe('AudioElementPlayer', () => {
  let player: AudioElementPlayer;
  let mockAudio: any;

  beforeEach(() => {
    mockAudio = {
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      src: '',
      currentTime: 0,
      volume: 1,
      playbackRate: 1,
      ontimeupdate: null,
      onended: null,
      onerror: null,
      duration: 100,
    };

    // Stub Global Audio with a class-like function
    vi.stubGlobal('Audio', class {
        constructor() {
            return mockAudio;
        }
    });

    if (!global.URL) {
        global.URL = { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() } as any;
    } else {
        global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    }

    player = new AudioElementPlayer();
  });

  it('should play a blob', async () => {
    const blob = new Blob(['test'], { type: 'audio/wav' });
    await player.playBlob(blob);
    expect(mockAudio.src).toBe('blob:mock-url');
    expect(mockAudio.play).toHaveBeenCalled();
  });

  it('should play a url', async () => {
    const url = 'http://example.com/audio.mp3';
    await player.playUrl(url);
    expect(mockAudio.src).toBe(url);
    expect(mockAudio.play).toHaveBeenCalled();
  });

  it('should pause', () => {
    player.pause();
    expect(mockAudio.pause).toHaveBeenCalled();
  });

  it('should resume', async () => {
    await player.resume();
    expect(mockAudio.play).toHaveBeenCalled();
  });

  it('should stop', () => {
    player.stop();
    expect(mockAudio.pause).toHaveBeenCalled();
    expect(mockAudio.currentTime).toBe(0);
  });

  it('should set volume', () => {
    player.setVolume(0.5);
    expect(mockAudio.volume).toBe(0.5);
  });

  it('should set playback rate', () => {
    player.setRate(1.5);
    expect(mockAudio.playbackRate).toBe(1.5);
  });

  it('should handle time updates', () => {
      const callback = vi.fn();
      player.setOnTimeUpdate(callback);

      // Simulate time update
      mockAudio.currentTime = 10;
      if (mockAudio.ontimeupdate) {
          mockAudio.ontimeupdate(new Event('timeupdate'));
      }

      expect(callback).toHaveBeenCalledWith(10);
  });

  it('should handle ended event', () => {
      const callback = vi.fn();
      player.setOnEnded(callback);

      if (mockAudio.onended) {
          mockAudio.onended(new Event('ended'));
      }

      expect(callback).toHaveBeenCalled();
  });
});

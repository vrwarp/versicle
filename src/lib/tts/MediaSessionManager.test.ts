import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { MediaSessionManager } from './MediaSessionManager';

// Mock Capacitor
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(),
  },
}));

describe('MediaSessionManager', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mediaSessionMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let callbacks: any;

  beforeEach(() => {
    callbacks = {
      onPlay: vi.fn(),
      onPause: vi.fn(),
      onStop: vi.fn(),
      onPrev: vi.fn(),
      onNext: vi.fn(),
      onSeekBackward: vi.fn(),
      onSeekForward: vi.fn(),
    };

    mediaSessionMock = {
      setActionHandler: vi.fn(),
      playbackState: 'none',
      metadata: null,
      setPositionState: vi.fn(),
    };

    // Mock navigator.mediaSession
    vi.stubGlobal('navigator', {
      mediaSession: mediaSessionMock,
    });

    // Mock MediaMetadata constructor
    vi.stubGlobal('MediaMetadata', class {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        constructor(public init: any) {}
    });

    // Reset mocks and setup default implementations
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sets up action handlers on initialization', () => {
    new MediaSessionManager(callbacks);

    expect(mediaSessionMock.setActionHandler).toHaveBeenCalledWith('play', callbacks.onPlay);
    expect(mediaSessionMock.setActionHandler).toHaveBeenCalledWith('pause', callbacks.onPause);
    expect(mediaSessionMock.setActionHandler).toHaveBeenCalledWith('previoustrack', callbacks.onPrev);
    expect(mediaSessionMock.setActionHandler).toHaveBeenCalledWith('nexttrack', callbacks.onNext);
    expect(mediaSessionMock.setActionHandler).toHaveBeenCalledWith('seekbackward', callbacks.onSeekBackward);
    expect(mediaSessionMock.setActionHandler).toHaveBeenCalledWith('seekforward', callbacks.onSeekForward);
  });

  it('updates metadata correctly', () => {
    const manager = new MediaSessionManager(callbacks);
    const metadata = {
        title: 'Test Title',
        artist: 'Test Artist',
        album: 'Test Album',
        artwork: [{ src: 'test.jpg' }],
    };

    manager.setMetadata(metadata);

    expect(mediaSessionMock.metadata).toEqual(expect.objectContaining({
        init: expect.objectContaining({
            title: 'Test Title',
            artist: 'Test Artist',
            album: 'Test Album',
            artwork: [{ src: 'test.jpg' }]
        })
    }));
  });

  it('updates playback state correctly', () => {
    const manager = new MediaSessionManager(callbacks);

    manager.setPlaybackState('playing');
    expect(mediaSessionMock.playbackState).toBe('playing');

    manager.setPlaybackState('paused');
    expect(mediaSessionMock.playbackState).toBe('paused');
  });

  it('updates playback state with object', () => {
      const manager = new MediaSessionManager(callbacks);
      manager.setPlaybackState({ playbackState: 'playing', playbackSpeed: 1.5, position: 10, duration: 100 });

      expect(mediaSessionMock.playbackState).toBe('playing');
      expect(mediaSessionMock.setPositionState).toHaveBeenCalledWith({
          duration: 100,
          playbackRate: 1.5,
          position: 10
      });
  });

  it('handles missing mediaSession gracefully', () => {
    vi.stubGlobal('navigator', {}); // No mediaSession

    const manager = new MediaSessionManager(callbacks);

    // Should not throw
    manager.setMetadata({ title: 'test', artist: 'test', album: 'test' });
    manager.setPlaybackState('playing');
    manager.setPositionState({ duration: 100, position: 10, playbackRate: 1 });
  });

  it('sets position state correctly', () => {
      const manager = new MediaSessionManager(callbacks);
      const state = { duration: 60, playbackRate: 1, position: 30 };

      manager.setPositionState(state);

      expect(mediaSessionMock.setPositionState).toHaveBeenCalledWith(state);
  });
});

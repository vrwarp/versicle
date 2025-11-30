import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MediaSessionManager } from './MediaSessionManager';

describe('MediaSessionManager', () => {
  let mediaSessionMock: any;
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
        constructor(public init: any) {}
    });
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

  it('handles missing mediaSession gracefully', () => {
    vi.stubGlobal('navigator', {}); // No mediaSession

    const manager = new MediaSessionManager(callbacks);

    // Should not throw
    manager.setMetadata({ title: 'test', artist: 'test', album: 'test' });
    manager.setPlaybackState('playing');
    manager.setPositionState({ duration: 100, position: 10 });
  });

  it('handles partial callbacks correctly', () => {
      const partialCallbacks = {
          onPlay: vi.fn()
      };

      new MediaSessionManager(partialCallbacks);

      expect(mediaSessionMock.setActionHandler).toHaveBeenCalledWith('play', partialCallbacks.onPlay);
      // Others should be called with null or undefined (implementation detail: usually we loop through possible actions)
      // The implementation iterates over a list of actions and checks if callback exists.
      // If it exists, it sets it. If not, it sets it to null (clears it).

      expect(mediaSessionMock.setActionHandler).toHaveBeenCalledWith('pause', null);
  });

  it('sets position state correctly', () => {
      const manager = new MediaSessionManager(callbacks);
      const state = { duration: 60, playbackRate: 1, position: 30 };

      manager.setPositionState(state);

      expect(mediaSessionMock.setPositionState).toHaveBeenCalledWith(state);
  });

  it('handles setPositionState errors gracefully', () => {
      mediaSessionMock.setPositionState.mockImplementation(() => {
          throw new Error('Invalid state');
      });
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const manager = new MediaSessionManager(callbacks);
      manager.setPositionState({ duration: 10, position: 20 }); // Invalid

      expect(consoleSpy).toHaveBeenCalledWith("Failed to set MediaSession position state", expect.any(Error));
      consoleSpy.mockRestore();
  });

  it('logs warning for unsupported actions', () => {
      mediaSessionMock.setActionHandler.mockImplementation((action: string) => {
          if (action === 'seekto') throw new Error('Not supported');
      });
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const callbacksWithSeekTo = { ...callbacks, onSeekTo: vi.fn() };
      new MediaSessionManager(callbacksWithSeekTo);

      expect(consoleSpy).toHaveBeenCalledWith("MediaSession action 'seekto' is not supported.");
      consoleSpy.mockRestore();
  });
});

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
  });
});

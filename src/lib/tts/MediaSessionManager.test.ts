import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { MediaSessionManager } from './MediaSessionManager';
import { Capacitor } from '@capacitor/core';
import { MediaSession } from '@jofr/capacitor-media-session';

// Mock Capacitor and MediaSession
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(),
  },
}));

vi.mock('@jofr/capacitor-media-session', () => ({
  MediaSession: {
    setActionHandler: vi.fn(),
    setMetadata: vi.fn(),
    setPlaybackState: vi.fn(),
    setPositionState: vi.fn(),
    addListener: vi.fn(),
  },
}));

describe('MediaSessionManager', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mediaSessionMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let callbacks: any;
  let originalCreateElement: typeof document.createElement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockContext: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockGradient: any;

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
      constructor(public init: any) { }
    });

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true
    });

    // Reset mocks and setup default implementations
    vi.clearAllMocks();
    (MediaSession.setActionHandler as Mock).mockResolvedValue(undefined);
    (MediaSession.setMetadata as Mock).mockResolvedValue(undefined);
    (MediaSession.setPlaybackState as Mock).mockResolvedValue(undefined);
    (MediaSession.setPositionState as Mock).mockResolvedValue(undefined);
    (MediaSession.addListener as Mock).mockResolvedValue({ remove: vi.fn() });

    // --- Mocks for Artwork Processing ---
    // Note: We don't need to mock fetch or URL.createObjectURL anymore since we load Image directly from URL string.

    global.Image = class {
      onload: () => void = () => { };
      onerror: (err: unknown) => void = () => { };
      width = 200;
      height = 100;
      _src = '';
      set src(value: string) {
        this._src = value;
        setTimeout(() => this.onload(), 10);
      }
      get src() { return this._src; }
    } as unknown as typeof Image;

    mockGradient = {
      addColorStop: vi.fn(),
    };

    mockContext = {
      drawImage: vi.fn(),
      createConicGradient: vi.fn(() => mockGradient),
      fillStyle: '',
      fillRect: vi.fn(),
    };
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => mockContext),
      toDataURL: vi.fn(() => 'data:image/jpeg;base64,mocked'),
    };

    originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
      if (tagName === 'canvas') return mockCanvas as unknown as HTMLCanvasElement;
      return originalCreateElement(tagName, options);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('Web Environment', () => {
    beforeEach(() => {
      (Capacitor.isNativePlatform as Mock).mockReturnValue(false);
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

    it('updates metadata correctly with artwork processing', async () => {
      const manager = new MediaSessionManager(callbacks);
      const metadata = {
        title: 'Test Title',
        artist: 'Test Artist',
        album: 'Test Album',
        artwork: [{ src: 'test.jpg' }],
      };

      await manager.setMetadata(metadata);

      expect(mediaSessionMock.metadata).toEqual(expect.objectContaining({
        init: expect.objectContaining({
          title: 'Test Title',
          artist: 'Test Artist',
          album: 'Test Album',
          // Expect processed base64 artwork
          artwork: [{ src: 'data:image/jpeg;base64,mocked', type: 'image/jpeg' }]
        })
      }));
    });

    it('applies conic gradient when section index is provided', async () => {
      const manager = new MediaSessionManager(callbacks);
      const metadata = {
        title: 'Test Title',
        artist: 'Test Artist',
        album: 'Test Album',
        artwork: [{ src: 'test.jpg' }],
        sectionIndex: 0,
        totalSections: 10
      };

      await manager.setMetadata(metadata);

      expect(mockContext.createConicGradient).toHaveBeenCalled();
      expect(mockGradient.addColorStop).toHaveBeenCalled();
      expect(mockContext.fillRect).toHaveBeenCalled();
    });

    it('applies conic gradient when explicit progress is provided', async () => {
      const manager = new MediaSessionManager(callbacks);
      const metadata = {
        title: 'Test Title',
        artist: 'Test Artist',
        album: 'Test Album',
        artwork: [{ src: 'test.jpg' }],
        progress: 0.75
      };

      await manager.setMetadata(metadata);

      // Verify that createConicGradient was called with correct rotation
      expect(mockContext.createConicGradient).toHaveBeenCalledWith(-Math.PI / 2, expect.any(Number), expect.any(Number));

      // Verify that the 'progress' value (0.75) was used in the gradient stops
      expect(mockGradient.addColorStop).toHaveBeenCalledWith(0.75, 'rgba(255, 255, 255, 0.4)');
      expect(mockGradient.addColorStop).toHaveBeenCalledWith(0.751, 'rgba(0, 0, 0, 0)');

      expect(mockContext.fillRect).toHaveBeenCalled();
    });

    it('applies dark/adaptive overlay for white covers', async () => {
      const manager = new MediaSessionManager(callbacks);
      const metadata = {
        title: 'Light Cover',
        artist: 'Artist',
        album: 'Album',
        artwork: [{ src: 'light.jpg' }],
        progress: 0.5,
        coverPalette: [0xFFFF] // Pure White
      };

      await manager.setMetadata(metadata);

      // Verify that dark overlay color was used for this bright cover
      expect(mockGradient.addColorStop).toHaveBeenCalledWith(0.5, 'rgba(0, 0, 0, 0.35)');
      expect(mockGradient.addColorStop).not.toHaveBeenCalledWith(0.5, 'rgba(255, 255, 255, 0.4)');
    });

    it('updates playback state correctly', () => {
      const manager = new MediaSessionManager(callbacks);

      manager.setPlaybackState('playing');
      expect(mediaSessionMock.playbackState).toBe('playing');

      manager.setPlaybackState('paused');
      expect(mediaSessionMock.playbackState).toBe('paused');
    });

    it('handles missing mediaSession gracefully', async () => {
      vi.stubGlobal('navigator', {}); // No mediaSession

      const manager = new MediaSessionManager(callbacks);

      // Should not throw
      await manager.setMetadata({ title: 'test', artist: 'test', album: 'test' });
      manager.setPlaybackState('playing');
      manager.setPositionState({ duration: 100, position: 10 });
    });

    it('sets position state correctly', () => {
      const manager = new MediaSessionManager(callbacks);
      const state = { duration: 60, playbackRate: 1, position: 30 };

      manager.setPositionState(state);

      expect(mediaSessionMock.setPositionState).toHaveBeenCalledWith(state);
    });

  });

  describe('Native Environment', () => {
    beforeEach(() => {
      (Capacitor.isNativePlatform as Mock).mockReturnValue(true);
    });

    it('registers native action handlers with per-action callbacks', async () => {
      new MediaSessionManager(callbacks);
      // Constructor kicks off async registration; let the microtasks settle.
      await new Promise(resolve => setTimeout(resolve, 0));

      // The Media3 fork registers each action with a per-action callback:
      // setActionHandler({ action }, handler).
      expect(MediaSession.setActionHandler).toHaveBeenCalledWith({ action: 'play' }, expect.any(Function));
      expect(MediaSession.setActionHandler).toHaveBeenCalledWith({ action: 'pause' }, expect.any(Function));
      expect(MediaSession.setActionHandler).toHaveBeenCalledWith({ action: 'stop' }, expect.any(Function));
      expect(MediaSession.setActionHandler).toHaveBeenCalledWith({ action: 'nexttrack' }, expect.any(Function));
      expect(MediaSession.setActionHandler).toHaveBeenCalledWith({ action: 'previoustrack' }, expect.any(Function));
      expect(MediaSession.setActionHandler).toHaveBeenCalledWith({ action: 'seekbackward' }, expect.any(Function));
      expect(MediaSession.setActionHandler).toHaveBeenCalledWith({ action: 'seekforward' }, expect.any(Function));
      // No `onSeekTo` callback supplied here, so `seekto` must not be registered.
      expect(MediaSession.setActionHandler).not.toHaveBeenCalledWith({ action: 'seekto' }, expect.any(Function));
    });

    it('dispatches native actions to the matching callbacks', async () => {
      new MediaSessionManager(callbacks);
      await new Promise(resolve => setTimeout(resolve, 0));

      // Pull the per-action handler the manager registered for a given action.
      const handlerFor = (action: string) =>
        (MediaSession.setActionHandler as Mock).mock.calls
          .find(([opts]) => opts.action === action)?.[1] as (d: { action: string; seekTime?: number }) => void;

      handlerFor('play')({ action: 'play' });
      expect(callbacks.onPlay).toHaveBeenCalledTimes(1);

      handlerFor('nexttrack')({ action: 'nexttrack' });
      expect(callbacks.onNext).toHaveBeenCalledTimes(1);

      // Seek details (e.g. seekTime) are forwarded through to the callback.
      handlerFor('seekforward')({ action: 'seekforward', seekTime: 5 });
      expect(callbacks.onSeekForward).toHaveBeenCalledWith({ action: 'seekforward', seekTime: 5 });
    });

    it('registers the "bookmark" custom action only when onBookmark is supplied', async () => {
      // Default callbacks have no onBookmark -> no custom action button.
      new MediaSessionManager(callbacks);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(MediaSession.setActionHandler).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'bookmark' }), expect.any(Function));

      vi.clearAllMocks();
      (MediaSession.setActionHandler as Mock).mockResolvedValue(undefined);
      (MediaSession.addListener as Mock).mockResolvedValue({ remove: vi.fn() });

      const onBookmark = vi.fn();
      new MediaSessionManager({ ...callbacks, onBookmark });
      await new Promise(resolve => setTimeout(resolve, 0));

      // The custom action is published with a label (required to render) + icon.
      expect(MediaSession.setActionHandler).toHaveBeenCalledWith(
        { action: 'bookmark', label: 'Bookmark', icon: 'bookmark' }, expect.any(Function));

      // The registered handler routes a tap to onBookmark.
      const bookmarkHandler = (MediaSession.setActionHandler as Mock).mock.calls
        .find(([opts]) => opts.action === 'bookmark')?.[1] as (d: { action: string }) => void;
      bookmarkHandler({ action: 'bookmark' });
      expect(onBookmark).toHaveBeenCalledTimes(1);
    });

    it('subscribes to the artworkload outcome event', async () => {
      new MediaSessionManager(callbacks);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(MediaSession.addListener).toHaveBeenCalledWith('artworkload', expect.any(Function));
    });

    it('updates native metadata correctly with artwork processing', async () => {
      const manager = new MediaSessionManager(callbacks);
      const metadata = {
        title: 'Native Title',
        artist: 'Native Artist',
        album: 'Native Album',
        artwork: [{ src: 'native.jpg' }],
      };

      await manager.setMetadata(metadata);

      expect(MediaSession.setMetadata).toHaveBeenCalledWith({
        title: 'Native Title',
        artist: 'Native Artist',
        album: 'Native Album',
        // Expect processed base64 artwork
        artwork: [{ src: 'data:image/jpeg;base64,mocked', type: 'image/jpeg' }]
      });
    });

    it('updates native playback state correctly', async () => {
      const manager = new MediaSessionManager(callbacks);

      await manager.setPlaybackState('playing');
      expect(MediaSession.setPlaybackState).toHaveBeenCalledWith({
        playbackState: 'playing',
      });
      // This should NOT be called anymore
      expect(MediaSession.setPositionState).not.toHaveBeenCalled();
    });

    it('updates native position state correctly', async () => {
      const manager = new MediaSessionManager(callbacks);
      const state = { duration: 60, playbackRate: 1, position: 30 };

      manager.setPositionState(state);

      expect(MediaSession.setPositionState).toHaveBeenCalledWith({
        duration: 60,
        playbackRate: 1,
        position: 30
      });
    });
  });
});

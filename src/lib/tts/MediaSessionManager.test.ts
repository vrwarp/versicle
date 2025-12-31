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
        constructor(public init: any) {}
    });

    // Reset mocks and setup default implementations
    vi.clearAllMocks();
    (MediaSession.setActionHandler as Mock).mockResolvedValue(undefined);
    (MediaSession.setMetadata as Mock).mockResolvedValue(undefined);
    (MediaSession.setPlaybackState as Mock).mockResolvedValue(undefined);
    (MediaSession.setPositionState as Mock).mockResolvedValue(undefined);

    // --- Mocks for Artwork Processing ---
    // Note: We don't need to mock fetch or URL.createObjectURL anymore since we load Image directly from URL string.

    global.Image = class {
        onload: () => void = () => {};
        onerror: (err: unknown) => void = () => {};
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

      it('sets up native action handlers on initialization', async () => {
          new MediaSessionManager(callbacks);
          // Constructor is async in effect due to async calls but we can't await it directly.
          await new Promise(resolve => setTimeout(resolve, 0));

          expect(MediaSession.setActionHandler).toHaveBeenCalledWith({ action: 'play' }, callbacks.onPlay);
          expect(MediaSession.setActionHandler).toHaveBeenCalledWith({ action: 'pause' }, callbacks.onPause);
          expect(MediaSession.setActionHandler).toHaveBeenCalledWith({ action: 'stop' }, callbacks.onStop);
          expect(MediaSession.setActionHandler).toHaveBeenCalledWith({ action: 'nexttrack' }, callbacks.onNext);
          expect(MediaSession.setActionHandler).toHaveBeenCalledWith({ action: 'previoustrack' }, callbacks.onPrev);
          expect(MediaSession.setActionHandler).toHaveBeenCalledWith({ action: 'seekbackward' }, callbacks.onSeekBackward);
          expect(MediaSession.setActionHandler).toHaveBeenCalledWith({ action: 'seekforward' }, callbacks.onSeekForward);
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

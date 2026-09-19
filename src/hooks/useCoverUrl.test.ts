import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCoverUrl } from './useCoverUrl';
import { bookContent } from '@data/repos/bookContent';

describe('useCoverUrl hook', () => {
  const mockBlob = new Blob(['image-data'], { type: 'image/jpeg' });
  const mockBookId = 'test-book-id';
  const mockSwUrl = '/__versicle__/covers/test-book-id';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    
    // Clear navigator.serviceWorker.controller mock
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        controller: null,
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns SW cover url directly when Service Worker controller is active', () => {
    // Mock active service worker controller
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        controller: {},
      },
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() =>
      useCoverUrl(mockBookId, mockBlob, mockSwUrl)
    );

    // Fast-forward any pending state updates, although SW path does not use timeouts
    act(() => {
      vi.runAllTimers();
    });

    expect(result.current).toBe(mockSwUrl);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('falls back to URL.createObjectURL when Service Worker controller is inactive', () => {
    const { result } = renderHook(() =>
      useCoverUrl(mockBookId, mockBlob, mockSwUrl)
    );

    act(() => {
      vi.runAllTimers();
    });

    expect(result.current).toBe('blob:mock-url');
    expect(URL.createObjectURL).toHaveBeenCalledWith(mockBlob);
  });

  it('revokes object URL on unmount', () => {
    const { unmount } = renderHook(() =>
      useCoverUrl(mockBookId, mockBlob, mockSwUrl)
    );

    act(() => {
      vi.runAllTimers();
    });

    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  /**
   * perf (P-mem): the library projection no longer carries a Blob per book
   * while the page is SW controlled. When the controller is gone but the
   * projection still says a cover exists, the fallback lane reads THAT ONE
   * cover from the data layer instead of relying on every book's bytes being
   * in memory.
   */
  describe('regression: the fallback lane reads the cover on demand', () => {
    it('fetches the single cover row when no blob was handed in', async () => {
      const spy = vi
        .spyOn(bookContent, 'getCoverBlob')
        .mockResolvedValue(new Blob(['on-demand'], { type: 'image/webp' }));

      const { result } = renderHook(() => useCoverUrl(mockBookId, undefined, mockSwUrl));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(spy).toHaveBeenCalledWith(mockBookId);
      expect(result.current).toBe('blob:mock-url');
    });

    it('does not read anything when the SW route is live', async () => {
      Object.defineProperty(navigator, 'serviceWorker', {
        value: { controller: {} },
        writable: true,
        configurable: true,
      });
      const spy = vi.spyOn(bookContent, 'getCoverBlob');

      const { result } = renderHook(() => useCoverUrl(mockBookId, undefined, mockSwUrl));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(spy).not.toHaveBeenCalled();
      expect(result.current).toBe(mockSwUrl);
    });

    it('does not read anything for a book with no cover at all', async () => {
      const spy = vi.spyOn(bookContent, 'getCoverBlob');

      renderHook(() => useCoverUrl(mockBookId, undefined, undefined));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(spy).not.toHaveBeenCalled();
    });
  });

  it('revokes and recreates object URL when blob changes', () => {
    const blob1 = new Blob(['image-data-1'], { type: 'image/jpeg' });
    const blob2 = new Blob(['image-data-2'], { type: 'image/jpeg' });

    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:mock-url-1')
      .mockReturnValueOnce('blob:mock-url-2');

    const { result, rerender } = renderHook(
      ({ blob }) => useCoverUrl(mockBookId, blob, mockSwUrl),
      { initialProps: { blob: blob1 } }
    );

    act(() => {
      vi.runAllTimers();
    });

    expect(result.current).toBe('blob:mock-url-1');

    rerender({ blob: blob2 });

    act(() => {
      vi.runAllTimers();
    });

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url-1');
    expect(result.current).toBe('blob:mock-url-2');
  });
});

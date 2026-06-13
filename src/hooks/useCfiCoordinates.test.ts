import { renderHook, act } from '@testing-library/react';
import { useCfiCoordinates } from './useCfiCoordinates';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ReaderEngine, ReaderEngineEvent, RangeRects } from '@domains/reader/engine/ReaderEngine';

/**
 * Phase 6: the geometry hook consumes the ReaderEngine port
 * (getRangeRects/getOverlayContainer/subscribe) instead of reaching into the
 * rendition. The stub below maps the legacy fixture data (range rects +
 * iframe offsets 10/20) onto the port so every pre-port placement assertion
 * survives unchanged.
 */
describe('useCfiCoordinates', () => {
  const IFRAME_OFFSET = { top: 10, left: 20 };
  let rectsByCall: Array<{ top: number; right: number }> | null;
  let container: HTMLElement | null;
  let listeners: Array<(e: ReaderEngineEvent) => void>;
  let resizeObserverCallback: ResizeObserverCallback;

  const engineStub = {
    getOverlayContainer: () => container,
     
    getRangeRects: (_cfi: string): RangeRects | null => {
      if (!rectsByCall || rectsByCall.length === 0) return null;
      return {
        rects: rectsByCall as unknown as DOMRect[],
        iframeOffset: IFRAME_OFFSET,
      };
    },
    subscribe: (listener: (e: ReaderEngineEvent) => void) => {
      listeners.push(listener);
      return () => {
        listeners = listeners.filter((l) => l !== listener);
      };
    },
  } as unknown as ReaderEngine;

  const emitRelocated = () => {
    listeners.forEach((l) =>
      l({ type: 'relocated' } as unknown as ReaderEngineEvent),
    );
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      return window.setTimeout(() => cb(0), 0) as unknown as number;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      window.clearTimeout(id as number);
    });

    rectsByCall = null;
    container = document.createElement('div');
    listeners = [];

    window.ResizeObserver = class {
      constructor(cb: ResizeObserverCallback) {
        resizeObserverCallback = cb;
      }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    } as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should return empty coordinates if engine is null', () => {
    const { result } = renderHook(() => useCfiCoordinates(null, ['epubcfi(/2/2/2)']));
    act(() => { vi.runAllTimers(); });
    expect(result.current).toEqual([]);
  });

  it('should return empty coordinates if the overlay container is missing', () => {
    container = null;
    const { result } = renderHook(() => useCfiCoordinates(engineStub, ['epubcfi(/2/2/2)']));
    act(() => { vi.runAllTimers(); });
    expect(result.current).toEqual([]);
  });

  it('should correctly calculate coordinates based on iframe offsets and range rects', () => {
    rectsByCall = [
      { top: 100, right: 150 },
      { top: 120, right: 180 }
    ];

    const cfis = ['epubcfi(/2/2/2)'];
    const { result } = renderHook(() => useCfiCoordinates(engineStub, cfis));
    act(() => { vi.runAllTimers(); });

    expect(result.current).toEqual([
      {
        cfi: 'epubcfi(/2/2/2)',
        top: 120 + 10, // last rect top + iframeOffsetTop
        left: 180 + 20 // last rect right + iframeOffsetLeft
      }
    ]);
  });

  it('should skip calculation when the engine resolves no rects (off-screen CFI)', () => {
    rectsByCall = null;
    const { result } = renderHook(() => useCfiCoordinates(engineStub, ['epubcfi(/bad)']));
    act(() => { vi.runAllTimers(); });
    expect(result.current).toEqual([]);
  });

  it('should recalculate coordinates when the relocated event fires', () => {
    rectsByCall = [{ top: 100, right: 150 }];

    const { result } = renderHook(() => useCfiCoordinates(engineStub, ['epubcfi(/2/2/2)']));
    act(() => { vi.runAllTimers(); });

    expect(result.current).toEqual([{ cfi: 'epubcfi(/2/2/2)', top: 110, left: 170 }]);

    // Relocate moves the element
    rectsByCall = [{ top: 200, right: 250 }];
    act(() => {
      emitRelocated();
      vi.runAllTimers();
    });

    expect(result.current).toEqual([{ cfi: 'epubcfi(/2/2/2)', top: 210, left: 270 }]);
  });

  it('should recalculate coordinates when ResizeObserver fires', () => {
    rectsByCall = [{ top: 100, right: 150 }];

    const { result } = renderHook(() => useCfiCoordinates(engineStub, ['epubcfi(/2/2/2)']));
    act(() => { vi.runAllTimers(); });

    expect(result.current).toEqual([{ cfi: 'epubcfi(/2/2/2)', top: 110, left: 170 }]);

    // Container resizes, causing layout shift
    rectsByCall = [{ top: 150, right: 180 }];
    act(() => {
      resizeObserverCallback([], {} as unknown as ResizeObserver);
      vi.runAllTimers();
    });

    expect(result.current).toEqual([{ cfi: 'epubcfi(/2/2/2)', top: 160, left: 200 }]);
  });

  it('should recalculate coordinates when a dependency changes', () => {
    rectsByCall = [{ top: 100, right: 150 }];

    let fontSize = 100;
    const { result, rerender } = renderHook(
      (props) => useCfiCoordinates(engineStub, ['epubcfi(/2/2/2)'], [props.fontSize]),
      { initialProps: { fontSize } }
    );
    act(() => { vi.runAllTimers(); });

    expect(result.current).toEqual([{ cfi: 'epubcfi(/2/2/2)', top: 110, left: 170 }]);

    // Font size changes layout
    rectsByCall = [{ top: 250, right: 300 }];

    // Re-render with new font size
    fontSize = 150;
    rerender({ fontSize });
    act(() => { vi.runAllTimers(); });

    expect(result.current).toEqual([{ cfi: 'epubcfi(/2/2/2)', top: 260, left: 320 }]);
  });

  it('should not update state unnecessarily if coordinates have not changed', () => {
    rectsByCall = [{ top: 100, right: 150 }];

    const { result } = renderHook(() => useCfiCoordinates(engineStub, ['epubcfi(/2/2/2)']));
    act(() => { vi.runAllTimers(); });

    const initialCoords = result.current;

    act(() => {
      // Trigger a resize event that generates the exact same coordinates
      resizeObserverCallback([], {} as unknown as ResizeObserver);
      vi.runAllTimers();
    });

    // Reference equality should be maintained
    expect(result.current).toBe(initialCoords);
  });
});

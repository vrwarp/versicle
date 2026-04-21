import { renderHook, act } from '@testing-library/react';
import { useCfiCoordinates } from './useCfiCoordinates';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Rendition } from 'epubjs';

describe('useCfiCoordinates', () => {
  let mockRendition: any;
  let mockIframe: any;
  let resizeObserverCallback: ResizeObserverCallback;
  let rafSpy: any;

  beforeEach(() => {
    vi.useFakeTimers();
    // Stub requestAnimationFrame to use setTimeout so we can control it with fake timers
    rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      return window.setTimeout(() => cb(0), 0) as unknown as number;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      window.clearTimeout(id as number);
    });

    mockIframe = {
      offsetTop: 10,
      offsetLeft: 20
    };

    mockRendition = {
      manager: {
        container: {
          querySelector: vi.fn().mockReturnValue(mockIframe)
        }
      },
      getRange: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
    };

    // Capture the resize observer callback
    window.ResizeObserver = class {
      constructor(cb: ResizeObserverCallback) {
        resizeObserverCallback = cb;
      }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    } as any;
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should return empty coordinates if rendition is null', () => {
    const { result } = renderHook(() => useCfiCoordinates(null, ['epubcfi(/2/2/2)']));
    act(() => { vi.runAllTimers(); });
    expect(result.current).toEqual([]);
  });

  it('should return empty coordinates if rendition manager is missing', () => {
    const mockEmptyRendition = { on: vi.fn(), off: vi.fn() };
    const { result } = renderHook(() => useCfiCoordinates(mockEmptyRendition as any, ['epubcfi(/2/2/2)']));
    act(() => { vi.runAllTimers(); });
    expect(result.current).toEqual([]);
  });

  it('should correctly calculate coordinates based on iframe offsets and range rects', () => {
    const mockRects = [
      { top: 100, right: 150 },
      { top: 120, right: 180 }
    ];
    mockRendition.getRange.mockReturnValue({
      getClientRects: () => mockRects
    });

    const cfis = ['epubcfi(/2/2/2)'];
    const { result } = renderHook(() => useCfiCoordinates(mockRendition, cfis));
    act(() => { vi.runAllTimers(); });

    expect(result.current).toEqual([
      {
        cfi: 'epubcfi(/2/2/2)',
        top: 120 + 10, // last rect top + iframeOffsetTop
        left: 180 + 20 // last rect right + iframeOffsetLeft
      }
    ]);
  });

  it('should skip calculation if getRange throws', () => {
    mockRendition.getRange.mockImplementation(() => {
      throw new Error("Invalid CFI");
    });
    
    const { result } = renderHook(() => useCfiCoordinates(mockRendition, ['epubcfi(/bad)']));
    act(() => { vi.runAllTimers(); });
    expect(result.current).toEqual([]);
  });

  it('should skip calculation if getClientRects returns empty', () => {
    mockRendition.getRange.mockReturnValue({
      getClientRects: () => []
    });
    
    const { result } = renderHook(() => useCfiCoordinates(mockRendition, ['epubcfi(/empty)']));
    act(() => { vi.runAllTimers(); });
    expect(result.current).toEqual([]);
  });

  it('should recalculate coordinates when relocated event fires', () => {
    mockRendition.getRange.mockReturnValue({
      getClientRects: () => [{ top: 100, right: 150 }]
    });

    const { result } = renderHook(() => useCfiCoordinates(mockRendition, ['epubcfi(/2/2/2)']));
    act(() => { vi.runAllTimers(); });
    
    expect(result.current).toEqual([{ cfi: 'epubcfi(/2/2/2)', top: 110, left: 170 }]);

    // Relocate moves the element
    mockRendition.getRange.mockReturnValue({
      getClientRects: () => [{ top: 200, right: 250 }]
    });

    act(() => {
      // Find the relocated handler
      const relocateCall = mockRendition.on.mock.calls.find((c: any) => c[0] === 'relocated');
      expect(relocateCall).toBeDefined();
      relocateCall[1]();
      vi.runAllTimers();
    });

    expect(result.current).toEqual([{ cfi: 'epubcfi(/2/2/2)', top: 210, left: 270 }]);
  });

  it('should recalculate coordinates when ResizeObserver fires', () => {
        mockRendition.getRange.mockReturnValue({
      getClientRects: () => [{ top: 100, right: 150 }]
    });

    const { result } = renderHook(() => useCfiCoordinates(mockRendition, ['epubcfi(/2/2/2)']));
    act(() => { vi.runAllTimers(); });
    
    expect(result.current).toEqual([{ cfi: 'epubcfi(/2/2/2)', top: 110, left: 170 }]);

    // Container resizes, causing layout shift
    mockRendition.getRange.mockReturnValue({
      getClientRects: () => [{ top: 150, right: 180 }]
    });

    act(() => {
      resizeObserverCallback([], {} as any);
      vi.runAllTimers();
    });

    expect(result.current).toEqual([{ cfi: 'epubcfi(/2/2/2)', top: 160, left: 200 }]);
  });

  it('should recalculate coordinates when a dependency changes', () => {
    mockRendition.getRange.mockReturnValue({
      getClientRects: () => [{ top: 100, right: 150 }]
    });

    let fontSize = 100;
    const { result, rerender } = renderHook(
      (props) => useCfiCoordinates(mockRendition, ['epubcfi(/2/2/2)'], [props.fontSize]),
      { initialProps: { fontSize } }
    );
    act(() => { vi.runAllTimers(); });
    
    expect(result.current).toEqual([{ cfi: 'epubcfi(/2/2/2)', top: 110, left: 170 }]);

    // Font size changes layout
    mockRendition.getRange.mockReturnValue({
      getClientRects: () => [{ top: 250, right: 300 }]
    });

    // Re-render with new font size
    fontSize = 150;
    rerender({ fontSize });
    act(() => { vi.runAllTimers(); });

    expect(result.current).toEqual([{ cfi: 'epubcfi(/2/2/2)', top: 260, left: 320 }]);
  });
  
  it('should not update state unnecessarily if coordinates have not changed', () => {
    mockRendition.getRange.mockReturnValue({
      getClientRects: () => [{ top: 100, right: 150 }]
    });

    const { result } = renderHook(() => useCfiCoordinates(mockRendition, ['epubcfi(/2/2/2)']));
    act(() => { vi.runAllTimers(); });
    
    const initialCoords = result.current;

    act(() => {
      // Trigger a resize event that generates the exact same coordinates
      resizeObserverCallback([], {} as any);
      vi.runAllTimers();
    });

    // Reference equality should be maintained
    expect(result.current).toBe(initialCoords);
  });
});

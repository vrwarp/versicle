import { useState, useEffect, useCallback, useRef } from 'react';
import type { Rendition } from 'epubjs';

export interface CfiCoordinate {
  cfi: string;
  top: number;
  left: number;
}

/**
 * A hook to calculate and track the coordinates of an array of CFIs in an EPUB.js Rendition.
 * 
 * @param rendition The EPUB.js Rendition instance.
 * @param cfis An array of CFI strings to measure.
 * @param dependencies Optional triggers that force a re-measurement (e.g., font size changes).
 */
export function useCfiCoordinates(
  rendition: Rendition | null,
  cfis: string[],
  dependencies: unknown[] = []
): CfiCoordinate[] {
  const [coords, setCoords] = useState<CfiCoordinate[]>([]);
  const resizeRaf = useRef<number | null>(null);

  const calculateCoordinates = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!rendition || !(rendition as any).manager) {
      setCoords(prev => prev.length === 0 ? prev : []);
      return;
    }

    const newCoords: CfiCoordinate[] = [];
    
    // 1. Determine Iframe Offsets
    // In EPUB.js, the manager container holds the iframes.
    // Coordinates from getBoundingClientRect inside an iframe are relative to the viewport.
    // However, when we portal out, we need them relative to the manager container.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const iframe = (rendition as any).manager.container?.querySelector('iframe');
    const iframeOffsetTop = iframe?.offsetTop || 0;
    const iframeOffsetLeft = iframe?.offsetLeft || 0;

    cfis.forEach(cfi => {
      try {
        // 2. Extract Range
        // getRange may throw if the CFI is not on the currently rendered page.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const range = (rendition as any).getRange(cfi);
        if (!range) return;

        // 3. Get Client Rects
        // We use getClientRects() because highlights can span multiple lines.
        // We want to place the marker at the end of the highlight.
        const rects = range.getClientRects();
        if (rects.length === 0) return;

        // 4. Position at the bottom-right of the last line of the highlight
        const lastRect = rects[rects.length - 1];
        
        newCoords.push({
          cfi,
          // Position at the end of the last rect
          top: lastRect.top + iframeOffsetTop,
          left: lastRect.right + iframeOffsetLeft
        });
      } catch {
        // CFI is likely off-screen or range generation failed
      }
    });

    // Only update state if coordinates have actually changed to prevent render loops
    setCoords(prev => {
      if (prev.length !== newCoords.length) return newCoords;
      const hasChanged = newCoords.some((c, i) => 
        c.cfi !== prev[i].cfi || c.top !== prev[i].top || c.left !== prev[i].left
      );
      return hasChanged ? newCoords : prev;
    });
  }, [rendition, cfis]);

  // Handle relocation (page turns)
  useEffect(() => {
    if (!rendition) return;

    const handleRelocated = () => {
      calculateCoordinates();
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rendition as any).on('relocated', handleRelocated);
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rendition as any).off('relocated', handleRelocated);
    };
  }, [rendition, calculateCoordinates]);

  // Handle window resizing or container changes
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!rendition || !(rendition as any).manager || !(rendition as any).manager.container) return;

    const observer = new ResizeObserver(() => {
      if (resizeRaf.current) cancelAnimationFrame(resizeRaf.current);
      resizeRaf.current = requestAnimationFrame(() => {
        calculateCoordinates();
      });
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    observer.observe((rendition as any).manager.container);
    
    return () => {
      observer.disconnect();
      if (resizeRaf.current) cancelAnimationFrame(resizeRaf.current);
    };
  }, [rendition, calculateCoordinates]);

  // Trigger recalculation on dependency changes
  useEffect(() => {
    // Wrap in requestAnimationFrame to avoid "setState in effect" performance warning
    const raf = requestAnimationFrame(() => {
      calculateCoordinates();
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calculateCoordinates, ...dependencies]);

  return coords;
}

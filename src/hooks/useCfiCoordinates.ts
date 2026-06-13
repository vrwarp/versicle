import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReaderEngine } from '@domains/reader/engine/ReaderEngine';

export interface CfiCoordinate {
  cfi: string;
  top: number;
  left: number;
}

/**
 * The shared measured-portal primitive (Phase 6 §4 "MeasuredOverlay"): maps
 * CFIs to overlay-container coordinates through the ReaderEngine port
 * (`getRangeRects` = rendered range rects + iframe stacking offsets) and
 * re-measures on relocation, container resize, and explicit dependency
 * changes. Consumers portal the results via ReaderOverlay.
 *
 * Placement semantics preserved from the pre-port hook: the point is the
 * bottom-right of the LAST client rect (markers sit at the end of the last
 * highlighted line).
 *
 * @param engine The ReaderEngine port (null while the book loads).
 * @param cfis CFI strings to measure.
 * @param dependencies Optional triggers that force a re-measurement (e.g., font size changes).
 */
export function useCfiCoordinates(
  engine: ReaderEngine | null,
  cfis: string[],
  dependencies: unknown[] = []
): CfiCoordinate[] {
  const [coords, setCoords] = useState<CfiCoordinate[]>([]);
  const resizeRaf = useRef<number | null>(null);

  const calculateCoordinates = useCallback(() => {
    if (!engine || !engine.getOverlayContainer()) {
      setCoords(prev => prev.length === 0 ? prev : []);
      return;
    }

    const newCoords: CfiCoordinate[] = [];

    cfis.forEach(cfi => {
      // getRangeRects may return null if the CFI is not on the currently
      // rendered page (range generation failed / off-screen).
      const measured = engine.getRangeRects(cfi);
      if (!measured || measured.rects.length === 0) return;

      // Position at the bottom-right of the last line of the highlight.
      const lastRect = measured.rects[measured.rects.length - 1];

      newCoords.push({
        cfi,
        top: lastRect.top + measured.iframeOffset.top,
        left: lastRect.right + measured.iframeOffset.left
      });
    });

    // Only update state if coordinates have actually changed to prevent render loops
    setCoords(prev => {
      if (prev.length !== newCoords.length) return newCoords;
      const hasChanged = newCoords.some((c, i) =>
        c.cfi !== prev[i].cfi || c.top !== prev[i].top || c.left !== prev[i].left
      );
      return hasChanged ? newCoords : prev;
    });
  }, [engine, cfis]);

  // Handle relocation (page turns)
  useEffect(() => {
    if (!engine) return;

    return engine.subscribe((event) => {
      if (event.type === 'relocated') {
        calculateCoordinates();
      }
    });
  }, [engine, calculateCoordinates]);

  // Handle window resizing or container changes
  useEffect(() => {
    const container = engine?.getOverlayContainer();
    if (!container) return;

    const observer = new ResizeObserver(() => {
      if (resizeRaf.current) cancelAnimationFrame(resizeRaf.current);
      resizeRaf.current = requestAnimationFrame(() => {
        calculateCoordinates();
      });
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
      if (resizeRaf.current) cancelAnimationFrame(resizeRaf.current);
    };
  }, [engine, calculateCoordinates]);

  // Trigger recalculation on dependency changes
  useEffect(() => {
    calculateCoordinates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calculateCoordinates, ...dependencies]);

  return coords;
}

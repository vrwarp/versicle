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

  // perf: cfi -> spine href, cached per engine. A CFI's section is a
  // deterministic spine lookup for a given book, so it is resolved once
  // instead of on every relocation and resize tick. Only successful lookups
  // are cached — a null (spine not ready) must stay retryable.
  const sectionCache = useRef<{ engine: ReaderEngine | null; byCfi: Map<string, string> }>({
    engine: null,
    byCfi: new Map(),
  });

  const calculateCoordinates = useCallback(() => {
    if (!engine || !engine.getOverlayContainer()) {
      setCoords(prev => prev.length === 0 ? prev : []);
      return;
    }

    if (sectionCache.current.engine !== engine) {
      sectionCache.current = { engine, byCfi: new Map() };
    }
    const sectionByCfi = sectionCache.current.byCfi;

    // perf: measuring a CFI that lives in an UNRENDERED section is pure waste —
    // getRangeRects parses a fresh EpubCFI and walks the manager's visible
    // views only to return null. Partition the list by section first and skip
    // those. When the rendered set cannot be determined (an engine double
    // without the seam, a teardown race) we fall back to measuring everything,
    // so this can only ever remove work that was going to fail.
    let renderedHrefs: Set<string> | null = null;
    try {
      const hrefs = new Set(
        engine.getContentViews().map(view => view.sectionHref).filter(Boolean),
      );
      if (hrefs.size > 0) renderedHrefs = hrefs;
    } catch {
      renderedHrefs = null;
    }

    const sectionHrefOf = (cfi: string): string | null => {
      const cached = sectionByCfi.get(cfi);
      if (cached) return cached;
      try {
        const href = engine.resolveSection(cfi)?.href;
        if (href) {
          sectionByCfi.set(cfi, href);
          return href;
        }
      } catch {
        // Unresolvable — fall through and measure it as before.
      }
      return null;
    };

    const newCoords: CfiCoordinate[] = [];

    cfis.forEach(cfi => {
      if (renderedHrefs) {
        const href = sectionHrefOf(cfi);
        // A known section that is not on screen: getRangeRects would return
        // null anyway.
        if (href && !renderedHrefs.has(href)) return;
      }

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

  // Handle relocation (page turns). `contentRendered` re-measures as soon as a
  // new section attaches, so the section partition above can never hold a
  // marker back until the next relocation.
  useEffect(() => {
    if (!engine) return;

    return engine.subscribe((event) => {
      if (event.type === 'relocated' || event.type === 'contentRendered') {
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

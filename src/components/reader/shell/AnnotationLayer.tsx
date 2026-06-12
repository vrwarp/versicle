/**
 * AnnotationLayer — user annotations on the open book (Phase 6 §5 table,
 * prep/phase6-reader-engine.md PR-9). Extracted verbatim from the legacy
 * ReaderView:
 *
 *  - loads the book's annotations from the store,
 *  - diffs them onto the engine's 'annotation' highlight layer (the ONE
 *    epub.js annotations path, §4), including the audio-bookmark
 *    click→display→programmatic-select→CompassPill-morph triage flow,
 *  - renders the note-marker geometry overlay (useCfiCoordinates +
 *    AnnotationMarkerOverlay portal into the engine container).
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { ReaderEngine } from '@domains/reader/engine/ReaderEngine';
import type { HighlightLayerManager } from '@domains/reader/engine/HighlightLayerManager';
import {
  annotationClassName,
  AUDIO_BOOKMARK_PENDING_CLASS,
} from '@domains/reader/engine/highlightStyles';
import { useAnnotationStore } from '@store/useAnnotationStore';
import { useReaderUIStore } from '@store/useReaderUIStore';
import { useCfiCoordinates } from '@hooks/useCfiCoordinates';
import { AnnotationMarkerOverlay } from '../AnnotationMarkerOverlay';

export interface AnnotationLayerProps {
  bookId: string | undefined;
  engine: ReaderEngine | null;
  highlights: HighlightLayerManager | null;
  isReady: boolean;
  /** The engine overlay container (marker portal target). */
  containerNode: Element | null;
  /** The viewer element (iframe rect for popover coordinates). */
  viewerRef: React.RefObject<HTMLDivElement | null>;
  /** Re-measure triggers for marker geometry (font size, view mode). */
  measureDeps: unknown[];
}

export const AnnotationLayer: React.FC<AnnotationLayerProps> = ({
  bookId,
  engine,
  highlights,
  isReady,
  containerNode,
  viewerRef,
  measureDeps,
}) => {
  const loadAnnotations = useAnnotationStore(state => state.loadAnnotations);
  const showPopover = useReaderUIStore(state => state.showPopover);

  // BOLT OPTIMIZATION: Fine-grained selector for annotations
  // Only re-render when annotations for THIS specific book change, not when any annotation in the library changes.
  const annotationList = useAnnotationStore(useShallow(state => {
    const list = [];
    for (const key in state.annotations) {
      if (Object.prototype.hasOwnProperty.call(state.annotations, key)) {
        if (state.annotations[key].bookId === bookId) {
          list.push(state.annotations[key]);
        }
      }
    }
    return list;
  }));

  // Load Annotations from DB
  useEffect(() => {
    if (bookId) {
      loadAnnotations(bookId);
    }
  }, [bookId, loadAnnotations]);

  // Apply Annotations to the engine's highlight layer
  // Map of ID -> CFI for highlights
  const addedAnnotations = useRef<Map<string, string>>(new Map());

  // Clear tracked annotations if the engine changes (e.g. re-initialization)
  useEffect(() => {
    addedAnnotations.current.clear();
  }, [engine]);

  useEffect(() => {
    if (engine && highlights && isReady) {
      const currentIds = new Set(annotationList.map(a => a.id));

      // 1. Remove deleted annotations (Highlights only - markers are in the React overlay)
      addedAnnotations.current.forEach((cfi, id) => {
        if (!currentIds.has(id)) {
          highlights.remove('annotation', cfi);
          addedAnnotations.current.delete(id);
        }
      });

      // 2. Add new annotations
      annotationList.forEach(annotation => {
        // Add Highlight/Underline if missing
        if (!addedAnnotations.current.has(annotation.id)) {
          if (annotation.type === 'audio-bookmark') {
            highlights.add('annotation', annotation.cfiRange, {
              className: AUDIO_BOOKMARK_PENDING_CLASS,
              onClick: (e: Event) => {
                e.preventDefault();
                e.stopPropagation();
                // 1. Programmatically select the block (engine selection utility)
                engine.display(annotation.cfiRange);

                setTimeout(() => {
                  engine.selectRange(annotation.cfiRange);

                  // 2. Dispatch state to Reader UI Store to morph the CompassPill
                  useReaderUIStore.getState().setCompassState({
                    variant: 'audio-triage',
                    targetAnnotation: annotation
                  });
                }, 50);
              },
            });
          }
          else {
            highlights.add('annotation', annotation.cfiRange, {
              className: annotationClassName(annotation.color),
              onClick: (e: Event) => {
                const me = e as MouseEvent;
                // Handle click on highlight to show actions (delete/edit)
                const iframe = viewerRef.current?.querySelector('iframe');
                let x = me.clientX;
                let y = me.clientY;

                if (iframe) {
                  const iframeRect = iframe.getBoundingClientRect();
                  x += iframeRect.left;
                  y += iframeRect.top;
                }
                showPopover(x, y, annotation.cfiRange, annotation.text, annotation.id);

                // Update Compass UI state to sync with the existing annotation
                useReaderUIStore.getState().setCompassState({
                  variant: 'annotation',
                  targetAnnotation: annotation
                });
              },
            });
          }
          // The manager logs-and-swallows epub.js failures; only track ids
          // whose highlight actually attached (parity with the pre-manager
          // try/catch placement).
          if (highlights.has('annotation', annotation.cfiRange)) {
            addedAnnotations.current.set(annotation.id, annotation.cfiRange);
          }
        }
      });

      // (The legacy `window.__reader_added_annotations_count` global is
      // gone: E2E polls `__versicleTest.reader.highlightCount('annotation')`,
      // backed by the engine's HighlightLayerManager.)
    }
  }, [annotationList, isReady, engine, highlights, showPopover, bookId, viewerRef]);

  // --- Note markers (geometry overlay) ---

  // Filter annotations that have notes for overlay rendering
  const noteAnnotations = useMemo(() =>
    annotationList.filter(a => !!a.note),
    [annotationList]
  );

  const noteCfis = useMemo(() =>
    noteAnnotations.map(a => a.cfiRange),
    [noteAnnotations]
  );

  // Calculate coordinates for note markers (engine geometry primitive)
  const markerCoords = useCfiCoordinates(engine, noteCfis, measureDeps);

  // Merge coordinates with annotation metadata
  const markers = useMemo(() => {
    return markerCoords.map(coord => {
      const annotation = noteAnnotations.find(a => a.cfiRange === coord.cfi);
      return {
        id: annotation?.id || '',
        cfi: coord.cfi,
        top: coord.top,
        left: coord.left,
        note: annotation?.note || '',
        text: annotation?.text || ''
      };
    });
  }, [markerCoords, noteAnnotations]);

  return (
    <AnnotationMarkerOverlay
      markers={markers}
      onMarkerClick={(x, y, cfi, text, id) => {
        // 1. Update Annotation store popover state (for color/delete etc)
        showPopover(x, y, cfi, text, id);

        // 2. Update Compass UI state to morph the pill
        const annotation = annotationList.find(a => a.id === id);
        if (annotation) {
          useReaderUIStore.getState().setCompassState({
            variant: 'annotation',
            targetAnnotation: annotation
          });
        }
      }}
      containerNode={containerNode}
    />
  );
};

/**
 * useTocController — the synthetic-TOC state machine + Smart TOC wiring
 * (Phase 6 §5 table, prep/phase6-reader-engine.md PR-9). Extracted
 * verbatim from the legacy ReaderView: the user-toggle guard against the
 * Yjs observer reset race, metadata-driven initialization, active-item
 * resolution, the section-title sync effect, and the GenAI enhancement
 * hook.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { NavigationItem, BookMetadata } from '~types/book';
import type { ReaderEngine } from '@domains/reader/engine/ReaderEngine';
import { useReaderUIStore } from '@store/useReaderUIStore';
import { useBookStore } from '@store/useBookStore';
import { useSmartTOC } from '@hooks/useSmartTOC';
import { findTocItem } from '@lib/reader/titleResolver';

export interface TocController {
  toc: NavigationItem[];
  syntheticToc: NavigationItem[];
  useSyntheticToc: boolean;
  onUseSyntheticTocChange: (value: boolean) => void;
  activeTocId: string | null;
  isEnhancing: boolean;
  tocProgress: { current: number; total: number } | null;
  enhanceTOC: () => void;
}

export function useTocController(opts: {
  bookId: string | undefined;
  engine: ReaderEngine | null;
  bookMetadata: BookMetadata | null;
}): TocController {
  const { bookId, engine, bookMetadata } = opts;

  const toc = useReaderUIStore(state => state.toc);
  const currentSectionId = useReaderUIStore(state => state.currentSectionId);
  const currentSectionTitle = useReaderUIStore(state => state.currentSectionTitle);
  const setCurrentSection = useReaderUIStore(state => state.setCurrentSection);

  const [useSyntheticToc, setUseSyntheticToc] = useState(false);
  const [syntheticToc, setSyntheticToc] = useState<NavigationItem[]>([]);
  // Tracks whether the user has explicitly toggled the switch in this session.
  // Prevents the bookMetadata effect from overriding their choice when Yjs
  // fires an observer after updateBook (which would cause a reset race).
  const userHasExplicitlySetSyntheticToc = useRef(false);

  // Determine active TOC item based on currentSectionId (href)
  const activeTocId = useMemo(() => {
    if (!currentSectionId) return null;
    const currentToc = useSyntheticToc ? syntheticToc : toc;
    const resolvedItem = findTocItem(currentToc, currentSectionId);
    return resolvedItem ? resolvedItem.id : null;
  }, [toc, syntheticToc, useSyntheticToc, currentSectionId]);

  // Keep currentSectionTitle in sync with the active TOC item when preference changes
  useEffect(() => {
    if (!currentSectionId) return;
    const currentToc = useSyntheticToc ? syntheticToc : toc;
    const resolvedItem = findTocItem(currentToc, currentSectionId);
    if (resolvedItem && resolvedItem.label !== currentSectionTitle) {
      setCurrentSection(resolvedItem.label, currentSectionId);
    }
  }, [toc, syntheticToc, useSyntheticToc, currentSectionId, currentSectionTitle, setCurrentSection]);

  // Smart TOC Hook
  const { enhanceTOC, isEnhancing, progress: tocProgress } = useSmartTOC(
    engine,
    bookId,
    toc,
    setSyntheticToc
  );

  // Reset the explicit-set guard whenever the user navigates to a different book
  useEffect(() => {
    userHasExplicitlySetSyntheticToc.current = false;
  }, [bookId]);

  // Load synthetic TOC from metadata (deferred a microtask so the sync
  // never runs synchronously inside the effect — same observable behavior).
  useEffect(() => {
    if (!bookMetadata) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (bookMetadata.syntheticToc) {
        setSyntheticToc(bookMetadata.syntheticToc);
      } else {
        setSyntheticToc([]);
      }

      // Only initialize useSyntheticToc from metadata if the user hasn't
      // explicitly toggled it. When updateBook is called, the Yjs-backed store
      // fires an observer which re-triggers this effect — without this guard,
      // that causes a reset race that clears the toggle.
      if (!userHasExplicitlySetSyntheticToc.current) {
        // bookMetadata.syntheticToc is always set from static_structure.toc (the original
        // epub TOC), so we can't use its presence to infer whether AI titles exist.
        // Only trust the explicit useSyntheticToc flag saved in the Yjs store.
        setUseSyntheticToc(bookMetadata.useSyntheticToc === true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [bookMetadata]);

  const onUseSyntheticTocChange = (val: boolean) => {
    userHasExplicitlySetSyntheticToc.current = true;
    setUseSyntheticToc(val);
    if (bookId) {
      useBookStore.getState().updateBook(bookId, { useSyntheticToc: val });
    }
  };

  return {
    toc,
    syntheticToc,
    useSyntheticToc,
    onUseSyntheticTocChange,
    activeTocId,
    isEnhancing,
    tocProgress,
    enhanceTOC,
  };
}

/**
 * ReaderSidebars — the reader's sidebar mounts (Phase 6 §5 table,
 * prep/phase6-reader-engine.md PR-9): TOC (with the TocController and
 * TOCPanel-local device markers), the annotation list, and the search
 * panel. Extracted verbatim from the legacy ReaderView body.
 */
import React from 'react';
import type { ReaderEngine } from '@domains/reader/engine/ReaderEngine';
import { useReaderCommands } from '@domains/reader/ui/ReaderCommands';
import type { SearchSession } from '@domains/search';
import type { BookMetadata } from '~types/book';
import type { DetailedSearchResult } from '~types/search';
import { useSidebarState } from '@hooks/useSidebarState';
import { TOCPanel, SearchPanel } from '../panels';
import { AnnotationList } from '../AnnotationList';
import { useTocController } from './useTocController';
import { useDeviceMarkers } from './useDeviceMarkers';

export interface ReaderSidebarsProps {
  bookId: string | undefined;
  engine: ReaderEngine | null;
  bookMetadata: BookMetadata | null;
  historyTick: number;
  /** The controller's reader-session search surface (Phase 7 §F). */
  searchSession: SearchSession;
  /** Exact-occurrence navigation (app/reader/searchNavigation via the controller). */
  onSearchNavigate: (result: DetailedSearchResult) => void;
}

export const ReaderSidebars: React.FC<ReaderSidebarsProps> = ({
  bookId,
  engine,
  bookMetadata,
  historyTick,
  searchSession,
  onSearchNavigate,
}) => {
  const { activeSidebar, setSidebar } = useSidebarState();
  const commands = useReaderCommands();
  const tocController = useTocController({ bookId, engine, bookMetadata });
  const deviceMarkers = useDeviceMarkers(
    activeSidebar === 'toc' ? bookId : undefined,
    engine,
  );

  return (
    <>
      {/* TOC Sidebar (now includes History) */}
      {activeSidebar === 'toc' && (
        <TOCPanel
          toc={tocController.toc}
          syntheticToc={tocController.syntheticToc}
          useSyntheticToc={tocController.useSyntheticToc}
          onUseSyntheticTocChange={tocController.onUseSyntheticTocChange}
          activeTocId={tocController.activeTocId ?? undefined}
          deviceMarkers={deviceMarkers}
          onNavigate={(href) => {
            // Dragnet invalidation moved INSIDE the TTS engine (5b-PR4): the
            // DragnetGesture unit disarms on the engine's own section-index
            // change, so the TOC handler no longer pokes the engine.
            commands.jumpTo(href);
            setSidebar('none');
          }}
          isEnhancing={tocController.isEnhancing}
          tocProgress={tocController.tocProgress}
          onEnhanceTOC={tocController.enhanceTOC}
          bookId={bookId || ''}
          engine={engine ?? undefined}
          historyTick={historyTick}
          onHistoryNavigate={(cfi, endCfi) => {
            if (endCfi) {
              commands.jumpToEnd(endCfi);
            } else {
              commands.jumpTo(cfi);
            }
          }}
          contentLang={bookMetadata?.language}
        />
      )}

      {/* Annotation List Overlay */}
      {activeSidebar === 'annotations' && (
        <div data-testid="reader-annotations-sidebar" className="w-64 shrink-0 bg-surface border-r border-border overflow-y-auto z-50 absolute inset-y-0 left-0 flex flex-col">
          <div className="p-4 border-b border-border">
            <h2 className="text-lg font-bold text-foreground">Annotations</h2>
          </div>
          <AnnotationList
            bookId={bookId}
            onNavigate={(cfi) => {
              commands.jumpTo(cfi);
              if (window.innerWidth < 768) setSidebar('none');
            }}
          />
        </div>
      )}

      {/* Search Sidebar — exact-occurrence navigation (Phase 7 §F, PR-S4):
          the scrollToText + 500ms-timer path died with the SearchSession
          adoption; results carry charOffset/occurrence and land by CFI. */}
      {activeSidebar === 'search' && (
        <SearchPanel
          bookId={bookId}
          session={searchSession}
          onNavigate={onSearchNavigate}
        />
      )}
    </>
  );
};

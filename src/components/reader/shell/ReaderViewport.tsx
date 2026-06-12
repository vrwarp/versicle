/**
 * ReaderViewport — the epub.js mount point + reader-area navigation
 * (Phase 6 §5, prep/phase6-reader-engine.md PR-9). Wheel/touch handling
 * stays in useReaderNavigation; page-turn KEYS are KeyboardShortcutService
 * registrations (Phase 8 §E — scope 'reader', yielding to 'tts-active'),
 * and the engine's iframe keydown stream feeds the same service through
 * the ONE bridge.
 */
import React from 'react';
import { useReaderNavigation } from '@hooks/useReaderNavigation';
import { useReaderCommands, useReaderEngine } from '@domains/reader/ui/ReaderCommands';
import {
  useReaderPageTurnShortcuts,
  useReaderEngineKeyBridge,
} from '@app/shortcuts/readerShortcuts';

export interface ReaderViewportProps {
  viewerRef: React.RefObject<HTMLDivElement | null>;
  scrollWrapperRef: React.RefObject<HTMLDivElement | null>;
  readerViewMode: 'paginated' | 'scrolled';
}

export const ReaderViewport: React.FC<ReaderViewportProps> = ({
  viewerRef,
  scrollWrapperRef,
  readerViewMode,
}) => {
  const commands = useReaderCommands();
  const engine = useReaderEngine();

  // Navigation handling (Touch, Wheel — scrolled mode)
  useReaderNavigation({
    readerViewMode,
    scrollWrapperRef,
    viewerRef,
  });

  // Keyboard: ArrowLeft/ArrowRight page turns (scope 'reader') + the
  // iframe keydown bridge (keys work with focus inside the book text).
  useReaderPageTurnShortcuts({
    handlePrev: commands.prevPage,
    handleNext: commands.nextPage,
  });
  useReaderEngineKeyBridge(engine);

  return (
    <div ref={scrollWrapperRef} className="flex-1 relative min-w-0 flex flex-col items-center">
      <div
        data-testid="reader-iframe-container"
        ref={viewerRef}
        className="w-full max-w-2xl overflow-hidden px-6 md:px-8 transition-opacity duration-300 opacity-100"
        style={{ height: readerViewMode === 'paginated' ? 'calc(100% - 100px)' : '100%' }}
      />
    </div>
  );
};

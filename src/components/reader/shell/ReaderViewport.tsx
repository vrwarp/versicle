/**
 * ReaderViewport — the epub.js mount point + reader-area navigation
 * (Phase 6 §5, prep/phase6-reader-engine.md PR-9). Keyboard/touch/wheel
 * handling rides the ReaderCommands context: the P0 keyboard-gating
 * predicates live in useReaderNavigation, byte-identical — only the
 * page-turn actions come from the command surface.
 */
import React from 'react';
import { useReaderNavigation } from '@hooks/useReaderNavigation';
import { useReaderCommands, useReaderEngine } from '@domains/reader/ui/ReaderCommands';

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

  // Navigation handling (Keyboard, Touch, Wheel)
  useReaderNavigation({
    engine,
    readerViewMode,
    handlePrev: commands.prevPage,
    handleNext: commands.nextPage,
    scrollWrapperRef,
    viewerRef,
  });

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

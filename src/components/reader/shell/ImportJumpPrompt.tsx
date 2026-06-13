/**
 * ImportJumpPrompt — the "Resume from Reading List?" flow, extracted
 * verbatim from the legacy ReaderView (Phase 6 §5 table,
 * prep/phase6-reader-engine.md PR-9).
 *
 * A book imported via the reading list carries a percentage but no CFI;
 * on first open the prompt offers to jump there. The check runs inside the
 * controller's onLocationChange (returning true suppresses progress
 * saving for that relocation — the legacy "SKIP SAVING PROGRESS" branch);
 * the dialog handles confirm/cancel, the deferred jump once the location
 * registry generates, and the 2-minute safety timeout.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { ReaderEngine } from '@domains/reader/engine/ReaderEngine';
import type { BookMetadata } from '~types/book';
import { useReadingStateStore } from '@store/useReadingStateStore';
import { useToastStore } from '@store/useToastStore';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { createLogger } from '@lib/logger';

const logger = createLogger('ImportJumpPrompt');

export interface ImportJumpApi {
  /**
   * The onLocationChange gate: prompts once per session when the book has
   * imported progress but no saved CFI and the position is effectively the
   * start. Returns true when the prompt took over (skip saving progress).
   */
  checkImportJump: (percentage: number) => boolean;
  /** The dialog element the shell mounts. */
  dialog: React.ReactNode;
}

export function useImportJumpPrompt(opts: {
  bookId: string | undefined;
  engine: ReaderEngine | null;
  areLocationsReady: boolean;
  bookMetadata: BookMetadata | null;
}): ImportJumpApi {
  const { bookId, engine, areLocationsReady, bookMetadata } = opts;

  const [showImportJumpDialog, setShowImportJumpDialog] = useState(false);
  // Tracks if we are waiting for the engine to finish generating locations to perform a jump
  const [isWaitingForJump, setIsWaitingForJump] = useState(false);
  const [importJumpTarget, setImportJumpTarget] = useState(0);
  const hasPromptedForImport = useRef(false);
  const metadataRef = useRef<BookMetadata | null>(null);
  useEffect(() => {
    metadataRef.current = bookMetadata;
  }, [bookMetadata]);

  const checkImportJump = useCallback((percentage: number): boolean => {
    // If we have metadata, no saved CFI (never opened), but have progress
    // (from import), and haven't prompted yet. And current position is
    // effectively start.
    const meta = metadataRef.current as { currentCfi?: string; progress?: number } | null | undefined;
    const importedProgress = meta?.progress ?? 0;
    if (meta && !meta.currentCfi && importedProgress > 0 && !hasPromptedForImport.current && bookId) {
      // We only trigger if we are at the start (percentage ~0)
      if (percentage < 0.01) {
        setImportJumpTarget(importedProgress);
        setShowImportJumpDialog(true);
        hasPromptedForImport.current = true;
        // SKIP SAVING PROGRESS this time to avoid overwriting the imported progress with 0
        return true;
      }
    }
    hasPromptedForImport.current = true; // Ensure we only check once per session
    return false;
  }, [bookId]);

  const handleJumpConfirm = async () => {
    if (areLocationsReady) {
      setShowImportJumpDialog(false);
      if (engine) {
        try {
          const cfi = engine.locations.cfiFromPercentage(importJumpTarget);
          if (cfi) {
            await engine.display(cfi);
            // Progress saving happens via the subsequent onLocationChange
          }
        } catch (e) {
          logger.error('Jump failed', e);
          useToastStore.getState().showToast('Failed to jump to location', 'error');
        }
      }
    } else {
      // Keep dialog open but change UI to loading
      setIsWaitingForJump(true);
    }
  };

  const handleJumpCancel = () => {
    setShowImportJumpDialog(false);
    setIsWaitingForJump(false);
    // Explicitly save current position (0) to mark as "started"
    if (bookId) {
      const currentProgress = useReadingStateStore.getState().getProgress(bookId);
      const currentCfi = currentProgress?.currentCfi;
      // updateLocation handles saving to Yjs
      if (currentCfi) {
        useReadingStateStore.getState().updateLocation(bookId, currentCfi, currentProgress?.percentage || 0);
      }
    }
  };

  // Watch for locations to become ready if waiting
  useEffect(() => {
    // If we are waiting, and the capability arrives... (deferred a
    // microtask so the jump + state transitions never run synchronously
    // inside the effect — same observable behavior, no cascading render.)
    if (!(isWaitingForJump && areLocationsReady && engine)) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const cfi = engine.locations.cfiFromPercentage(importJumpTarget);
        if (cfi) {
          engine.display(cfi);
          setIsWaitingForJump(false);
          setShowImportJumpDialog(false);
        }
      } catch (e) {
        logger.error('Deferred jump failed', e);
        useToastStore.getState().showToast('Failed to jump to location', 'error');
        setIsWaitingForJump(false);
        setShowImportJumpDialog(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isWaitingForJump, areLocationsReady, engine, importJumpTarget]);

  // Timeout safety for jump wait
  useEffect(() => {
    let timeout: NodeJS.Timeout;
    if (isWaitingForJump) {
      timeout = setTimeout(() => {
        setIsWaitingForJump(false);
        setShowImportJumpDialog(false);
        useToastStore.getState().showToast('Could not calculate location. Starting from beginning.', 'error');
      }, 120000); // 2 minutes timeout
    }
    return () => clearTimeout(timeout);
  }, [isWaitingForJump]);

  const dialog = (
    <Dialog
      isOpen={showImportJumpDialog}
      onClose={handleJumpCancel}
      title={isWaitingForJump ? 'Locating...' : 'Resume from Reading List?'}
      description={
        isWaitingForJump
          ? 'Please wait while we calculate the page position...'
          : `This book has progress saved in your reading list (${Math.round(importJumpTarget * 100)}%). Would you like to jump to this location?`
      }
      footer={
        <>
          <Button variant="ghost" onClick={handleJumpCancel} disabled={isWaitingForJump}>
            {isWaitingForJump ? 'Cancel' : 'No, start from beginning'}
          </Button>
          <Button onClick={handleJumpConfirm} disabled={isWaitingForJump}>
            {isWaitingForJump ? 'Calculating...' : 'Yes, jump to location'}
          </Button>
        </>
      }
    />
  );

  return { checkImportJump, dialog };
}

import React, { useEffect, useRef } from 'react';
import type { Rendition } from 'epubjs';
import { useTTSStore } from '../../store/useTTSStore';

interface ReaderTTSControllerProps {
  rendition: Rendition | null;
  viewMode: string;
  onNext: () => void;
  onPrev: () => void;
}

/**
 * Component to handle TTS-related side effects that update frequently.
 * This isolates these updates from the main ReaderView to prevent expensive re-renders
 * of the entire reader interface (and its children) on every sentence change.
 *
 * Handles:
 * 1. Highlighting the current sentence (activeCfi)
 * 2. Keyboard navigation during TTS (currentIndex)
 */
export const ReaderTTSController: React.FC<ReaderTTSControllerProps> = ({
  rendition,
  viewMode,
  onNext,
  onPrev
}) => {
  // We subscribe to these changing values here, so ReaderView doesn't have to.
  const activeCfi = useTTSStore(state => state.activeCfi);
  const currentIndex = useTTSStore(state => state.currentIndex);
  const status = useTTSStore(state => state.status);
  const queue = useTTSStore(state => state.queue);
  const jumpTo = useTTSStore(state => state.jumpTo);

  // --- TTS Highlighting ---
  useEffect(() => {
      if (!rendition || !activeCfi) return;

      // Auto-turn page in paginated mode
      if (viewMode === 'paginated') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (rendition as any).display(activeCfi);
      }

      // Add highlight
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rendition as any).annotations.add('highlight', activeCfi, {}, () => {
          // Click handler for TTS highlight
      }, 'tts-highlight');

      // Remove highlight when activeCfi changes
      return () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (rendition as any).annotations.remove(activeCfi, 'highlight');
      };
  }, [activeCfi, viewMode, rendition]);

  // --- Keyboard Navigation ---
  // Use a ref to access the latest state in the event listener without re-binding it constantly.
  // This prevents removing/adding the listener on every sentence change.
  const stateRef = useRef({ status, currentIndex, queue });
  useEffect(() => {
    stateRef.current = { status, currentIndex, queue };
  }, [status, currentIndex, queue]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const { status: currentStatus, currentIndex: idx, queue: q } = stateRef.current;

      if (e.key === 'ArrowLeft') {
        if (currentStatus === 'playing' || currentStatus === 'paused') {
          if (idx > 0) jumpTo(idx - 1);
        } else {
          onPrev();
        }
      }
      if (e.key === 'ArrowRight') {
        if (currentStatus === 'playing' || currentStatus === 'paused') {
          if (idx < q.length - 1) jumpTo(idx + 1);
        } else {
          onNext();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [jumpTo, onPrev, onNext]);

  return null;
};

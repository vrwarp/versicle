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
 * 3. Visibility reconciliation (syncing visual state when returning to foreground)
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

  const lastBackgroundCfi = useRef<string | null>(null);

  // --- TTS Highlighting & Sync ---
  useEffect(() => {
      if (!rendition || !activeCfi || status === 'stopped') return;

      const syncVisuals = () => {
         // Auto-turn page in paginated mode
         if (viewMode === 'paginated') {
             // Non-blocking display call
             // eslint-disable-next-line @typescript-eslint/no-explicit-any
             (rendition as any).display(activeCfi).catch((err: unknown) => {
                 console.warn("[TTS] Sync skipped", err);
             });
         }

         // Add highlight
         try {
             // eslint-disable-next-line @typescript-eslint/no-explicit-any
             (rendition as any).annotations.add('highlight', activeCfi, {}, () => {
                 // Click handler for TTS highlight
             }, 'tts-highlight');
         } catch (e) {
             console.warn("[TTS] Highlight failed", e);
         }
      };

      if (document.visibilityState === 'visible') {
           syncVisuals();
      } else {
           // Background mode: Store for later
           lastBackgroundCfi.current = activeCfi;
      }

      // Remove highlight when activeCfi changes
      return () => {
          try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (rendition as any).annotations.remove(activeCfi, 'highlight');
          } catch { /* ignore removal errors */ }
      };
  }, [activeCfi, viewMode, rendition, status]);

  // --- Visibility Reconciliation ---
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && lastBackgroundCfi.current && rendition) {
         // We just came back to foreground.
         // If we have a stored CFI that we missed syncing, jump to it now.
         const cfiToSync = lastBackgroundCfi.current;
         lastBackgroundCfi.current = null;

         if (viewMode === 'paginated') {
             // eslint-disable-next-line @typescript-eslint/no-explicit-any
             (rendition as any).display(cfiToSync).catch((err: unknown) => console.warn("Reconciliation failed", err));
         }

         // If the active CFI matches, ensure the highlight is present.
         if (cfiToSync === activeCfi) {
             try {
                 // eslint-disable-next-line @typescript-eslint/no-explicit-any
                 (rendition as any).annotations.add('highlight', cfiToSync, {}, () => {}, 'tts-highlight');
             } catch (e) { console.warn("Reconciliation highlight failed", e); }
         }
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [rendition, viewMode, activeCfi]); // Added activeCfi dependency to ensure we have fresh value

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

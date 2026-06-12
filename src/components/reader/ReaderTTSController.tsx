import type React from 'react';
import { useEffect, useRef } from 'react';
import type { Rendition } from 'epubjs';
import { useTTSPlaybackStore } from '@store/useTTSPlaybackStore';
import { useShallow } from 'zustand/react/shallow';
import { useAudioCommands } from '@app/tts/useAudioCommands';
import type { HighlightLayerManager } from '@domains/reader/engine/HighlightLayerManager';

interface ReaderTTSControllerProps {
  rendition: Rendition | null;
  /** The shared highlight manager — the ONLY path to epub.js annotations. */
  highlights: HighlightLayerManager | null;
  viewMode: string;
}

// HOTFIX keyboard-gating (interim until the Phase 8 KeyboardShortcutService):
// Focused interactive controls own Space themselves; hijacking it for play/pause
// (and calling preventDefault) would swallow e.g. a header button's activation.
const INTERACTIVE_TARGET_SELECTOR = 'button, a[href], select, summary, [role="button"]';

// An open overlay (Radix dialog/sheet/menu/popover) owns Escape: it dismisses the
// overlay, and stopping playback at the same time would kill the audio session the
// user only meant to close a dialog over.
const OPEN_OVERLAY_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[data-radix-popper-content-wrapper] [data-state="open"]'
].join(', ');

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
  highlights,
  viewMode
}) => {
  // We subscribe to these changing values here, so ReaderView doesn't have to.
  // Use shallow comparison for primitive values to avoid unnecessary re-renders
  const { activeCfi, currentIndex, status, queue } = useTTSPlaybackStore(useShallow(state => ({
    activeCfi: state.activeCfi,
    currentIndex: state.currentIndex,
    status: state.status,
    queue: state.queue
  })));

  // Engine commands come from the TtsController facade (stable identities).
  const { play, pause, stop, jumpTo } = useAudioCommands();

  // --- TTS Highlighting & Sync ---
  useEffect(() => {
    if (!rendition || !highlights || !activeCfi || status === 'stopped') return;

    const syncVisuals = () => {
      // Non-blocking display call
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rendition as any).display(activeCfi).catch((err: unknown) => {
        console.warn("[TTS] Sync skipped", err);
      });

      // Add via the manager: it runs the (formerly triplicated) orphaned-SVG
      // sweep first, then adds exactly one 'tts' highlight for the CFI.
      highlights.add('tts', activeCfi, {
        onClick: () => {
          // Click handler for TTS highlight
        },
      });
    };

    if (document.visibilityState === 'visible') {
      syncVisuals();
    }

    // Remove highlight when activeCfi changes (manager re-sweeps).
    return () => {
      highlights.remove('tts', activeCfi);
    };
  }, [activeCfi, viewMode, rendition, highlights, status]);

  // --- Visibility Reconciliation ---
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && rendition && highlights) {
        // We just came back to foreground.
        // Fetch the latest state directly from the store to avoid stale closure issues.
        const { activeCfi: freshCfi, status: freshStatus } = useTTSPlaybackStore.getState();

        if (!freshCfi || freshStatus === 'stopped') return;

        // Sync visual state regardless of view mode (paginated or scrolled)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (rendition as any).display(freshCfi).catch((err: unknown) => console.warn("Reconciliation failed", err));

        // Ensure the highlight is present: remove-then-add through the
        // manager (each side runs the orphan sweep) so a background queue
        // advance always ends with exactly one live node.
        highlights.remove('tts', freshCfi);
        highlights.add('tts', freshCfi, { onClick: () => { } });
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [rendition, highlights, viewMode]);

  // --- Keyboard Navigation ---
  // Use a ref to access the latest state in the event listener without re-binding it constantly.
  // This prevents removing/adding the listener on every sentence change.
  const stateRef = useRef({ status, currentIndex, queue, play, pause, stop });
  useEffect(() => {
    stateRef.current = { status, currentIndex, queue, play, pause, stop };
  }, [status, currentIndex, queue, play, pause, stop]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent holding the key down from spamming actions (matches useReaderNavigation)
      if (e.repeat) return;

      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const { status: currentStatus, currentIndex: idx, queue: q, play: doPlay, pause: doPause, stop: doStop } = stateRef.current;

      // HOTFIX keyboard-gating: this controller only owns the keyboard while TTS is
      // playing or paused. Otherwise useReaderNavigation owns ArrowLeft/ArrowRight
      // (page turns) — acting here too would turn the page twice per keypress.
      const ttsOwnsKeys = currentStatus === 'playing' || currentStatus === 'paused';

      if (e.key === 'ArrowLeft' && ttsOwnsKeys) {
        if (idx > 0) jumpTo(idx - 1);
      }
      if (e.key === 'ArrowRight' && ttsOwnsKeys) {
        if (idx < q.length - 1) jumpTo(idx + 1);
      }
      if (e.key === ' ' || e.code === 'Space') {
        // Let a focused interactive control keep its own Space activation.
        if (target instanceof Element && target.closest(INTERACTIVE_TARGET_SELECTOR)) {
          return;
        }
        if (currentStatus === 'playing') {
          e.preventDefault();
          doPause();
        } else if (currentStatus === 'paused') {
          e.preventDefault();
          doPlay();
        }
      }
      if (e.key === 'Escape') {
        if (ttsOwnsKeys) {
          // Escape closes the topmost overlay before it may stop playback.
          if (document.querySelector(OPEN_OVERLAY_SELECTOR)) {
            return;
          }
          e.preventDefault();
          doStop();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [jumpTo]);

  return null;
};

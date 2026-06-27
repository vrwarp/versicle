import type React from 'react';
import { useEffect, useRef } from 'react';
import { useTTSPlaybackStore } from '@store/useTTSPlaybackStore';
import { useReaderUIStore } from '@store/useReaderUIStore';
import { useShallow } from 'zustand/react/shallow';
import { useAudioCommands } from '@app/tts/useAudioCommands';
import { useReaderEngine } from '@domains/reader/ui/ReaderCommands';
import { useTtsPlaybackShortcuts } from '@app/shortcuts/readerShortcuts';

interface ReaderTTSControllerProps {
  viewMode: string;
}

/**
 * Component to handle TTS-related side effects that update frequently.
 * This isolates these updates from the main ReaderView to prevent expensive re-renders
 * of the entire reader interface (and its children) on every sentence change.
 *
 * Handles:
 * 1. Highlighting the current sentence (activeCfi)
 * 2. Keyboard navigation during TTS (KeyboardShortcutService registrations)
 * 3. Visibility reconciliation (syncing visual state when returning to foreground)
 */
export const ReaderTTSController: React.FC<ReaderTTSControllerProps> = ({
  viewMode
}) => {
  // The live engine rides the ReaderCommands context (Phase 6 §5a) —
  // null while the book loads, exactly like the prop it replaced.
  const engine = useReaderEngine();
  // We subscribe to these changing values here, so the shell doesn't have to.
  // Use shallow comparison for primitive values to avoid unnecessary re-renders
  const { activeCfi, status } = useTTSPlaybackStore(useShallow(state => ({
    activeCfi: state.activeCfi,
    status: state.status
  })));

  // Follow mode (the maps-style "navigation" behavior): ON re-centers the
  // page on each spoken sentence; OFF leaves the user's scroll position alone
  // (they scrolled away — the AudioPill's re-center button turns it back ON).
  const followingAudio = useReaderUIStore(state => state.followingAudio);
  const setFollowingAudio = useReaderUIStore(state => state.setFollowingAudio);

  // Engine commands come from the TtsController facade (stable identities).
  const { play, pause, stop, jumpTo } = useAudioCommands();

  // Re-engage following whenever a FRESH playback session starts (the
  // stopped → active transition). Pause/resume preserves the user's current
  // follow state — only a brand-new read snaps the page back to the start.
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (prev === 'stopped' && status !== 'stopped') {
      setFollowingAudio(true);
    }
  }, [status, setFollowingAudio]);

  // --- TTS Highlighting & Sync ---
  useEffect(() => {
    if (!engine || !activeCfi || status === 'stopped') return;
    const highlights = engine.highlights;

    const syncVisuals = () => {
      // Only re-center on the spoken sentence while we're following. If the
      // user has scrolled away (followingAudio === false), we still move the
      // highlight to the current sentence but leave their scroll position
      // untouched — re-running this effect when followingAudio flips back to
      // true (the re-center button) snaps the page to the sentence again.
      if (followingAudio) {
        // Non-blocking display call
        engine.display(activeCfi).catch((err: unknown) => {
          console.warn("[TTS] Sync skipped", err);
        });
      }

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
  }, [activeCfi, viewMode, engine, status, followingAudio]);

  // --- Visibility Reconciliation ---
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && engine) {
        // We just came back to foreground.
        // Fetch the latest state directly from the store to avoid stale closure issues.
        const { activeCfi: freshCfi, status: freshStatus } = useTTSPlaybackStore.getState();

        if (!freshCfi || freshStatus === 'stopped') return;

        // Sync visual state regardless of view mode (paginated or scrolled),
        // but only re-center when following — a user who scrolled away keeps
        // their position across a background → foreground round-trip.
        if (useReaderUIStore.getState().followingAudio) {
          engine.display(freshCfi).catch((err: unknown) => console.warn("Reconciliation failed", err));
        }

        // Ensure the highlight is present: remove-then-add through the
        // manager (each side runs the orphan sweep) so a background queue
        // advance always ends with exactly one live node.
        engine.highlights.remove('tts', freshCfi);
        engine.highlights.add('tts', freshCfi, { onClick: () => { } });
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [engine, viewMode]);

  // --- Keyboard Navigation (Phase 8 §E) ---
  // The window keydown registry + interim gating predicate died here: the
  // sentence jumps / Space play-pause / Escape stop are 'tts-active'-scope
  // registrations on the KeyboardShortcutService (live while
  // playing|paused). The repeat/input/Space-on-control/Escape-overlay
  // policies are the service's built-ins, byte-identical to the hotfix.
  useTtsPlaybackShortcuts({ play, pause, stop, jumpTo });

  return null;
};

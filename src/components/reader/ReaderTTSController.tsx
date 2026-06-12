import type React from 'react';
import { useEffect } from 'react';
import { useTTSPlaybackStore } from '@store/useTTSPlaybackStore';
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

  // Engine commands come from the TtsController facade (stable identities).
  const { play, pause, stop, jumpTo } = useAudioCommands();

  // --- TTS Highlighting & Sync ---
  useEffect(() => {
    if (!engine || !activeCfi || status === 'stopped') return;
    const highlights = engine.highlights;

    const syncVisuals = () => {
      // Non-blocking display call
      engine.display(activeCfi).catch((err: unknown) => {
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
  }, [activeCfi, viewMode, engine, status]);

  // --- Visibility Reconciliation ---
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && engine) {
        // We just came back to foreground.
        // Fetch the latest state directly from the store to avoid stale closure issues.
        const { activeCfi: freshCfi, status: freshStatus } = useTTSPlaybackStore.getState();

        if (!freshCfi || freshStatus === 'stopped') return;

        // Sync visual state regardless of view mode (paginated or scrolled)
        engine.display(freshCfi).catch((err: unknown) => console.warn("Reconciliation failed", err));

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

import { useEffect } from 'react';
import { useTTSPlaybackStore } from '@store/useTTSPlaybackStore';
import { useReaderUIStore } from '@store/useReaderUIStore';
import { useAudioCommands } from '@app/tts/useAudioCommands';

/**
 * Custom hook to manage Text-to-Speech (TTS) functionality.
 * Handles loading sentences from the DB and synchronizing with the engine
 * (via the TtsController command facade).
 */
export const useTTS = () => {
  const currentBookId = useReaderUIStore(state => state.currentBookId);
  const currentSectionId = useReaderUIStore(state => state.currentSectionId);

  const audio = useAudioCommands();
  const { loadVoices, loadSectionBySectionId } = audio;

  // Load voices on mount
  useEffect(() => {
    loadVoices();
  }, [loadVoices]);

  // NOTE (5b-PR4): the pause→play "Dragnet" invalidation on section change is
  // INTERNAL to the engine now (DragnetGesture subscribes to the engine's own
  // section-index changes) — the clearPauseGesture effect that lived here is
  // gone, together with the engine API method.

  // Main Effect: Sync Audio Service with Visual Location (when idle)
  useEffect(() => {
    let ignore = false;

    if (!currentBookId || !currentSectionId) return;

    const syncQueue = async () => {
      const isPlaying = useTTSPlaybackStore.getState().isPlaying;
      // If audio is active, we don't interrupt it just because the user is browsing.
      // Important note: We should not capture status changes.
      if (isPlaying) {
        return;
      }

      // If audio is stopped, we assume the user wants the "Play" button to start
      // from the currently visible chapter.
      // We load it without auto-playing.
      const currentSectionTitle = useReaderUIStore.getState().currentSectionTitle;

      if (!ignore) {
        loadSectionBySectionId(currentSectionId, false, currentSectionTitle || undefined);
      }
    };

    syncQueue();

    return () => {
      ignore = true;
    };
  }, [loadSectionBySectionId, currentBookId, currentSectionId]);

  return {};
};

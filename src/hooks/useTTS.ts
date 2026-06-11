import { useEffect } from 'react';
import { useTTSStore } from '../store/useTTSStore';
import { useReaderUIStore } from '../store/useReaderUIStore';
import { getAudioPlayer } from '../app/tts/mainThreadAudioPlayer';

/**
 * Custom hook to manage Text-to-Speech (TTS) functionality.
 * Handles loading sentences from the DB and synchronizing with AudioPlayerService.
 */
export const useTTS = () => {
  const {
    loadVoices
  } = useTTSStore();

  const currentBookId = useReaderUIStore(state => state.currentBookId);
  const currentSectionId = useReaderUIStore(state => state.currentSectionId);

  const player = getAudioPlayer();

  // Load voices on mount
  useEffect(() => {
    loadVoices();
  }, [loadVoices]);

  // Invalidate the pause→play "Dragnet" capture whenever the reader navigates to a
  // different section. A chapter change between a pause and a play is a deliberate
  // navigation, not a resume gesture, so it must not capture a stale audio-bookmark.
  // This is separate from the queue-sync effect below (which early-returns while playing
  // and whose clear lives inside an enqueued loadSectionInternal that the guard can skip),
  // so the Dragnet is invalidated synchronously the moment the section changes.
  useEffect(() => {
    player.clearPauseGesture();
  }, [player, currentSectionId]);

  // Main Effect: Sync Audio Service with Visual Location (when idle)
  useEffect(() => {
    let ignore = false;

    if (!currentBookId || !currentSectionId) return;

    const syncQueue = async () => {
      const isPlaying = useTTSStore.getState().isPlaying;
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
        player.loadSectionBySectionId(currentSectionId, false, currentSectionTitle || undefined);
      }
    };

    syncQueue();

    return () => {
      ignore = true;
    };
  }, [player, currentBookId, currentSectionId]);

  return {};
};

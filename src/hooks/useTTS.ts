import { useEffect } from 'react';
import { useTTSStore } from '../store/useTTSStore';
import { useReaderStore } from '../store/useReaderStore';
import { AudioPlayerService } from '../lib/tts/AudioPlayerService';

/**
 * Custom hook to manage Text-to-Speech (TTS) functionality.
 * Handles loading sentences from the DB and synchronizing with AudioPlayerService.
 */
export const useTTS = () => {
  const {
    loadVoices
  } = useTTSStore();

  const currentBookId = useReaderStore(state => state.currentBookId);
  const currentSectionId = useReaderStore(state => state.currentSectionId);

  const player = AudioPlayerService.getInstance();

  // Load voices on mount
  useEffect(() => {
      loadVoices();
  }, [loadVoices]);

  // Main Effect: Sync Audio Service with Visual Location (when idle)
  useEffect(() => {
    if (!currentBookId || !currentSectionId) return;

    const syncQueue = async () => {
         const status = useTTSStore.getState().status;
         // If audio is active, we don't interrupt it just because the user is browsing.
         // Important note: We should not capture status changes.
         if (status === 'playing') {
             return;
         }

         // If audio is stopped, we assume the user wants the "Play" button to start
         // from the currently visible chapter.
         // We load it without auto-playing.
         player.loadSectionBySectionId(currentSectionId, false);
    };

    syncQueue();

  }, [player, currentBookId, currentSectionId]);

  return {};
};

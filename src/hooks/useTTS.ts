import { useEffect } from 'react';
import { useTTSStore } from '../store/useTTSStore';
import { AudioPlayerService } from '../lib/tts/AudioPlayerService';

/**
 * Custom hook to manage Text-to-Speech (TTS) functionality.
 * New Role: Pure subscriber. Data loading is now handled by AudioPlayerService.
 */
export const useTTS = () => {
  const {
    loadVoices
  } = useTTSStore();

  const player = AudioPlayerService.getInstance();

  // Load voices on mount
  useEffect(() => {
      loadVoices();
  }, [loadVoices]);

  // Cleanup on unmount
  useEffect(() => {
      return () => {
          player.stop();
      };
  }, [player]);

  return {};
};

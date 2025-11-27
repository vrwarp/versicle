import { useEffect, useState } from 'react';
import { useTTSStore } from '../store/useTTSStore';
import { extractSentences, type SentenceNode } from '../lib/tts';
import { Rendition } from 'epubjs';
import { AudioPlayerService } from '../lib/tts/AudioPlayerService';

/**
 * Custom hook to manage Text-to-Speech (TTS) functionality.
 * Handles extracting sentences from the current rendition and synchronizing with AudioPlayerService.
 *
 * @param rendition - The current epubjs Rendition object, used to extract text content.
 * @returns An object containing the extracted sentences for the current view.
 */
export const useTTS = (rendition: Rendition | null) => {
  const {
    loadVoices
  } = useTTSStore();

  const [sentences, setSentences] = useState<SentenceNode[]>([]);
  const player = AudioPlayerService.getInstance();

  // Load voices on mount
  useEffect(() => {
      loadVoices();
  }, [loadVoices]);

  // Load sentences when chapter changes
  useEffect(() => {
    if (!rendition) return;

    const loadSentences = () => {
       try {
           const extracted = extractSentences(rendition);
           setSentences(extracted);

           // Update player queue
           // We map SentenceNode to the format expected by AudioPlayerService
           const queue = extracted.map(s => ({
               text: s.text,
               cfi: s.cfi
           }));
           player.setQueue(queue);

       } catch (e) {
           console.error("Failed to extract sentences", e);
           setSentences([]);
           player.setQueue([]);
       }
    };

    rendition.on('rendered', loadSentences);
    // Also try immediately if already rendered
    if (rendition.getContents().length > 0) {
        loadSentences();
    }

    return () => {
        rendition.off('rendered', loadSentences);
    };
  }, [rendition, player]);

  // Cleanup on unmount
  useEffect(() => {
      return () => {
          player.stop();
      };
  }, [player]);

  return {
     sentences
  };
};

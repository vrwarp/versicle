import { useEffect, useState } from 'react';
import { useTTSStore } from '../store/useTTSStore';
import { extractSentences, type SentenceNode } from '../lib/tts';
import { Rendition } from 'epubjs';

/**
 * Custom hook to manage Text-to-Speech (TTS) functionality.
 * Handles extracting sentences from the current rendition and synchronizing with AudioPlayerService.
 *
 * @param rendition - The current epubjs Rendition object, used to extract text content.
 * @returns An object containing the extracted sentences for the current view.
 */
export const useTTS = (rendition: Rendition | null) => {
  const {
    loadVoices,
    setQueue,
    stop
  } = useTTSStore();

  const [sentences, setSentences] = useState<SentenceNode[]>([]);

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

           // Update player queue via store
           const queue = extracted.map(s => ({
               text: s.text,
               cfi: s.cfi
           }));
           setQueue(queue);

       } catch (e) {
           console.error("Failed to extract sentences", e);
           setSentences([]);
           setQueue([]);
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
  }, [rendition, setQueue]);

  // Cleanup on unmount
  useEffect(() => {
      return () => {
          stop();
      };
  }, [stop]);

  return {
     sentences
  };
};

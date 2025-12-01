import { useEffect, useState } from 'react';
import { useTTSStore } from '../store/useTTSStore';
import { useReaderStore } from '../store/useReaderStore';
import { extractSentences, type SentenceNode } from '../lib/tts';
import type { Rendition } from 'epubjs';
import { AudioPlayerService, type TTSQueueItem } from '../lib/tts/AudioPlayerService';

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
    prerollEnabled,
    rate
  } = useTTSStore();

  const { currentChapterTitle, currentCfi } = useReaderStore(state => ({
      currentChapterTitle: state.currentChapterTitle,
      currentCfi: state.currentCfi
  }));

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
           const queue: TTSQueueItem[] = extracted.map(s => ({
               text: s.text,
               cfi: s.cfi
           }));

           if (prerollEnabled && queue.length > 0) {
               // Calculate word count
               const wordCount = extracted.reduce((acc, s) => acc + s.text.split(/\s+/).length, 0);
               const title = currentChapterTitle || "Chapter";

               const prerollText = player.generatePreroll(title, wordCount, rate);

               const prerollItem: TTSQueueItem = {
                   text: prerollText,
                   cfi: null,
                   title: title,
                   isPreroll: true
               };

               queue.unshift(prerollItem);
           }

           player.setQueue(queue);

       } catch (e) {
           console.error("Failed to extract sentences", e);
           setSentences([]);
           player.setQueue([]);
       }
    };

    rendition.on('rendered', loadSentences);
    rendition.on('relocated', loadSentences);

    // Also try immediately if already rendered
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((rendition as any).getContents().length > 0) {
        loadSentences();
    }

    return () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (rendition as any).off('rendered', loadSentences);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (rendition as any).off('relocated', loadSentences);
    };
  }, [rendition, player, currentCfi]); // Re-run when CFI changes to ensure sync

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

import { useEffect, useState, useRef } from 'react';
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

  const { currentChapterTitle } = useReaderStore(state => ({
      currentChapterTitle: state.currentChapterTitle
  }));

  const [sentences, setSentences] = useState<SentenceNode[]>([]);
  const player = AudioPlayerService.getInstance();
  const lastLoadedHref = useRef<string | null>(null);

  // Load voices on mount
  useEffect(() => {
      loadVoices();
  }, [loadVoices]);

  // Load sentences when chapter changes
  useEffect(() => {
    if (!rendition) return;

    const loadSentences = () => {
       try {
           // Check if chapter has changed
           // eslint-disable-next-line @typescript-eslint/no-explicit-any
           const currentLocation = (rendition as any).currentLocation();
           const currentHref = currentLocation?.start?.href;

           // If we have loaded this chapter already, don't reload queue
           // This prevents queue reset on page turns in paginated mode
           if (currentHref && currentHref === lastLoadedHref.current) {
               return;
           }

           if (currentHref) {
               lastLoadedHref.current = currentHref;
           }

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
  }, [rendition, player]); // Removed currentCfi dependency

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

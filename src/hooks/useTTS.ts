import { useEffect, useState, useRef } from 'react';
import { useTTSStore } from '../store/useTTSStore';
import { useReaderStore } from '../store/useReaderStore';
import { extractSentences, type SentenceNode } from '../lib/tts';
import type { Rendition } from 'epubjs';
import { AudioPlayerService, type TTSQueueItem } from '../lib/tts/AudioPlayerService';

const NO_TEXT_MESSAGES = [
    "This chapter appears to be empty.",
    "There is no text to read here.",
    "This page contains only images or formatting.",
    "Silence fills this chapter.",
    "Moving on, as this section has no content.",
    "No words found on this page.",
    "This section is blank.",
    "Skipping this empty section.",
    "Nothing to read here.",
    "This part of the book is silent."
];

/**
 * Custom hook to manage Text-to-Speech (TTS) functionality.
 * Handles extracting sentences from the current rendition and synchronizing with AudioPlayerService.
 *
 * @param rendition - The current epubjs Rendition object, used to extract text content.
 * @returns An object containing the extracted sentences for the current view.
 */
export const useTTS = (rendition: Rendition | null, isReady: boolean) => {
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
           let currentHref: string | undefined;
           try {
               // eslint-disable-next-line @typescript-eslint/no-explicit-any
               const currentLocation = (rendition as any).currentLocation();
               currentHref = currentLocation?.start?.href;
           } catch (err) {
               console.warn("[TTS] Could not get current location", err);
           }

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

           let queue: TTSQueueItem[] = [];

           if (extracted.length === 0) {
               // Handle empty chapter
               const randomMessage = NO_TEXT_MESSAGES[Math.floor(Math.random() * NO_TEXT_MESSAGES.length)];
               queue.push({
                   text: randomMessage,
                   cfi: null,
                   title: currentChapterTitle || "Empty Chapter",
                   isPreroll: true // Treat as system message
               });
           } else {
               // Map extracted sentences
               queue = extracted.map(s => ({
                   text: s.text,
                   cfi: s.cfi
               }));
           }

           if (prerollEnabled && extracted.length > 0) {
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

       } catch {
           setSentences([]);
           player.setQueue([]);
       }
    };

    rendition.on('rendered', loadSentences);
    rendition.on('relocated', loadSentences);

    // Also try immediately if already rendered or if the book is ready
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contents = (rendition as any).getContents();

    if (isReady || (contents.length > 0 && contents[0].document && contents[0].document.body)) {
        loadSentences();
    }

    return () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (rendition as any).off('rendered', loadSentences);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (rendition as any).off('relocated', loadSentences);
    };
  }, [rendition, player, isReady]); // Removed currentCfi dependency

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

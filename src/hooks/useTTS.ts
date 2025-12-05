import { useEffect, useState, useRef } from 'react';
import { useTTSStore } from '../store/useTTSStore';
import { useReaderStore } from '../store/useReaderStore';
import { extractSentences, type SentenceNode } from '../lib/tts';
import type { Rendition } from 'epubjs';
import { AudioPlayerService, type TTSQueueItem } from '../lib/tts/AudioPlayerService';
import type { BookMetadata } from '../types/db';

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
 * @param metadata - The metadata of the current book.
 * @returns An object containing the extracted sentences for the current view.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const useTTS = (rendition: Rendition | null, metadata?: BookMetadata | null) => {
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

  // Manage temporary cover URL to prevent memory leaks
  const [generatedCoverUrl, setGeneratedCoverUrl] = useState<string | undefined>(undefined);

  // Load voices on mount
  useEffect(() => {
      loadVoices();
  }, [loadVoices]);

  // Generate and cleanup cover URL
  useEffect(() => {
      let url: string | undefined = undefined;

      if (metadata?.coverUrl) {
          setGeneratedCoverUrl(metadata.coverUrl);
      } else if (metadata?.coverBlob) {
          try {
              url = URL.createObjectURL(metadata.coverBlob);
              setGeneratedCoverUrl(url);
          } catch (e) {
              console.error("Failed to create object URL for cover", e);
          }
      } else {
          setGeneratedCoverUrl(undefined);
      }

      return () => {
          if (url) {
              URL.revokeObjectURL(url);
          }
      };
  }, [metadata?.coverUrl, metadata?.coverBlob]);

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

           let queue: TTSQueueItem[] = [];

           const baseItem = {
               bookId: metadata?.id,
               bookTitle: metadata?.title,
               author: metadata?.author,
               coverUrl: generatedCoverUrl,
           };

           if (extracted.length === 0) {
               // Handle empty chapter
               const randomMessage = NO_TEXT_MESSAGES[Math.floor(Math.random() * NO_TEXT_MESSAGES.length)];
               queue.push({
                   ...baseItem,
                   text: randomMessage,
                   cfi: null,
                   title: currentChapterTitle || "Empty Chapter",
                   isPreroll: true // Treat as system message
               });
           } else {
               // Map extracted sentences
               queue = extracted.map(s => ({
                   ...baseItem,
                   text: s.text,
                   cfi: s.cfi,
                   title: currentChapterTitle || "Chapter"
               }));
           }

           if (prerollEnabled && extracted.length > 0) {
               // Calculate word count
               const wordCount = extracted.reduce((acc, s) => acc + s.text.split(/\s+/).length, 0);
               const title = currentChapterTitle || "Chapter";

               const prerollText = player.generatePreroll(title, wordCount, rate);

               const prerollItem: TTSQueueItem = {
                   ...baseItem,
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
  }, [rendition, player, metadata?.id, metadata?.title, metadata?.author, generatedCoverUrl]); // Use stable generatedCoverUrl

  // Cleanup on unmount
  // Removed player.stop() to allow persistent playback

  return {
     sentences
  };
};

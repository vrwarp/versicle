import { useEffect, useState } from 'react';
import { useTTSStore } from '../store/useTTSStore';
import { useReaderStore } from '../store/useReaderStore';
import type { SentenceNode } from '../lib/tts';
import { AudioPlayerService, type TTSQueueItem } from '../lib/tts/AudioPlayerService';
import { dbService } from '../db/DBService';

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
 * Handles loading sentences from the DB and synchronizing with AudioPlayerService.
 *
 * @returns An object containing the extracted sentences for the current view.
 */
export const useTTS = () => {
  const {
    loadVoices
  } = useTTSStore();

  const currentChapterTitle = useReaderStore(state => state.currentChapterTitle);
  const currentBookId = useReaderStore(state => state.currentBookId);
  const currentSectionId = useReaderStore(state => state.currentSectionId);

  const [sentences, setSentences] = useState<SentenceNode[]>([]);
  const player = AudioPlayerService.getInstance();

  // Load voices on mount
  useEffect(() => {
      loadVoices();
  }, [loadVoices]);

  // Main Effect: Load Content from DB
  useEffect(() => {
    let isMounted = true;

    const loadQueue = async () => {
        if (!currentBookId || !currentSectionId) return;

        try {
             const stored = await dbService.getTTSContent(currentBookId, currentSectionId);

             if (!isMounted) return;

             if (stored && stored.sentences.length > 0) {
                 // Convert to SentenceNodes for local state
                 const sentenceNodes: SentenceNode[] = stored.sentences.map(s => ({
                     text: s.text,
                     cfi: s.cfi
                 }));
                 setSentences(sentenceNodes);

                 // Build Queue
                 const queue: TTSQueueItem[] = stored.sentences.map(s => ({
                     text: s.text,
                     cfi: s.cfi
                 }));

                 // Check store for updated settings
                 const { prerollEnabled, rate } = useTTSStore.getState();

                 if (prerollEnabled) {
                     const wordCount = stored.sentences.reduce((acc, s) => acc + s.text.split(/\s+/).length, 0);
                     const title = currentChapterTitle || "Chapter";
                     const prerollText = player.generatePreroll(title, wordCount, rate);

                     queue.unshift({
                         text: prerollText,
                         cfi: null,
                         title: title,
                         isPreroll: true
                     });
                 }

                 player.setQueue(queue);
             } else {
                 // Handle empty chapter
                 setSentences([]);

                 const randomMessage = NO_TEXT_MESSAGES[Math.floor(Math.random() * NO_TEXT_MESSAGES.length)];
                 const queue: TTSQueueItem[] = [{
                       text: randomMessage,
                       cfi: null,
                       title: currentChapterTitle || "Empty Chapter",
                       isPreroll: true
                 }];
                 player.setQueue(queue);
             }
        } catch (err) {
             console.warn("[TTS] Failed to load from DB", err);
             if (isMounted) {
                 setSentences([]);
                 player.setQueue([]);
             }
        }
    };

    loadQueue();

    return () => {
        isMounted = false;
    };

  }, [player, currentBookId, currentSectionId, currentChapterTitle]);

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

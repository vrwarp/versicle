import { useEffect, useState, useRef } from 'react';
import { useTTSStore } from '../store/useTTSStore';
import { useReaderStore } from '../store/useReaderStore';
import { extractSentences, type SentenceNode } from '../lib/tts';
import type { Rendition } from 'epubjs';
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

  const currentChapterTitle = useReaderStore(state => state.currentChapterTitle);
  const currentBookId = useReaderStore(state => state.currentBookId);
  const currentSectionId = useReaderStore(state => state.currentSectionId);

  const [sentences, setSentences] = useState<SentenceNode[]>([]);
  const player = AudioPlayerService.getInstance();
  const lastLoadedHref = useRef<string | null>(null);

  // Track if we are using content from the DB to avoid double-loading or overwriting with legacy extraction
  const usingStoredContent = useRef<boolean>(false);

  // Load voices on mount
  useEffect(() => {
      loadVoices();
  }, [loadVoices]);

  // Main Effect: Load Content (DB Priority -> Legacy Fallback)
  useEffect(() => {
    let isMounted = true;

    // legacyLoadSentences checks (currentHref === lastLoadedHref.current) to avoid page-turn reloads.
    // If we update lastLoadedHref prematurely, we break that check if DB load fails.
    // So we ONLY update lastLoadedHref when we successfully load content (DB or Legacy).

    const legacyLoadSentences = (force = false) => {
       if (!isMounted) return;

       // If we successfully loaded from DB, ignore legacy events for this chapter
       if (usingStoredContent.current) return;

       if (!rendition) return;

       try {
           // Double check we are on the right chapter (sometimes legacy events fire late)
           let currentHref: string | undefined;
           try {
               // eslint-disable-next-line @typescript-eslint/no-explicit-any
               const currentLocation = (rendition as any).currentLocation();
               currentHref = currentLocation?.start?.href;
           } catch (err) {
               console.warn("[TTS] Could not get current location", err);
           }

           // If NOT forced (i.e., triggered by 'relocated'), check if we actually changed chapters.
           // This prevents re-extracting text on every page turn in paginated mode.
           if (!force && currentHref && currentHref === lastLoadedHref.current) {
               return;
           }

           // Update last loaded href if we have one
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
           if (!usingStoredContent.current) {
               setSentences([]);
               player.setQueue([]);
           }
       }
    };

    const loadQueue = async () => {
        // --- Strategy A: Try to load from DB (Decoupled Mode) ---
        if (currentBookId && currentSectionId) {
             try {
                 const stored = await dbService.getTTSContent(currentBookId, currentSectionId);

                 if (!isMounted) return; // Prevent race condition updates

                 if (stored && stored.sentences.length > 0) {
                     usingStoredContent.current = true;

                     // Only update lastLoadedHref if DB load succeeds
                     if (currentSectionId) lastLoadedHref.current = currentSectionId;

                     // Convert to SentenceNodes for local state
                     const sentenceNodes: SentenceNode[] = stored.sentences.map(s => ({
                         text: s.text,
                         cfi: s.cfi
                     }));
                     setSentences(sentenceNodes);

                     // Build Queue
                     let queue: TTSQueueItem[] = stored.sentences.map(s => ({
                         text: s.text,
                         cfi: s.cfi
                     }));

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
                     // Success! Exit early.
                     return;
                 }
             } catch (err) {
                 console.warn("[TTS] Failed to load from DB, falling back to legacy", err);
             }
        }

        if (!isMounted) return;

        // --- Strategy B: Legacy Fallback (Rendered Mode) ---
        usingStoredContent.current = false;

        // If we are falling back, we need 'rendition' to be available.
        // We trigger the legacy logic via the event listeners below,
        // but we might need to trigger it manually if already rendered.
        if (rendition && isReady) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const contents = (rendition as any).getContents();
            if (contents.length > 0 && contents[0].document && contents[0].document.body) {
                legacyLoadSentences(true); // Force load since we are initializing/changing chapter
            }
        }
    };

    let cleanupListeners: (() => void) | undefined;

    // Attach Legacy Listeners
    if (rendition) {
        const onLegacyRendered = () => legacyLoadSentences(false);
        const onLegacyRelocated = () => legacyLoadSentences(false);

        rendition.on('rendered', onLegacyRendered);
        rendition.on('relocated', onLegacyRelocated);

        cleanupListeners = () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (rendition as any).off('rendered', onLegacyRendered);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (rendition as any).off('relocated', onLegacyRelocated);
        };
    }

    // Trigger Load
    loadQueue();

    return () => {
        isMounted = false;
        if (cleanupListeners) cleanupListeners();
    };

  }, [rendition, player, isReady, currentBookId, currentSectionId, currentChapterTitle, prerollEnabled, rate]);

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

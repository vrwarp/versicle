import { useEffect, useState } from 'react';
import { useTTSStore } from '../store/useTTSStore';
import { useReaderStore } from '../store/useReaderStore';
import { getDB } from '../db/db';

const CHARS_PER_MINUTE_BASE = 180 * 5; // 180 words/min * 5 chars/word

/**
 * Interface for estimated reading/listening durations.
 */
interface DurationEstimates {
  /** Estimated time remaining in the current chapter (minutes). */
  chapterRemaining: number | null;
  /** Estimated time remaining in the entire book (minutes). */
  bookRemaining: number | null;
  /** Estimated total duration of the book (minutes). */
  totalBookDuration: number | null;
}

/**
 * Hook to calculate reading duration estimates based on current position and TTS rate.
 * Uses character counts stored in the database and current TTS queue for precision.
 *
 * @returns An object containing duration estimates.
 */
export const useChapterDuration = (): DurationEstimates => {
  const { queue, currentIndex, rate } = useTTSStore();
  const { currentBookId, currentSectionId } = useReaderStore();

  const [estimates, setEstimates] = useState<DurationEstimates>({
    chapterRemaining: null,
    bookRemaining: null,
    totalBookDuration: null,
  });

  useEffect(() => {
    let isMounted = true;

    const calculateDurations = async () => {
      if (!currentBookId) {
        if (isMounted) {
           setEstimates({
                chapterRemaining: null,
                bookRemaining: null,
                totalBookDuration: null,
            });
        }
        return;
      }

      const db = await getDB();
      const book = await db.get('books', currentBookId);
      if (!book || book.totalChars === undefined) {
         if (isMounted) {
             setEstimates({
                chapterRemaining: null,
                bookRemaining: null,
                totalBookDuration: null,
             });
         }
         return;
      }

      const sections = await db.getAllFromIndex('sections', 'by_bookId', currentBookId);
      // Sort by playOrder to ensure correct sequence
      sections.sort((a, b) => a.playOrder - b.playOrder);

      const effectiveRate = Math.max(0.1, rate); // Clamp rate to avoid division by zero
      const charsPerMinute = CHARS_PER_MINUTE_BASE * effectiveRate;

      // 1. Calculate Chapter Remaining
      let chapterRemainingChars = 0;

      // Check if queue is valid and active for the current book/chapter context
      // Note: Since queue doesn't explicitly store bookId/sectionId in the store root (it's in items),
      // we do a heuristic check or just assume if queue is present it MIGHT be relevant.
      // However, strictly speaking we should verify.
      // For now, adhering to the plan: if TTS is active (queue has items), use it for high precision.
      // But we need to be careful if the queue is from a different book.
      // The current TTS architecture implies one active queue.

      // We will assume the queue corresponds to the current reading session if it's not empty.
      // If the user navigates to another book, usually the queue might be cleared or persisted.
      // Given the constraints, let's look at the queue.

      if (queue.length > 0 && currentIndex < queue.length) {
         // Calculate remaining chars in queue
         for (let i = currentIndex; i < queue.length; i++) {
             chapterRemainingChars += queue[i].text.length;
         }
      } else {
         // Fallback to section metadata
         const currentSection = sections.find(s => s.sectionId === currentSectionId);
         if (currentSection) {
             chapterRemainingChars = currentSection.characterCount;
         }
      }

      const chapterRemaining = chapterRemainingChars / charsPerMinute;


      // 2. Calculate Book Remaining
      let bookRemainingChars = 0;

      // Find index of current section
      const currentSectionIndex = sections.findIndex(s => s.sectionId === currentSectionId);

      if (currentSectionIndex !== -1) {
          // Add remaining chars of current chapter
          bookRemainingChars += chapterRemainingChars;

          // Add all future chapters
          for (let i = currentSectionIndex + 1; i < sections.length; i++) {
              bookRemainingChars += sections[i].characterCount;
          }
      } else {
          // If we can't find the section, we can't estimate remaining time accurately
          // Potentially just return total duration or null.
          // Plan says: "Returning null (or just the Total duration as a safe fallback) prevents user confusion."
          // We'll return null for book remaining if we don't know where we are.
          bookRemainingChars = -1;
      }

      const bookRemaining = bookRemainingChars !== -1 ? bookRemainingChars / charsPerMinute : null;


      // 3. Calculate Total Book Duration
      const totalBookDuration = book.totalChars / charsPerMinute;

      if (isMounted) {
        setEstimates({
            chapterRemaining,
            bookRemaining,
            totalBookDuration
        });
      }
    };

    calculateDurations();

    return () => {
      isMounted = false;
    };
  }, [currentBookId, currentSectionId, queue, currentIndex, rate]);

  return estimates;
};

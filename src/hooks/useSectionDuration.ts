import { useMemo } from 'react';
import { useTTSStore } from '../store/useTTSStore';
import { useReaderUIStore } from '../store/useReaderUIStore';
import { useBookStore } from '../store/useBookStore';
import { containsCJK, isCJKLanguageCode } from '../lib/utils';
import { useShallow } from 'zustand/react/shallow';

export function useSectionDuration() {
  const queue = useTTSStore(state => state.queue);
  const index = useTTSStore(state => state.currentIndex);
  const rate = useTTSStore(state => state.rate);

  const currentBookId = useReaderUIStore(state => state.currentBookId);
  // Only select language to prevent excessive re-renders
  const bookLanguage = useBookStore(
    useShallow(state => currentBookId ? state.books[currentBookId]?.language : undefined)
  );

  // Determine if the context is CJK
  const isCJK = useMemo(() => {
    // Primary: Trust explicit metadata
    if (bookLanguage) {
      return isCJKLanguageCode(bookLanguage);
    }

    // Fallback: JIT Regex on the queue
    if (queue && queue.length > 0 && queue[0].text) {
      return containsCJK(queue[0].text);
    }

    return false; // Default to English/Latin
  }, [bookLanguage, queue]);

  // Memoize cumulative lengths to avoid O(N) iteration on every render/sentence change.
  // This array stores the cumulative character count up to each index.
  // prefixSums[i] = total characters in queue[0...i-1]
  const prefixSums = useMemo(() => {
    if (!queue || queue.length === 0) return [0];
    const sums = new Array(queue.length + 1).fill(0);
    for (let i = 0; i < queue.length; i++) {
        sums[i + 1] = sums[i] + (queue[i].text?.length || 0);
    }
    return sums;
  }, [queue]);

  if (!queue || queue.length === 0) {
    return { timeRemaining: 0, progress: 0 };
  }

  // Ensure index is within bounds
  const validIndex = Math.max(0, Math.min(index, queue.length));

  const totalChars = prefixSums[queue.length];
  const consumedChars = prefixSums[validIndex];
  const remainingChars = totalChars - consumedChars;

  // Progress based on sentence count as per plan
  const progress = (validIndex / (queue.length || 1)) * 100;

  // Apply the correct baseline multiplier based on context
  const baseCPM = isCJK ? 300 : 900;
  const charsPerMinute = baseCPM * (rate || 1);
  const minutesRemaining = remainingChars / charsPerMinute;

  return {
    timeRemaining: minutesRemaining,
    progress
  };
}

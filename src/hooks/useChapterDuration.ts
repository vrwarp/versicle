import { useMemo } from 'react';
import { useTTSStore } from '../store/useTTSStore';

export function useChapterDuration() {
  const queue = useTTSStore(state => state.queue);
  const index = useTTSStore(state => state.currentIndex);
  const rate = useTTSStore(state => state.rate);

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

  // Base WPM = 180. Avg chars per word = 5. -> Chars per minute = 180 * 5 = 900.
  const charsPerMinute = 900 * (rate || 1);
  const minutesRemaining = remainingChars / charsPerMinute;

  return {
    timeRemaining: minutesRemaining,
    progress
  };
}

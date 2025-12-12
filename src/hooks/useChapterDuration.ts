import { useTTSStore } from '../store/useTTSStore';

export function useChapterDuration() {
  const queue = useTTSStore(state => state.queue);
  const index = useTTSStore(state => state.currentIndex);
  const rate = useTTSStore(state => state.rate);

  if (!queue || queue.length === 0) {
    return { timeRemaining: 0, progress: 0 };
  }

  // Calculate remaining characters from current index to end
  let remainingChars = 0;
  // Ensure index is within bounds
  const validIndex = Math.max(0, Math.min(index, queue.length));

  for (let i = validIndex; i < queue.length; i++) {
    remainingChars += queue[i].text.length;
  }

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

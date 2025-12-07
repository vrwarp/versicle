import { useTTSStore } from '../store/useTTSStore';
import { useMemo } from 'react';

/**
 * Hook to calculate the estimated remaining duration of the current chapter (queue).
 * Assumes English words are approx 5 characters, and a standard reading speed is 180 WPM.
 * Adjusts for the current playback rate.
 *
 * @returns Estimated time remaining in minutes (number) and formatted string.
 */
export function useChapterDuration() {
  const queue = useTTSStore(state => state.queue);
  const index = useTTSStore(state => state.currentIndex);
  const rate = useTTSStore(state => state.rate);

  const { remainingMinutes, formattedTime } = useMemo(() => {
    if (!queue || queue.length === 0 || index >= queue.length) {
      return { remainingMinutes: 0, formattedTime: '00:00' };
    }

    // Calculate remaining text length (approx chars)
    // We sum the length of remaining items in the queue
    let totalChars = 0;
    for (let i = index; i < queue.length; i++) {
        totalChars += queue[i].text.length;
    }

    // Assumptions:
    // Avg chars per word = 5
    // Base WPM = 180 (average reading speed for English)
    const avgCharsPerWord = 5;
    const baseWPM = 180;

    // Adjusted WPM based on playback rate
    const adjustedWPM = baseWPM * rate;

    const totalWords = totalChars / avgCharsPerWord;
    const minutes = totalWords / adjustedWPM;

    // Format as MM:SS
    const totalSeconds = Math.floor(minutes * 60);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    const formatted = `${m}:${s.toString().padStart(2, '0')}`;

    return { remainingMinutes: minutes, formattedTime: formatted };
  }, [queue, index, rate]);

  return { remainingMinutes, formattedTime };
}

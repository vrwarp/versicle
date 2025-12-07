import { useMemo } from 'react';
import { useTTSStore } from '../store/useTTSStore';

/**
 * Hook to estimate the remaining time in the current chapter based on the TTS queue.
 *
 * Logic:
 * 1. Calculate remaining characters in the queue (from currentIndex to end).
 * 2. Estimate time based on standard reading speed (approx 180 wpm) and current playback rate.
 * 3. Formats the result as a localized string (e.g. "-12 min").
 *
 * @returns formatted time string or null if queue is empty.
 */
export function useChapterDuration() {
  const queue = useTTSStore(state => state.queue);
  const index = useTTSStore(state => state.currentIndex);
  const rate = useTTSStore(state => state.rate);

  const remainingTime = useMemo(() => {
    if (!queue || queue.length === 0 || index >= queue.length) {
      return null;
    }

    // Calculate total characters remaining
    let totalChars = 0;
    for (let i = index; i < queue.length; i++) {
      totalChars += queue[i].text.length;
    }

    // Base WPM assumption for English is ~180-200.
    // Average characters per word is ~5.
    // So chars per minute = 180 * 5 = 900.
    const BASE_CHARS_PER_MINUTE = 900;

    // Adjust for current playback rate
    const charsPerMinute = BASE_CHARS_PER_MINUTE * rate;

    const minutesRemaining = totalChars / charsPerMinute;

    if (minutesRemaining < 1) {
      return '< 1 min';
    }

    return `${Math.round(minutesRemaining)} min`;
  }, [queue, index, rate]);

  return remainingTime;
}

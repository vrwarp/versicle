/**
 * Estimated reading time for a book, from its character count — shared by
 * BookCard and BookListItem; the rendering rides the locale-aware kernel
 * formatter.
 *
 * Heuristic: 180 wpm × 5 chars/word.
 */
import { formatDuration } from '@kernel/locale/format';

export function formatReadingTime(chars?: number): string | null {
  if (!chars) return null;
  const minutes = Math.ceil(chars / (180 * 5));
  return formatDuration(minutes);
}

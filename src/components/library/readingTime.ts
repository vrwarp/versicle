/**
 * Estimated reading time for a book, from its character count — the ONE
 * copy (Phase 8 §F): BookCard and BookListItem carried byte-identical
 * `formatDuration(chars)` implementations; the rendering now rides the
 * locale-aware kernel formatter.
 *
 * Heuristic preserved verbatim: 180 wpm × 5 chars/word.
 */
import { formatDuration } from '@kernel/locale/format';

export function formatReadingTime(chars?: number): string | null {
  if (!chars) return null;
  const minutes = Math.ceil(chars / (180 * 5));
  return formatDuration(minutes);
}

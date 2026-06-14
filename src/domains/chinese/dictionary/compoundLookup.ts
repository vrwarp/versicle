/**
 * compoundLookup — adjacent compound-word resolution inside a selection
 * (Phase 6 §7.4, prep doc PR-11; moved from the inline `getCompoundWord`
 * in CompassPill.tsx and made pure + async-lookup friendly).
 *
 * Semantics preserved from the legacy helper: candidate windows reach up
 * to 4 characters left and 4 right of the focused character; the LONGEST
 * dictionary hit wins, earliest start breaking ties (the legacy iteration
 * order kept the first strictly-longer hit). One deliberate fix, in line
 * with CH-1: windows are CODE-POINT windows (`Array.from`), so a selection
 * containing astral Han or emoji no longer slices through surrogate pairs
 * — the triage card already indexes tiles by code point.
 */
import type { DictEntryTuple } from '@data/repos/dictionary';

export interface CompoundHit {
  word: string;
  pinyin: string;
  definition: string;
}

/**
 * All multi-character candidate windows (length > 1) around `charIndex`
 * (a CODE-POINT index into `text`), ordered by start asc, end asc — the
 * legacy scan order, which the picker relies on for tie-breaking.
 */
export function compoundCandidates(text: string, charIndex: number): string[] {
  const chars = Array.from(text);
  const candidates: string[] = [];
  for (let start = Math.max(0, charIndex - 4); start <= charIndex; start++) {
    for (let end = charIndex + 1; end <= Math.min(chars.length, charIndex + 5); end++) {
      const substring = chars.slice(start, end).join('');
      if (Array.from(substring).length > 1) {
        candidates.push(substring);
      }
    }
  }
  return candidates;
}

/**
 * Resolve the compound word covering `charIndex`: ONE batched lookup over
 * the candidate windows, then the longest hit (earliest start on ties).
 * Lengths compare in code points — same metric as the windows.
 */
export async function findCompoundWord(
  text: string,
  charIndex: number,
  lookup: (words: readonly string[]) => Promise<Map<string, DictEntryTuple>>,
): Promise<CompoundHit | null> {
  const candidates = compoundCandidates(text, charIndex);
  if (candidates.length === 0) return null;

  const entries = await lookup([...new Set(candidates)]);

  let best: CompoundHit | null = null;
  let bestLength = 1;
  for (const candidate of candidates) {
    const entry = entries.get(candidate);
    if (!entry) continue;
    const length = Array.from(candidate).length;
    if (length > bestLength) {
      bestLength = length;
      best = { word: candidate, pinyin: entry[0], definition: entry[1] };
    }
  }
  return best;
}

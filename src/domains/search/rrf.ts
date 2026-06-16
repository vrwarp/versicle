/**
 * fuseRrf (Increment D §3) — reciprocal-rank fusion of the regex full-text
 * results and the semantic-cosine results into ONE ranked list.
 *
 * Each list contributes `1/(k + rank)` per result (rank is 1-based), summed
 * across both lists for results that appear in both; the combined score sorts
 * descending. Dedup key is `${href}|${charOffset}` (the same occurrence found
 * by both paths fuses into one hit, keeping the regex hit's richer fields like
 * the per-section `occurrence`). `k=60` is the standard RRF constant — it
 * damps the head so a #1 in one list doesn't dwarf a strong #2/#3 in the other.
 *
 * Pure: imports only ~types/search. Exact-match regex wins (names/quotes)
 * survive while "passage about X" semantic hits join, never displacing them.
 * `truncated` is carried through from the caller (the regex scan's honest cap).
 */
import type { DetailedSearchResult, SearchBatchResult } from '~types/search';

const DEFAULT_K = 60;

const dedupKey = (r: DetailedSearchResult): string => `${r.href}|${r.charOffset}`;

export function fuseRrf(
  regex: DetailedSearchResult[],
  semantic: DetailedSearchResult[],
  opts: { k?: number; truncated?: boolean } = {},
): SearchBatchResult {
  const k = opts.k ?? DEFAULT_K;

  // result + summed RRF score, keyed by occurrence. The first list to surface
  // a result owns the carried fields (regex first → regex's occurrence wins).
  const fused = new Map<string, { result: DetailedSearchResult; score: number }>();

  const accumulate = (list: DetailedSearchResult[]): void => {
    list.forEach((result, i) => {
      const rank = i + 1; // 1-based
      const contribution = 1 / (k + rank);
      const key = dedupKey(result);
      const existing = fused.get(key);
      if (existing) {
        existing.score += contribution;
      } else {
        fused.set(key, { result, score: contribution });
      }
    });
  };

  // Regex first so its richer fields (occurrence) win the dedup tie.
  accumulate(regex);
  accumulate(semantic);

  const results = [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.result);

  // Propagate truncation: the fused page is honest about either source having
  // been capped (the regex full-text scan reaching its limit).
  return { results, truncated: opts.truncated ?? false };
}

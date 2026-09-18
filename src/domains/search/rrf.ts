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

/**
 * Hard cap on the fused page. The semantic side contributes up to
 * SEMANTIC_SECTION_LIMIT (50) chunk rows PER SECTION, so a 30-section book
 * fused ~1500 results into a list the panel renders as one `<li>` each — the
 * regex side has been capped at 50 since forever, but the fused list had no cap
 * at all. The cut is taken AFTER the score sort, so the surviving page is the
 * best-ranked one, and every regex hit still survives it (a rank-50 regex hit
 * scores 1/110, which only the top ~50 semantic hits can beat).
 */
const DEFAULT_FUSED_LIMIT = 100;

const dedupKey = (r: DetailedSearchResult): string => `${r.href}|${r.charOffset}`;

export function fuseRrf(
  regex: DetailedSearchResult[],
  semantic: DetailedSearchResult[],
  opts: { k?: number; truncated?: boolean; limit?: number } = {},
): SearchBatchResult {
  const k = opts.k ?? DEFAULT_K;
  const limit = opts.limit ?? DEFAULT_FUSED_LIMIT;

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

  const ranked = [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.result);
  const results = ranked.length > limit ? ranked.slice(0, limit) : ranked;

  // Propagate truncation: the fused page is honest about either source having
  // been capped (the regex full-text scan reaching its limit) AND about the
  // fused cap above having dropped lower-ranked hits.
  return { results, truncated: (opts.truncated ?? false) || results.length < ranked.length };
}

/**
 * semanticRank (Increment D §2) — the search-side semantic ranking pass.
 *
 * Embeds the query ONCE (memoized by the QueryEmbeddingCache), quantizes it to
 * int8 (the B3 per-vector quantizer, injected as a port), loads the book's
 * packed int8 vectors (injected embeddings repo), and ranks each section's
 * chunk rows via `engine.rankInt8` (which crosses the worker seam like
 * searchDetailed). Each `{ href, row, cosine }` hit is mapped back to a
 * DetailedSearchResult by RE-RUNNING the deterministic {@link chunkSection} on
 * the section's text (same boundaries as the indexer → row `r` ↔ chunk `r`) to
 * recover charStart/charEnd → charOffset/matchLength + excerpt.
 *
 * CFI is left UNSET — resolved lazily at click time by
 * app/reader/searchNavigation.ts (resolveResultCfi against the live view), so
 * no live-reader plumbing enters the session. This fills the Phase-C-deferred
 * chunk→CFI gap (empty cfiStart/cfiEnd at EmbeddingIndexer.ts:127) WITHOUT an
 * IDB format change.
 *
 * Guards (design risk notes):
 *  - skips a section whose re-chunk count != persisted row count (stale corpus
 *    vs vectors) — that section degrades to regex-only;
 *  - skips the whole book when the embedded row's extractionVersion != the
 *    live corpus extractionVersion (stamp mismatch, design §8.2).
 *
 * Imports only sibling search modules + ~types — no store/kernel-state edge.
 */
import type { DetailedSearchResult } from '~types/search';
import { chunkSection } from './chunker';
import type { SearchEngineProtocol, SearchTextSource } from './protocol';
import type { QueryEmbeddingCache } from './queryEmbeddingCache';
import {
  CURRENT_QUANT,
  type EmbeddingClientPort,
  type EmbeddingsSourcePort,
  type QuantizePort,
} from './embeddingPort';

/** The query profile — MUST match the indexer's 'document' profile asymmetry. */
const QUERY_PROFILE = 'query' as const;

/** ±40-char context window, mirroring SearchEngine.getExcerpt (search-engine.ts:134). */
const EXCERPT_CONTEXT = 40;

export interface SemanticRankArgs {
  engine: SearchEngineProtocol;
  embeddingClient: EmbeddingClientPort;
  embeddingsSource: EmbeddingsSourcePort;
  textSource: SearchTextSource;
  quantize: QuantizePort;
  queryCache: QueryEmbeddingCache;
  config: { model: string; dims: number };
  bookId: string;
  query: string;
  /** Top-k per section to keep before fusion. */
  limit: number;
}

/**
 * Rank `query` against `bookId`'s embedded corpus. Returns [] when the book is
 * not embedded, when the corpus is missing, or when the embedded row's stamp
 * has drifted from the live corpus (the caller then degrades to regex-only).
 */
export async function semanticRank(args: SemanticRankArgs): Promise<DetailedSearchResult[]> {
  const { engine, embeddingClient, embeddingsSource, textSource, quantize, queryCache, config, bookId, query, limit } = args;

  const embedded = await embeddingsSource.get(bookId);
  if (!embedded || embedded.sections.length === 0) return [];

  const corpus = await textSource.get(bookId);
  if (!corpus) return [];

  // Stamp-mismatch invalidation (design §8.2): a re-extraction after the
  // vectors were written would mean the re-derived offsets no longer describe
  // the indexed chunks. Degrade the whole book to regex-only.
  if (embedded.extractionVersion !== corpus.extractionVersion) return [];

  // Embedding-space mismatch (design §8.2): a stored row whose {model, dims,
  // quant} no longer matches the live config is an INCOMPATIBLE space — the
  // cosine is meaningless and vectors are NEVER converted. Degrade the whole
  // book to regex-only (the index path re-embeds it). quant is the single
  // literal today, guarded against the shared constant for completeness.
  if (
    embedded.model !== config.model ||
    embedded.dims !== config.dims ||
    embedded.quant !== CURRENT_QUANT
  ) {
    return [];
  }

  // Embed the query ONCE (cached) under the 'query' profile + bookId/fg lane.
  const key = queryCache.keyOf({
    model: config.model,
    dims: config.dims,
    profile: QUERY_PROFILE,
    bookId,
    query,
  });
  const queryFloat = await queryCache.getOrCompute(key, async () => {
    const { vectors } = await embeddingClient.embed([query], {
      profile: QUERY_PROFILE,
      bookId,
      interactive: true,
    });
    return vectors[0];
  });
  if (!queryFloat || queryFloat.length === 0) return [];

  const { vectors: queryVec, scale: queryScale } = quantize(queryFloat);
  const dims = queryFloat.length;

  // Section text by href, for re-chunking + excerpt slicing.
  const textByHref = new Map(corpus.sections.map((s) => [s.href, { title: s.title, text: s.text }]));

  const results: DetailedSearchResult[] = [];

  for (const section of embedded.sections) {
    const source = textByHref.get(section.href);
    if (!source) continue; // corpus no longer has this section

    // Re-run the deterministic chunker with the SAME defaults the indexer used
    // (EmbeddingIndexer.ts:99-103 — no options) so row r ↔ chunk r aligns.
    const { chunks } = chunkSection({ href: section.href, title: source.title, text: source.text });

    const rowCount = Math.floor(section.vectors.length / dims);
    // Stale corpus vs vectors: re-chunk count != row count → can't trust the
    // row↔chunk alignment for this section. Degrade it to regex-only.
    if (chunks.length !== rowCount) continue;

    const ranked = engine.rankInt8(section.vectors, section.scales, queryVec, queryScale, dims, limit);
    const top = await ranked;

    for (const { row } of top) {
      const chunk = chunks[row];
      if (!chunk) continue;
      const charOffset = chunk.charStart;
      const matchLength = chunk.charEnd - chunk.charStart;
      results.push({
        href: section.href,
        sectionTitle: source.title,
        excerpt: excerptFor(source.text, charOffset, matchLength),
        charOffset,
        matchLength,
        // 1-based ordinal within the section (chunk row + 1); CFI stays unset.
        occurrence: row + 1,
      });
    }
  }

  return results;
}

/** ±EXCERPT_CONTEXT context window, sliced from the ORIGINAL section text. */
function excerptFor(text: string, index: number, length: number): string {
  const start = Math.max(0, index - EXCERPT_CONTEXT);
  const end = Math.min(text.length, index + length + EXCERPT_CONTEXT);
  return (start > 0 ? '...' : '') + text.substring(start, end) + (end < text.length ? '...' : '');
}

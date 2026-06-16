/**
 * semanticRank — the search-side semantic (meaning-based) ranking pass that
 * complements plain regex search.
 *
 * Embeds the query ONCE (memoized by the QueryEmbeddingCache), quantizes it to
 * int8 (an injected per-vector quantizer port), loads the book's packed int8
 * vectors (injected embeddings repo), and ranks each section's chunk rows via
 * `engine.rankInt8` (which crosses the worker seam like searchDetailed). The
 * per-section rankInt8 calls run CONCURRENTLY (Promise.all over the worker seam)
 * but results are assembled in embedded-section ORDER, so the fused ordering is
 * byte-identical to a sequential pass. Each `{ href, row, cosine }` hit is
 * mapped back to a DetailedSearchResult by reading the chunk's PERSISTED
 * charStart/charEnd (written by the indexer) → charOffset/matchLength + excerpt;
 * older rows lacking those offsets fall back to RE-RUNNING the deterministic
 * {@link chunkSection} on the section's text (same boundaries as the indexer →
 * row `r` ↔ chunk `r`).
 *
 * CFI (the precise in-book location) is left UNSET here — resolved lazily at
 * click time by app/reader/searchNavigation.ts (resolveResultCfi against the
 * live view), so no live-reader plumbing enters the session. The indexer cannot
 * compute CFIs at index time, so this maps a hit to char offsets now and defers
 * the CFI to click time, WITHOUT an IDB format change.
 *
 * Guards: returns nothing for a section/book whose stored vectors no longer
 * describe the current text, so the caller falls back to regex-only —
 *  - skips a section whose re-chunk count != persisted row count (the text was
 *    re-extracted and no longer aligns with the stored vectors);
 *  - skips the whole book when the embedded row's extractionVersion != the live
 *    corpus extractionVersion (the text was re-extracted under a new version).
 *
 * Imports only sibling search modules + ~types + the shared @lib/search-engine
 * excerpt helper (the domains→lib edge workerFactory.ts already uses) — no
 * store/kernel-state edge.
 */
import type { DetailedSearchResult } from '~types/search';
import { getExcerpt } from '@lib/search-engine';
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

  // The book's text was re-extracted after the vectors were written, so the
  // re-derived offsets no longer describe the indexed chunks. Degrade the whole
  // book to regex-only.
  if (embedded.extractionVersion !== corpus.extractionVersion) return [];

  // The stored vectors live in a different embedding space than the live config:
  // a row whose {model, dims, quant} no longer matches means cosine similarity
  // against the current query is meaningless, and vectors are NEVER converted
  // between spaces. Degrade the whole book to regex-only (the index path
  // re-embeds it). quant is the single literal today, guarded against the
  // shared constant for completeness.
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

  // Resolve each embedded section to {source, a row→offsets getter, vectors}
  // BEFORE ranking, dropping sections the corpus no longer carries or whose
  // chunk↔row alignment cannot be trusted (they degrade to regex-only). The
  // resolved list is kept in embedded-section ORDER so the fused output ordering
  // is identical to the sequential pass even though the rankInt8 awaits below
  // run concurrently.
  type Resolved = {
    section: (typeof embedded.sections)[number];
    source: { title: string; text: string };
    offsetsFor: (row: number) => { charStart: number; charEnd: number } | undefined;
  };
  const resolved: Resolved[] = [];
  for (const section of embedded.sections) {
    const source = textByHref.get(section.href);
    if (!source) continue; // corpus no longer has this section

    const rowCount = Math.floor(section.vectors.length / dims);

    // Prefer the PERSISTED char offsets: when EVERY chunk row carries them (rows
    // the indexer wrote with offsets) we recover charOffset/matchLength with NO
    // re-segmentation. Presence is checked with `typeof === 'number'` (NOT
    // truthiness) since charStart=0 is valid for the first chunk. The alignment
    // guard becomes `chunks.length === rowCount` — one chunk entry per vector
    // row by construction; a corrupt/partial row still degrades to regex-only.
    const persistedChunks = section.chunks;
    const hasPersistedOffsets =
      persistedChunks.length === rowCount &&
      persistedChunks.every(
        (c) => typeof c.charStart === 'number' && typeof c.charEnd === 'number',
      );
    if (hasPersistedOffsets) {
      resolved.push({
        section,
        source,
        offsetsFor: (row) => {
          const c = persistedChunks[row];
          return c ? { charStart: c.charStart as number, charEnd: c.charEnd as number } : undefined;
        },
      });
      continue;
    }

    // Older rows (no persisted offsets): re-run the deterministic chunker with
    // the SAME defaults the indexer used (EmbeddingIndexer — no options) so row
    // r ↔ chunk r aligns. If the text changed since indexing (re-chunk count !=
    // row count) this section degrades to regex-only.
    const { chunks } = chunkSection({ href: section.href, title: source.title, text: source.text });
    if (chunks.length !== rowCount) continue;
    resolved.push({
      section,
      source,
      offsetsFor: (row) => {
        const c = chunks[row];
        return c ? { charStart: c.charStart, charEnd: c.charEnd } : undefined;
      },
    });
  }

  // Rank every section CONCURRENTLY across the worker seam, then consume the
  // resolved `top` arrays in their ORIGINAL section order so the result ordering
  // is byte-identical to a sequential loop.
  const tops = await Promise.all(
    resolved.map((r) =>
      Promise.resolve(
        engine.rankInt8(r.section.vectors, r.section.scales, queryVec, queryScale, dims, limit),
      ),
    ),
  );

  const results: DetailedSearchResult[] = [];
  for (let s = 0; s < resolved.length; s++) {
    const { section, source, offsetsFor } = resolved[s];
    for (const { row } of tops[s]) {
      const offsets = offsetsFor(row);
      if (!offsets) continue;
      const charOffset = offsets.charStart;
      const matchLength = offsets.charEnd - offsets.charStart;
      results.push({
        href: section.href,
        sectionTitle: source.title,
        excerpt: getExcerpt(source.text, charOffset, matchLength),
        charOffset,
        matchLength,
        // 1-based ordinal within the section (chunk row + 1); CFI stays unset.
        occurrence: row + 1,
      });
    }
  }

  return results;
}

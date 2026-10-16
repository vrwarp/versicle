/**
 * Effective invalidation hash for a corpus section.
 *
 * The embedding indexer's per-section resume-skip and the reader's "sections
 * embedded" progress counter both key on `sectionTextHash` — the djb2 the
 * extractor stamps on each corpus section at import. But corpora written
 * before that field existed lack it: the field was added without bumping
 * `TTS_EXTRACTION_VERSION`, and re-extraction only fires for corpora whose
 * version is BELOW the current one, so such a corpus keeps `sectionTextHash`
 * absent forever — it is never re-extracted to backfill it.
 *
 * Treating the absent field as `''` would make the indexer's skip guard
 * (`sectionTextHash !== ''`) and the counter's match (`liveHash !== undefined`)
 * silently no-op: every reader pass would re-embed EVERY section from scratch
 * (thousands of embeddings) while progress sat at zero forever.
 *
 * This derives the hash from the section text with the SAME djb2 the extractor
 * uses, so:
 *  - a hash-less corpus gets a stable, verifiable per-section key (resume-skip
 *    and progress work without any re-extraction), and
 *  - the derived value EQUALS what a later re-extraction of the same text would
 *    stamp, so healing a hash-less book never triggers a spurious full re-embed.
 */
import { cheapHash } from '@domains/library/import/identity';

/**
 * The stamped `sectionTextHash` when present and non-empty; otherwise the djb2
 * of the section text (matching the extractor's derivation byte-for-byte).
 */
export function effectiveSectionHash(text: string, storedHash?: string): string {
  if (storedHash) return storedHash;
  return cheapHash(new TextEncoder().encode(text).buffer);
}

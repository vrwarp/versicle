/**
 * Effective invalidation hash for a corpus section.
 *
 * The embedding indexer's per-section resume-skip and the reader's "sections
 * embedded" progress counter both key on `sectionTextHash` — the djb2 the
 * extractor stamps on each corpus section at import. But that field was added
 * (2026-06-15) two days AFTER `TTS_EXTRACTION_VERSION` was bumped to 3, and the
 * version was NOT bumped again for it. Re-extraction only fires for corpora
 * whose version is BELOW the current one, so a corpus written at version 3
 * before the field existed keeps `sectionTextHash` absent forever — it is never
 * re-extracted to backfill it.
 *
 * With the field absent, the old `?? ''` fallbacks made the indexer's skip
 * guard (`sectionTextHash !== ''`) and the counter's match (`liveHash !==
 * undefined`) silently no-op: every reader pass re-embedded EVERY section from
 * scratch (thousands of embeddings) while progress sat at zero forever.
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

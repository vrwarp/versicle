/**
 * The NFKD/extraction re-ingestion wave (Phase 7 §E, PR-L6).
 *
 * Detection is STAMP-BASED (the P0/P5c fix-forward heuristics, not the
 * stale analysis-era "non-ASCII content" idea):
 *
 *  - rows missing `extractionVersion` are implicit v1 — segmented against
 *    NFKD-normalized text; their CFIs may have drifted wherever decomposable
 *    characters (é, ﬁ, …) precede a sentence start;
 *  - v2 rows have CORRECT offsets (raw-text segmentation) but carry
 *    ingest-time refinement baked in; v3 ("raw at rest", P5c) playback
 *    re-refines tolerantly, so v2 rows keep working — their re-ingest is
 *    pure convergence work;
 *  - the restamp FAST PATH: a v1 row whose every sentence satisfies
 *    `s.text === s.text.normalize('NFKD')` is byte-identical to its v2
 *    extraction (no decomposable characters ⇒ no offset drift was possible)
 *    — restamped to 2 in place, NO re-extraction. This operates on
 *    persisted rows, never on re-reading the EPUB.
 *
 * Everything still below the current version gets a `reingest` job at the
 *  queue's LOWEST priority (idle class — user imports always preempt),
 * chunked one book per job and RESUMABLE: the per-book stamp itself is the
 * durable resume marker, so a killed wave continues where it stopped.
 * Offloaded/ghost books are skipped (no binary) and heal on restore/import,
 * which always writes the current version.
 *
 * Graft R4: old rows are retained until the re-extraction passes the
 * alignment self-check (`derivedContentSane`, threaded through
 * `reprocessBookContent({ verifyDerived })`); a failed re-extract degrades
 * to current behavior, never worse.
 */
import { TTS_EXTRACTION_VERSION } from '@lib/ingestion/sentence-extraction';
import { createLogger } from '@lib/logger';
import type { CacheTtsPreparationRow } from '@data/rows/cache';
import type { ChapterMapping } from './import/extract';

const logger = createLogger('ReingestWave');

/** Injected seams (the app boot task binds bookContent + the orchestrator). */
export interface ReingestWaveDeps {
  /** bookId → MIN stamped extraction version (implicit v1 reported as 1). */
  listVersions(): Promise<Map<string, number>>;
  listRows(bookId: string): Promise<CacheTtsPreparationRow[]>;
  restamp(bookId: string, version: number): Promise<void>;
  /** False for offloaded/ghost books (no local binary — skip, heals on restore). */
  hasLocalBinary(bookId: string): Promise<boolean>;
  /** One idle-priority reingest job (mutex-guarded, self-check enforced). */
  reingest(bookId: string): Promise<void>;
  /** Cooperative yield between books (defaults to a macrotask hop). */
  yieldToHost?(): Promise<void>;
  /** Abort check between books (the settings defer toggle / shutdown). */
  shouldContinue?(): boolean;
}

export interface ReingestWaveReport {
  /** v1 books proven NFKD-invariant — restamped to v2, re-extraction skipped. */
  restamped: string[];
  /** Books re-extracted to the current version. */
  reingested: string[];
  /** Books whose re-extraction failed (self-check or error) — old rows retained. */
  failed: string[];
  /** Books skipped for missing local binary (offloaded/ghost). */
  skipped: string[];
}

/** True when every persisted sentence is NFKD-invariant (the §E fast-path proof). */
export function rowsAreNfkdInvariant(rows: CacheTtsPreparationRow[]): boolean {
  for (const row of rows) {
    for (const sentence of row.sentences) {
      if (sentence.text !== sentence.text.normalize('NFKD')) return false;
    }
  }
  return true;
}

/**
 * The R4 alignment self-check, run BEFORE persisting a re-extraction: a
 * sane re-extract must still produce sentences (unless the old rows had
 * none) and must not collapse — fresh CFIs are generated from the rendered
 * DOM (self-consistent by construction), so the catastrophic failure mode
 * is an extraction that silently lost most of the book.
 */
export function derivedContentSane(oldRows: CacheTtsPreparationRow[], next: ChapterMapping): boolean {
  const oldSentences = oldRows.reduce((acc, row) => acc + row.sentences.length, 0);
  const newSentences = next.ttsContentBatches.reduce((acc, row) => acc + row.sentences.length, 0);
  if (oldSentences === 0) return true; // nothing to lose
  if (newSentences === 0) return false;
  // Raw-at-rest (v3) rows may legitimately segment differently than refined
  // v1/v2 rows; a generous floor only rejects collapse, not drift.
  return newSentences >= oldSentences * 0.5;
}

const defaultYield = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Run one wave: restamp fast path first (cheap row scans), then idle
 * reingest jobs — drifted v1 books before v2 convergence.
 */
export async function runReingestWave(deps: ReingestWaveDeps): Promise<ReingestWaveReport> {
  const report: ReingestWaveReport = { restamped: [], reingested: [], failed: [], skipped: [] };
  const yieldToHost = deps.yieldToHost ?? defaultYield;
  const shouldContinue = deps.shouldContinue ?? (() => true);

  const versions = await deps.listVersions();
  const drifted: string[] = [];
  const convergence: string[] = [];

  for (const [bookId, version] of versions) {
    if (!shouldContinue()) return report;
    if (version >= TTS_EXTRACTION_VERSION) continue;

    if (version <= 1) {
      // Fast path: NFKD-invariant v1 rows are byte-identical to v2 — restamp.
      const rows = await deps.listRows(bookId);
      if (rowsAreNfkdInvariant(rows)) {
        await deps.restamp(bookId, 2);
        report.restamped.push(bookId);
        // v2 rows work correctly; convergence to v3 waits for a later wave.
        await yieldToHost();
        continue;
      }
      drifted.push(bookId);
    } else {
      convergence.push(bookId);
    }
    await yieldToHost();
  }

  // Drifted CFIs first (the user-visible fix), then raw-at-rest convergence.
  for (const bookId of [...drifted, ...convergence]) {
    if (!shouldContinue()) return report;
    try {
      if (!(await deps.hasLocalBinary(bookId))) {
        report.skipped.push(bookId);
        continue;
      }
      await deps.reingest(bookId);
      report.reingested.push(bookId);
    } catch (e) {
      // Old rows retained (the verifyDerived guard aborts pre-persist).
      logger.warn(`Re-ingest failed for ${bookId}; old rows retained:`, e);
      report.failed.push(bookId);
    }
    await yieldToHost();
  }

  if (report.restamped.length || report.reingested.length || report.failed.length) {
    logger.info(
      `Re-ingest wave: ${report.restamped.length} restamped, ${report.reingested.length} re-extracted, ` +
        `${report.failed.length} failed (old rows retained), ${report.skipped.length} skipped (no binary).`,
    );
  }
  return report;
}

/**
 * Bible lexicon loader (Phase 5c; phase5-tts-strangler.md §5c.3, content
 * debt S16/D6): the 2,899-line eagerly-imported TS data file is now
 * `bible-lexicon.json`, loaded through ONE dynamic import so the ruleset
 * leaves the entry chunk on both threads (the worker bundles it as its own
 * async chunk too — `npm run check:worker-chunk` asserts the entry-chunk
 * effect). The data is byte-identical to the legacy module (round-trip
 * verified at conversion).
 */
import type { LexiconRule } from '~types/db';

/** The raw shape of one Bible rule as stored in bible-lexicon.json. */
export interface RawBibleRule {
    original: string;
    replacement: string;
    isRegex?: boolean;
    matchType?: LexiconRule['matchType'];
    applyBeforeGlobal?: boolean;
    language?: string;
}

export interface BibleLexiconData {
    /** Bible book-name abbreviations fed into sentence segmentation. */
    abbreviations: string[];
    /** Pronunciation rules (en verse-reference expansion, zh book names, …). */
    rules: RawBibleRule[];
}

let dataPromise: Promise<BibleLexiconData> | null = null;

/** Lazily loads the Bible lexicon data (one fetch, shared promise). */
export function loadBibleLexicon(): Promise<BibleLexiconData> {
    if (!dataPromise) {
        dataPromise = import('./bible-lexicon.json').then(
            (m) => (m as { default: BibleLexiconData }).default ?? (m as unknown as BibleLexiconData),
        );
    }
    return dataPromise;
}

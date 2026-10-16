/**
 * Bible lexicon loader: the abbreviation list and pronunciation rules live
 * in `bible-lexicon.json`, loaded through ONE dynamic import so the ruleset
 * stays out of the entry chunk on both threads (the worker bundles it as its
 * own async chunk too — `npm run check:worker-chunk` asserts it is only
 * reachable through that dynamic import).
 */
import type { LexiconRule } from '~types/user-data';

/** The raw shape of one Bible rule as stored in bible-lexicon.json. */
interface RawBibleRule {
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

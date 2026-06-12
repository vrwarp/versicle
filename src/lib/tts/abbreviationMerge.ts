/**
 * Memoized custom + Bible abbreviation merge (Phase 5c; extracted from
 * AudioContentPipeline.getMergedAbbreviations). The memo keeps the returned
 * array reference stable across calls with the same inputs so TextSegmenter
 * can skip rebuilding its internal trie caches.
 */
import { BIBLE_ABBREVIATIONS } from './bible-lexicon';

export class AbbreviationMerger {
    private lastInputs: { custom: string[]; bible: boolean } | null = null;
    private lastResult: string[] | null = null;

    merge(customAbbreviations: string[], includeBible: boolean): string[] {
        if (
            this.lastInputs &&
            this.lastInputs.custom === customAbbreviations &&
            this.lastInputs.bible === includeBible
        ) {
            return this.lastResult!;
        }

        let merged = customAbbreviations;
        if (includeBible) {
            merged = [...customAbbreviations, ...BIBLE_ABBREVIATIONS];
        }

        this.lastInputs = { custom: customAbbreviations, bible: includeBible };
        this.lastResult = merged;
        return merged;
    }
}

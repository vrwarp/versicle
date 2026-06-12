/**
 * System lexicon providers (Phase 5c; phase5-tts-strangler.md §5c.3): rule
 * sets the APP ships (vs user CRUD rules), loaded lazily and compiled ONCE
 * per language into frozen arrays with stable identity — the assembler's
 * memoized output then keeps LexiconApplier's WeakMap compilation cache hot
 * (S15's rebuild-per-call dies).
 *
 * Deviation from the doc's sketch, recorded: `appliesTo` takes the resolved
 * global flag (the provider composes resolveBiblePreference) and `load`
 * takes the language so the per-language filter can be memoized here —
 * intent (lazy JSON, frozen CompiledRules, single compile) unchanged.
 */
import type { LexiconRule } from '~types/user-data';
import { loadBibleLexicon } from './bible-lexicon';
import { resolveBiblePreference, type BiblePreference } from './biblePreference';

export interface SystemLexiconProvider {
    readonly id: string;
    /** Whether this provider's rules apply for a book's preference + the global flag. */
    appliesTo(pref: BiblePreference | undefined, globalEnabled: boolean): boolean;
    /** Lazily loads + compiles the frozen rule set for a language ('' = unfiltered). */
    load(language?: string): Promise<ReadonlyArray<LexiconRule>>;
}

/** Per-language compiled Bible rules; stable references per language key. */
const compiledByLanguage = new Map<string, Promise<ReadonlyArray<LexiconRule>>>();

async function compileBibleRules(language?: string): Promise<ReadonlyArray<LexiconRule>> {
    const { rules } = await loadBibleLexicon();
    const totalCount = rules.length;
    const compiled: LexiconRule[] = rules
        // Language semantics preserved verbatim from the legacy LexiconService:
        // a rule without a language always applies; a request without a language
        // matches everything; otherwise prefix-match (zh matches zh-TW).
        .filter(r => !r.language || !language || language.toLowerCase().startsWith(r.language.toLowerCase()))
        .map((r, i) => Object.freeze({
            id: `bible-${i}`,
            original: r.original,
            replacement: r.replacement,
            isRegex: r.isRegex,
            matchType: r.matchType || (r.isRegex ? 'regex' as const : 'ignore_case' as const),
            applyBeforeGlobal: false,
            created: 0,
            // Bible rules act as lowest-priority system defaults
            order: Number.MAX_SAFE_INTEGER - totalCount + i,
        }));
    return Object.freeze(compiled);
}

export const bibleLexiconProvider: SystemLexiconProvider = {
    id: 'bible',
    appliesTo: (pref, globalEnabled) => resolveBiblePreference(pref, globalEnabled),
    load(language?: string) {
        const key = language ? language.toLowerCase() : '';
        let promise = compiledByLanguage.get(key);
        if (!promise) {
            promise = compileBibleRules(language);
            compiledByLanguage.set(key, promise);
        }
        return promise;
    },
};

/**
 * LexiconApplier — the pure text-transformation half of the lexicon.
 *
 * Applies a given set of {@link LexiconRule}s to text (regex compilation + caching). It has NO
 * store / yjs dependency, so it can run inside the TTS engine worker. The yjs-backed *fetching*
 * of rules (`getRules`, bible preference, CRUD) stays in {@link LexiconService} on the main
 * thread; the engine obtains rules through the `EngineContext` lexicon port and applies them
 * with this module.
 *
 * Extracted from LexiconService so importing the engine no longer drags `useLexiconStore`
 * (and its Y.Doc + IndexedDB connection) into the worker bundle.
 */
import type { LexiconRule } from '~types/db';

interface CompiledLexiconRule {
    originalRule: LexiconRule;
    regex: RegExp;
    replacement: string;
}

const INITIALISM_PHONETIC_MAP: Record<string, string> = {
    'A': 'Eigh',
    // Future additions mapped here only as specific failures are identified
};

/**
 * Transforms initialisms to prevent prosodic breaks and phonetic errors.
 * Example: "A. W. Tozer" -> "Eigh W Tozer"
 */
export function processInitialisms(text: string): string {
    const initialismRegex = /\b([A-Z])\.\s*(?=[A-Z])/g;

    return text.replace(initialismRegex, (_match, letter) => {
        const replacement = INITIALISM_PHONETIC_MAP[letter];
        if (replacement) {
            // Replace the letter and strip the period, maintaining the trailing space
            return `${replacement} `;
        }
        // If no phonetic patch is needed, just strip the period to fix prosody
        return `${letter} `;
    });
}

export class LexiconApplier {
    // Fast path cache for stable rule arrays (O(1) lookup).
    private compiledRulesCache = new WeakMap<LexiconRule[], CompiledLexiconRule[]>();
    // Secondary cache for individual compiled rules, to avoid expensive regex re-compilation
    // when the rule array is regenerated but the rules themselves haven't changed.
    private compiledRegexCache = new Map<string, CompiledLexiconRule>();

    private compileRule(rule: LexiconRule, effectiveMatchType: string): CompiledLexiconRule {
        const normalizedOriginal = rule.original.normalize('NFKD');
        const normalizedReplacement = rule.replacement.normalize('NFKD');
        let regex: RegExp;

        if (effectiveMatchType === 'regex') {
            regex = new RegExp(normalizedOriginal, 'gi');
        } else {
            const escapedOriginal = normalizedOriginal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const startIsWord = /^\w/.test(normalizedOriginal);
            const endIsWord = /\w$/.test(normalizedOriginal);
            const regexStr = `${startIsWord ? '\\b' : ''}${escapedOriginal}${endIsWord ? '\\b' : ''}`;
            const flags = effectiveMatchType === 'match_case' ? 'g' : 'gi';
            regex = new RegExp(regexStr, flags);
        }

        return { originalRule: rule, regex, replacement: normalizedReplacement };
    }

    private getCompiledRules(rules: LexiconRule[]): CompiledLexiconRule[] {
        // Fast path: O(1) lookup if array reference hasn't changed.
        let compiled = this.compiledRulesCache.get(rules);
        if (compiled) return compiled;

        compiled = [];

        for (const rule of rules) {
            if (!rule.original || !rule.replacement) continue;

            // Determine effective matchType for legacy support
            const effectiveMatchType = rule.matchType || (rule.isRegex ? 'regex' : 'ignore_case');

            // Use a safe delimiter (\0) to prevent cache key collisions
            const cacheKey = `${rule.id || 'anon'}\0${effectiveMatchType}\0${rule.original}\0${rule.replacement}`;

            let compiledRule = this.compiledRegexCache.get(cacheKey);

            if (!compiledRule) {
                try {
                    compiledRule = this.compileRule(rule, effectiveMatchType);

                    // Memory bounds for the Map cache to prevent unlimited growth if rules change frequently
                    if (this.compiledRegexCache.size > 2000) {
                        // Clear 10% of entries (oldest) if cache gets too large
                        let i = 0;
                        for (const key of this.compiledRegexCache.keys()) {
                            if (i++ > 200) break;
                            this.compiledRegexCache.delete(key);
                        }
                    }

                    this.compiledRegexCache.set(cacheKey, compiledRule);
                } catch (e) {
                    console.warn(`Invalid regex for lexicon rule: ${rule.original}`, e);
                    continue; // Skip appending if invalid
                }
            }

            if (compiledRule) {
                compiled.push(compiledRule);
            }
        }

        // Cache the result for this specific array reference.
        this.compiledRulesCache.set(rules, compiled);
        return compiled;
    }

    applyLexiconWithTrace(
        text: string,
        rules: LexiconRule[],
    ): { final: string; trace: { rule: LexiconRule; before: string; after: string }[] } {
        let processedText = processInitialisms(text);
        processedText = processedText.normalize('NFKD');
        const trace: { rule: LexiconRule; before: string; after: string }[] = [];
        const compiledRules = this.getCompiledRules(rules);

        for (const compiled of compiledRules) {
            const before = processedText;
            const after = processedText.replace(compiled.regex, compiled.replacement);
            if (before !== after) {
                trace.push({ rule: compiled.originalRule, before, after });
                processedText = after;
            }
        }
        return { final: processedText, trace };
    }

    applyLexicon(text: string, rules: LexiconRule[]): string {
        let processedText = processInitialisms(text);
        processedText = processedText.normalize('NFKD');
        const compiledRules = this.getCompiledRules(rules);

        for (const compiled of compiledRules) {
            processedText = processedText.replace(compiled.regex, compiled.replacement);
        }
        return processedText;
    }
}

/** Shared applier instance (the regex caches are safe to share). */
export const lexiconApplier = new LexiconApplier();

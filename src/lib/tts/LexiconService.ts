
// import { v4 as uuidv4 } from 'uuid'; // Unused
import { BIBLE_LEXICON_RULES } from '../../data/bible-lexicon';
import { useLexiconStore } from '../../store/useLexiconStore';
import { waitForYjsSync } from '../../store/yjs-provider';
import type { LexiconRule } from '../../types/db';

interface CompiledLexiconRule {
    originalRule: LexiconRule;
    regex: RegExp;
    replacement: string;
}

/**
 * Service for managing pronunciation lexicon rules.
 * Handles CRUD operations via the Yjs-backed useLexiconStore.
 */
export class LexiconService {
    private static instance: LexiconService;
    // OPTIMIZATION: Cache compiled rules (Regex objects) keyed by the rules array reference.
    // This assumes that the caller (AudioPlayerService) reuses the rule array for sequential calls (it does).
    // Using WeakMap avoids memory leaks as old rule arrays are garbage collected.
    private compiledRulesCache = new WeakMap<LexiconRule[], CompiledLexiconRule[]>();
    private globalBibleLexiconEnabled: boolean = true;

    private constructor() { }

    static getInstance(): LexiconService {
        if (!LexiconService.instance) {
            LexiconService.instance = new LexiconService();
        }
        return LexiconService.instance;
    }

    setGlobalBibleLexiconEnabled(enabled: boolean) {
        this.globalBibleLexiconEnabled = enabled;
    }

    /**
     * Retrieves all rules applicable to a specific book (Global + Book Specific).
     */
    async getRules(bookId?: string): Promise<LexiconRule[]> {
        // Ensure Yjs is synced before reading
        await waitForYjsSync();

        const state = useLexiconStore.getState();
        const allRules = Object.values(state.rules);

        // 1. Get Global Rules (sorted by order)
        const globalRules = allRules
            .filter(r => !r.bookId || r.bookId === 'global')
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

        let rules: LexiconRule[] = globalRules;
        let bibleLexiconEnabled: 'on' | 'off' | 'default' = 'default';

        if (bookId) {
            // 2. Get Book Rules
            const bookRules = allRules.filter(r => r.bookId === bookId);

            // Check settings
            if (state.settings[bookId]?.bibleLexiconEnabled) {
                bibleLexiconEnabled = state.settings[bookId].bibleLexiconEnabled;
            }

            // Split into High Priority (applyBeforeGlobal) and Low Priority (Standard)
            const highPriority = bookRules
                .filter(r => r.applyBeforeGlobal)
                .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

            const lowPriority = bookRules
                .filter(r => !r.applyBeforeGlobal)
                .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

            // Assemble: High Priority -> Global -> Low Priority
            // Note: We will inject Bible rules before Low Priority if enabled
            rules = [...highPriority, ...globalRules];

            // Determine if we should apply Bible Lexicon rules
            const shouldApplyBible = bibleLexiconEnabled === 'on' || (bibleLexiconEnabled === 'default' && this.globalBibleLexiconEnabled);

            if (shouldApplyBible) {
                const bibleRules: LexiconRule[] = BIBLE_LEXICON_RULES.map((r, i) => ({
                    id: `bible-${i}`,
                    original: r.original,
                    replacement: r.replacement,
                    isRegex: r.isRegex,
                    applyBeforeGlobal: false,
                    created: 0,
                    // Bible rules act as lowest priority system defaults
                    order: Number.MAX_SAFE_INTEGER - BIBLE_LEXICON_RULES.length + i
                }));

                rules = [...rules, ...bibleRules];
            }

            // Append Low Priority (Standard) Book Rules last
            rules = [...rules, ...lowPriority];

            return rules;
        }

        // If no bookId or falling through
        if (rules === globalRules) {
            // 3. Fallback for non-book context (just Global + potentially Bible)

            // For global context (no book), we just use global toggle
            const shouldApplyBible = this.globalBibleLexiconEnabled;

            if (shouldApplyBible) {
                const bibleRules: LexiconRule[] = BIBLE_LEXICON_RULES.map((r, i) => ({
                    id: `bible-${i}`,
                    original: r.original,
                    replacement: r.replacement,
                    isRegex: r.isRegex,
                    applyBeforeGlobal: false,
                    created: 0,
                    order: Number.MAX_SAFE_INTEGER - BIBLE_LEXICON_RULES.length + i
                }));
                rules = [...rules, ...bibleRules];
            }
        }

        return rules;
    }

    async saveRule(rule: Omit<LexiconRule, 'id' | 'created' | 'order'> & { id?: string }): Promise<void> {
        // Ensure Yjs is ready
        await waitForYjsSync();

        const normalizedRule = {
            ...rule,
            original: rule.original ? rule.original.normalize('NFKD') : rule.original,
            replacement: rule.replacement ? rule.replacement.normalize('NFKD') : rule.replacement
        };

        if (rule.id && useLexiconStore.getState().rules[rule.id]) {
            useLexiconStore.getState().updateRule(rule.id, normalizedRule);
        } else {
            useLexiconStore.getState().addRule(normalizedRule);
        }
    }

    async setBibleLexiconPreference(bookId: string, preference: 'on' | 'off' | 'default'): Promise<void> {
        await waitForYjsSync();
        useLexiconStore.getState().setBiblePreference(bookId, preference);
    }

    async getBibleLexiconPreference(bookId: string): Promise<'on' | 'off' | 'default'> {
        await waitForYjsSync();
        const settings = useLexiconStore.getState().settings[bookId];
        return settings?.bibleLexiconEnabled || 'default';
    }

    async reorderRules(updates: { id: string; order: number }[]): Promise<void> {
        await waitForYjsSync();
        useLexiconStore.getState().reorderRules(updates);
    }

    async deleteRule(id: string): Promise<void> {
        await waitForYjsSync();
        useLexiconStore.getState().deleteRule(id);
    }

    async deleteRules(ids: string[]): Promise<void> {
        await waitForYjsSync();
        const store = useLexiconStore.getState();
        ids.forEach(id => store.deleteRule(id));
    }

    private getCompiledRules(rules: LexiconRule[]): CompiledLexiconRule[] {
        let compiled = this.compiledRulesCache.get(rules);
        if (compiled) return compiled;

        compiled = [];
        for (const rule of rules) {
            if (!rule.original || !rule.replacement) continue;

            try {
                // Pre-normalize during compilation
                const normalizedOriginal = rule.original.normalize('NFKD');
                const normalizedReplacement = rule.replacement.normalize('NFKD');
                let regex: RegExp;

                if (rule.isRegex) {
                    regex = new RegExp(normalizedOriginal, 'gi');
                } else {
                    const escapedOriginal = normalizedOriginal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const startIsWord = /^\w/.test(normalizedOriginal);
                    const endIsWord = /\w$/.test(normalizedOriginal);
                    const regexStr = `${startIsWord ? '\\b' : ''}${escapedOriginal}${endIsWord ? '\\b' : ''}`;
                    regex = new RegExp(regexStr, 'gi');
                }

                compiled.push({
                    originalRule: rule,
                    regex,
                    replacement: normalizedReplacement
                });
            } catch (e) {
                console.warn(`Invalid regex for lexicon rule: ${rule.original}`, e);
            }
        }

        this.compiledRulesCache.set(rules, compiled);
        return compiled;
    }

    applyLexiconWithTrace(text: string, rules: LexiconRule[]): { final: string, trace: { rule: LexiconRule, before: string, after: string }[] } {
        let processedText = text.normalize('NFKD');
        const trace: { rule: LexiconRule, before: string, after: string }[] = [];
        const compiledRules = this.getCompiledRules(rules);

        for (const compiled of compiledRules) {
            const before = processedText;
            // Use cached regex and pre-normalized replacement
            const after = processedText.replace(compiled.regex, compiled.replacement);

            if (before !== after) {
                trace.push({ rule: compiled.originalRule, before, after });
                processedText = after;
            }
        }
        return { final: processedText, trace };
    }

    applyLexicon(text: string, rules: LexiconRule[]): string {
        let processedText = text.normalize('NFKD');
        const compiledRules = this.getCompiledRules(rules);

        for (const compiled of compiledRules) {
            processedText = processedText.replace(compiled.regex, compiled.replacement);
        }
        return processedText;
    }

    async getRulesHash(rules: LexiconRule[]): Promise<string> {
        if (rules.length === 0) return '';
        const sorted = [...rules].sort((a, b) => a.id.localeCompare(b.id));
        const data = sorted.map(r => `${r.original.normalize('NFKD')}:${r.replacement.normalize('NFKD')}`).join('|');
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(data);
        const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
}

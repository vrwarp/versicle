/**
 * LexiconService — main-thread lexicon facade: CRUD over the yjs-backed
 * useLexiconStore plus the {@link LexiconAssembler} that compiles rules into
 * stable {@link CompiledLexicon} value objects keyed by (bookId, language,
 * store version) and invalidated via `useLexiconStore.subscribe`. System
 * (Bible) rules are compiled once per language in ./systemLexicon, loaded
 * lazily from bible-lexicon.json.
 *
 * The global Bible flag is PUSHED by the app layer (TtsController reads the
 * settings store and calls setGlobalBibleLexiconEnabled) — a direct
 * settings-store read here would violate the lib-not-to-store boundary rule.
 *
 * Text transformation stays in the yjs-free LexiconApplier (worker-safe).
 */
import { useLexiconStore } from '@store/useLexiconStore';
import { waitForYjsSync } from '@store/yjs-provider';
import type { LexiconRule } from '~types/user-data';
import { lexiconApplier } from './LexiconApplier';
import { LexiconAssembler, type CompiledLexicon } from './LexiconEngine';

export type { CompiledLexicon };

/**
 * Service for managing pronunciation lexicon rules.
 * Handles CRUD operations via the Yjs-backed useLexiconStore.
 */
export class LexiconService {
    private static instance: LexiconService;

    /** The (bookId, language, version)-memoized lexicon compiler. */
    readonly assembler: LexiconAssembler;

    private constructor() {
        this.assembler = new LexiconAssembler({
            getState: () => useLexiconStore.getState(),
            subscribe: (listener) => useLexiconStore.subscribe(listener),
            whenReady: () => waitForYjsSync(),
        });
    }

    static getInstance(): LexiconService {
        if (!LexiconService.instance) {
            LexiconService.instance = new LexiconService();
        }
        return LexiconService.instance;
    }

    /** App-layer push of the global Bible flag (TtsController owns the settings-store read). */
    setGlobalBibleLexiconEnabled(enabled: boolean) {
        this.assembler.setGlobalBibleEnabled(enabled);
    }

    /** The assembled lexicon (stable identity per (bookId, language, version)). */
    getCompiled(bookId?: string, language?: string): Promise<CompiledLexicon> {
        return this.assembler.getCompiled(bookId, language);
    }

    /**
     * Retrieves all rules applicable to a specific book (Global + Book Specific).
     * Array view over {@link getCompiled}.
     */
    async getRules(bookId?: string, language?: string): Promise<LexiconRule[]> {
        const compiled = await this.assembler.getCompiled(bookId, language);
        return compiled.rules as LexiconRule[];
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

    // Text transformation is delegated to the yjs-free LexiconApplier (so the engine can apply
    // rules off the main thread without importing this store-backed service).
    applyLexiconWithTrace(text: string, rules: ReadonlyArray<LexiconRule>): { final: string, trace: { rule: LexiconRule, before: string, after: string }[] } {
        return lexiconApplier.applyLexiconWithTrace(text, rules);
    }

    applyLexicon(text: string, rules: ReadonlyArray<LexiconRule>): string {
        return lexiconApplier.applyLexicon(text, rules);
    }
}

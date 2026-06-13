/**
 * LexiconEngine — the assembled-lexicon value object + assembler (Phase 5c;
 * phase5-tts-strangler.md §5c.3).
 *
 * {@link CompiledLexicon} is keyed by (bookId, language, store version):
 * the assembler memoizes per key and bumps its version on every lexicon
 * store change (rules/settings), on global-Bible-flag changes, and on
 * explicit invalidation — so a memo hit returns the SAME frozen rules array
 * (LexiconApplier's WeakMap compilation cache stays hot; S15's
 * never-populated book cache + rebuild-per-call die). The memo is written
 * before EVERY return path by construction — assembly is a single-exit
 * function (the LexiconService.ts:114 early-return bug is unrepresentable).
 *
 * Store access is INJECTED (AssemblerDeps): the production wiring hands in
 * useLexiconStore reads + subscription and the settings-store global flag
 * (via TtsController — a direct lib→store read here would regress the
 * lib-not-to-store ratchet); tests hand in plain objects.
 */
import type { LexiconRule } from '~types/user-data';
import type { BiblePreference } from './biblePreference';
import type { SystemLexiconProvider } from './systemLexicon';
import { bibleLexiconProvider } from './systemLexicon';

export interface CompiledLexicon {
    /** Frozen, stable-identity rule array (the applier's WeakMap key). */
    readonly rules: ReadonlyArray<LexiconRule>;
    /** Bumps on every lexicon-affecting change (store CRUD, bible flag). */
    readonly version: number;
    readonly language?: string;
}

/** The lexicon-store state slice the assembler reads. */
export interface LexiconStateView {
    rules: Record<string, LexiconRule>;
    settings: Record<string, { bibleLexiconEnabled: BiblePreference }>;
}

export interface AssemblerDeps {
    /** Current lexicon store state (rules + per-book settings). */
    getState(): LexiconStateView;
    /** Lexicon store change stream; the assembler bumps its version per event. */
    subscribe(listener: () => void): () => void;
    /** Yjs hydration gate (waitForYjsSync) — awaited before every read. */
    whenReady?(): Promise<unknown>;
    /** System rule sets (defaults to the Bible provider). */
    systemProviders?: SystemLexiconProvider[];
}

export class LexiconAssembler {
    private version = 0;
    private globalBibleEnabled = true;
    private readonly cache = new Map<string, { version: number; compiled: CompiledLexicon }>();
    private readonly listeners = new Set<() => void>();
    private readonly providers: SystemLexiconProvider[];

    constructor(private readonly deps: AssemblerDeps) {
        this.providers = deps.systemProviders ?? [bibleLexiconProvider];
        deps.subscribe(() => this.invalidate());
    }

    /** The current invalidation version (cache keys embed it). */
    getVersion(): number {
        return this.version;
    }

    /** App-layer push of the global Bible flag (settings store). Bumps on change. */
    setGlobalBibleEnabled(enabled: boolean): void {
        if (this.globalBibleEnabled === enabled) return;
        this.globalBibleEnabled = enabled;
        this.invalidate();
    }

    /** Forget all memoized lexicons and notify invalidation listeners. */
    invalidate(): void {
        this.version++;
        this.cache.clear();
        this.listeners.forEach((l) => l());
    }

    /** Invalidation stream (any lexicon-affecting change). */
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * The assembled lexicon for a (bookId, language) pair at the current
     * version. Assembly order preserved verbatim from the legacy
     * LexiconService.getRules: high-priority book rules → global rules →
     * system (Bible) rules → standard book rules.
     */
    async getCompiled(bookId?: string, language?: string): Promise<CompiledLexicon> {
        if (this.deps.whenReady) await this.deps.whenReady();

        const key = `${bookId || 'global'}:${language || 'any'}`;
        const cached = this.cache.get(key);
        if (cached && cached.version === this.version) {
            return cached.compiled;
        }

        const versionAtBuild = this.version;
        const compiled = await this.assemble(bookId, language, versionAtBuild);

        // Memo write happens for EVERY return path (single exit). A version
        // bump during the async assembly invalidates the entry immediately
        // (version mismatch on the next read).
        this.cache.set(key, { version: versionAtBuild, compiled });
        return compiled;
    }

    private async assemble(bookId: string | undefined, language: string | undefined, version: number): Promise<CompiledLexicon> {
        const state = this.deps.getState();
        const allRules = Object.values(state.rules);

        const byLanguage = (r: LexiconRule) => !r.language || !language || r.language === language;
        const byOrder = (a: LexiconRule, b: LexiconRule) => (a.order ?? 0) - (b.order ?? 0);

        // 1. Global rules (sorted by order)
        const globalRules = allRules
            .filter(r => !r.bookId || r.bookId === 'global')
            .filter(byLanguage)
            .sort(byOrder);

        // 2. Book rules, split into high priority (applyBeforeGlobal) and standard
        const bookRules = bookId
            ? allRules.filter(r => r.bookId === bookId).filter(byLanguage)
            : [];
        const highPriority = bookRules.filter(r => r.applyBeforeGlobal).sort(byOrder);
        const lowPriority = bookRules.filter(r => !r.applyBeforeGlobal).sort(byOrder);

        // 3. System rules (Bible): per-book preference resolved against the global flag.
        const pref: BiblePreference | undefined = bookId
            ? state.settings[bookId]?.bibleLexiconEnabled
            : undefined;
        const systemRules: LexiconRule[] = [];
        for (const provider of this.providers) {
            if (provider.appliesTo(pref, this.globalBibleEnabled)) {
                systemRules.push(...await provider.load(language));
            }
        }

        // Assembly order: high-priority book → global → system → standard book.
        const rules = Object.freeze([...highPriority, ...globalRules, ...systemRules, ...lowPriority]);

        return { rules, version, language };
    }
}

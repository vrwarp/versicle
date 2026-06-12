/**
 * LexiconEngine suite (Phase 5c; phase5-tts-strangler.md §5c.3; absorption
 * ledger row 18). Carries the surviving assertions of the deleted
 * LexiconService per-area suites as named `describe('regression: …')`
 * blocks, rewritten against the injected-deps LexiconAssembler (no store
 * module mocks). The fuzz/perf/trace companions survive as
 * LexiconEngine.{fuzz,perf,trace}.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { LexiconAssembler, type LexiconStateView } from './LexiconEngine';
import { bibleLexiconProvider, type SystemLexiconProvider } from './systemLexicon';
import { lexiconApplier, processInitialisms, INITIALISMS_SYSTEM_RULE } from './LexiconApplier';
import { loadBibleLexicon } from './bible-lexicon';
import type { LexiconRule } from '~types/db';

/** Assembler over a mutable in-memory state with manual change events. */
function makeAssembler(opts: {
    rules?: LexiconRule[];
    settings?: LexiconStateView['settings'];
    systemProviders?: SystemLexiconProvider[];
    globalBible?: boolean;
} = {}) {
    const state: LexiconStateView = { rules: {}, settings: opts.settings ?? {} };
    (opts.rules ?? []).forEach(r => { state.rules[r.id] = r; });
    const listeners = new Set<() => void>();
    const assembler = new LexiconAssembler({
        getState: () => state,
        subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
        systemProviders: opts.systemProviders,
    });
    if (opts.globalBible !== undefined) assembler.setGlobalBibleEnabled(opts.globalBible);
    return {
        assembler,
        state,
        emitChange: () => listeners.forEach(l => l()),
        setRules: (rules: LexiconRule[]) => {
            state.rules = {};
            rules.forEach(r => { state.rules[r.id] = r; });
            listeners.forEach(l => l());
        },
    };
}

/** A one-rule fake system provider (stands in for the Bible set). */
const fakeBibleProvider = (rules: Array<Partial<LexiconRule> & { original: string; replacement: string }>): SystemLexiconProvider => ({
    id: 'bible',
    appliesTo: bibleLexiconProvider.appliesTo,
    load: async () => Object.freeze(rules.map((r, i) => ({
        id: `bible-${i}`,
        isRegex: false,
        matchType: 'ignore_case' as const,
        applyBeforeGlobal: false,
        created: 0,
        order: Number.MAX_SAFE_INTEGER - rules.length + i,
        ...r,
    }))),
});

const NO_SYSTEM: SystemLexiconProvider[] = [];

describe('regression: LexiconService.test (assembly + filtering)', () => {
    it('filters rules by language correctly', async () => {
        const h = makeAssembler({
            rules: [
                { id: '1', original: 'a', replacement: 'b', isRegex: false, order: 0, created: 0 }, // no language (global)
                { id: '2', original: 'c', replacement: 'd', isRegex: false, language: 'en', order: 1, created: 0 },
                { id: '3', original: 'e', replacement: 'f', isRegex: false, language: 'zh', order: 2, created: 0 },
            ],
            systemProviders: NO_SYSTEM,
        });

        // Unscoped request returns all rules (no language filter)
        expect((await h.assembler.getCompiled()).rules).toHaveLength(3);

        // Requesting 'en' returns global unscoped rules + 'en' rules
        const en = (await h.assembler.getCompiled(undefined, 'en')).rules;
        expect(en.map(r => r.id)).toEqual(['1', '2']);

        // Requesting 'zh' returns global unscoped rules + 'zh' rules
        const zh = (await h.assembler.getCompiled(undefined, 'zh')).rules;
        expect(zh.map(r => r.id)).toEqual(['1', '3']);
    });

    it('returns rules sorted by order', async () => {
        const h = makeAssembler({
            rules: [
                { id: '1', order: 2, original: 'c', replacement: 'd', created: 0 },
                { id: '2', order: 0, original: 'a', replacement: 'b', created: 0 },
                { id: '3', order: 1, original: 'b', replacement: 'c', created: 0 },
            ],
            systemProviders: NO_SYSTEM,
        });
        const result = (await h.assembler.getCompiled()).rules;
        expect(result.map(r => r.id)).toEqual(['2', '3', '1']);
    });

    it('filters by bookId (book rules + globals)', async () => {
        const h = makeAssembler({
            rules: [
                { id: '1', bookId: 'book1', original: 'x', replacement: 'y', created: 0 },
                { id: '2', original: 'global', replacement: 'z', created: 0 }, // implicit global
            ],
            systemProviders: NO_SYSTEM,
        });

        expect((await h.assembler.getCompiled('book1')).rules).toHaveLength(2);

        const book2 = (await h.assembler.getCompiled('book2')).rules;
        expect(book2.map(r => r.id)).toEqual(['2']);
    });
});

describe('regression: LexiconServiceSort', () => {
    const rule = (id: string, over: Partial<LexiconRule>): LexiconRule =>
        ({ id, original: id, replacement: 'x', created: 0, ...over } as LexiconRule);

    it('prioritizes Book rules before Global rules when applyBefore is true', async () => {
        const h = makeAssembler({
            rules: [rule('g1', { bookId: 'global' }), rule('b1', { bookId: 'b1', applyBeforeGlobal: true })],
            systemProviders: NO_SYSTEM,
        });
        expect((await h.assembler.getCompiled('b1')).rules.map(r => r.id)).toEqual(['b1', 'g1']);
    });

    it('prioritizes Global rules before Book rules when applyBefore is false/undefined', async () => {
        const h = makeAssembler({
            rules: [rule('g1', { bookId: 'global' }), rule('b1', { bookId: 'b1', applyBeforeGlobal: false })],
            systemProviders: NO_SYSTEM,
        });
        expect((await h.assembler.getCompiled('b1')).rules.map(r => r.id)).toEqual(['g1', 'b1']);
    });

    it('handles mixed priorities within the same book', async () => {
        const h = makeAssembler({
            rules: [
                rule('g1', { bookId: 'global' }),
                rule('b_after', { bookId: 'b1', applyBeforeGlobal: false }),
                rule('b_before', { bookId: 'b1', applyBeforeGlobal: true }),
            ],
            systemProviders: NO_SYSTEM,
        });
        expect((await h.assembler.getCompiled('b1')).rules.map(r => r.id)).toEqual(['b_before', 'g1', 'b_after']);
    });

    it('respects order within priority groups', async () => {
        const h = makeAssembler({
            rules: [
                rule('g_early', { bookId: 'global', order: 0 }),
                rule('g_late', { bookId: 'global', order: 10 }),
                rule('b_high_1', { bookId: 'b1', applyBeforeGlobal: true, order: 5 }),
                rule('b_high_2', { bookId: 'b1', applyBeforeGlobal: true, order: 2 }),
                rule('b_low_1', { bookId: 'b1', applyBeforeGlobal: false, order: 1 }),
                rule('b_low_2', { bookId: 'b1', applyBeforeGlobal: false, order: 0 }),
            ],
            systemProviders: NO_SYSTEM,
        });
        expect((await h.assembler.getCompiled('b1')).rules.map(r => r.id))
            .toEqual(['b_high_2', 'b_high_1', 'g_early', 'g_late', 'b_low_2', 'b_low_1']);
    });
});

describe('regression: LexiconServiceBible (system-rule injection)', () => {
    it('places Bible rules between Global and Book(after) rules', async () => {
        const h = makeAssembler({
            rules: [
                { id: 'g1', original: 'Global', replacement: 'G', created: 0, bookId: 'global', applyBeforeGlobal: false, order: 2 },
                { id: 'b_before', original: 'Before', replacement: 'B', created: 0, bookId: 'b1', applyBeforeGlobal: true, order: 1 },
                { id: 'b_after', original: 'After', replacement: 'A', created: 0, bookId: 'b1', applyBeforeGlobal: false, order: 3 },
            ],
            systemProviders: [fakeBibleProvider([{ original: 'Bible', replacement: 'Bib' }])],
            globalBible: true,
        });

        const ids = (await h.assembler.getCompiled('b1')).rules.map(r => r.id);
        // 1. High-priority book rules → 2. Globals → 3. Bible (system defaults) → 4. Standard book rules
        expect(ids).toEqual(['b_before', 'g1', 'bible-0', 'b_after']);
    });

    it('omits Bible rules when the per-book preference is off', async () => {
        const h = makeAssembler({
            rules: [{ id: 'g1', original: 'Global', replacement: 'G', created: 0, bookId: 'global' }],
            settings: { b1: { bibleLexiconEnabled: 'off' } },
            systemProviders: [fakeBibleProvider([{ original: 'Bible', replacement: 'Bib' }])],
            globalBible: true,
        });
        expect((await h.assembler.getCompiled('b1')).rules.map(r => r.id)).toEqual(['g1']);
    });

    it('injects Bible rules when the per-book preference overrides a disabled global flag', async () => {
        const h = makeAssembler({
            rules: [],
            settings: { b1: { bibleLexiconEnabled: 'on' } },
            systemProviders: [fakeBibleProvider([{ original: 'Bible', replacement: 'Bib' }])],
            globalBible: false,
        });
        expect((await h.assembler.getCompiled('b1')).rules.map(r => r.id)).toEqual(['bible-0']);
    });

    it('the real Bible provider filters by language prefix and compiles once per language', async () => {
        const en1 = await bibleLexiconProvider.load('en');
        const en2 = await bibleLexiconProvider.load('en');
        const zh = await bibleLexiconProvider.load('zh-TW');
        expect(en1).toBe(en2); // memoized, stable identity
        expect(en1.length).toBeGreaterThan(0);
        expect(Object.isFrozen(en1)).toBe(true);

        const { rules: raw } = await loadBibleLexicon();
        const zhTagged = raw.filter(r => r.language === 'zh').length;
        const untagged = raw.filter(r => !r.language).length;
        expect(zhTagged).toBeGreaterThan(0); // the data ships zh book-name rules
        // 'zh-TW' prefix-matches rules tagged 'zh'; 'en' excludes them.
        expect(zh.length).toBe(untagged + zhTagged);
        expect(en1.length).toBe(raw.filter(r => !r.language || 'en'.startsWith(r.language.toLowerCase())).length);
    });
});

describe('CompiledLexicon memo + invalidation (5c-PR3: S15 dies)', () => {
    it('returns the SAME CompiledLexicon (stable rules identity) for repeated calls', async () => {
        const h = makeAssembler({
            rules: [{ id: '1', original: 'a', replacement: 'b', created: 0 }],
            systemProviders: NO_SYSTEM,
        });
        const a = await h.assembler.getCompiled('book1', 'en');
        const b = await h.assembler.getCompiled('book1', 'en');
        expect(b).toBe(a);              // memo hit — the S15 book-path cache bug is dead
        expect(b.rules).toBe(a.rules);  // stable identity → LexiconApplier WeakMap stays hot
        expect(Object.isFrozen(a.rules)).toBe(true);
    });

    it('memoizes the book path too (the legacy early-return skipped the cache write)', async () => {
        const h = makeAssembler({ rules: [], systemProviders: NO_SYSTEM });
        const spy = vi.fn(h.assembler['deps' as never]['getState' as never]);
        const a = await h.assembler.getCompiled('book1', 'en');
        const b = await h.assembler.getCompiled('book1', 'en');
        expect(b).toBe(a);
        void spy;
    });

    it('a store change bumps the version and produces a fresh lexicon', async () => {
        const h = makeAssembler({
            rules: [{ id: '1', original: 'a', replacement: 'b', created: 0 }],
            systemProviders: NO_SYSTEM,
        });
        const before = await h.assembler.getCompiled('book1', 'en');

        h.setRules([
            { id: '1', original: 'a', replacement: 'b', created: 0 },
            { id: '2', original: 'c', replacement: 'd', created: 0 },
        ]);

        const after = await h.assembler.getCompiled('book1', 'en');
        expect(after).not.toBe(before);
        expect(after.version).toBeGreaterThan(before.version);
        expect(after.rules.map(r => r.id)).toEqual(['1', '2']);
    });

    it('a global Bible flag change invalidates; an identical write does not', async () => {
        const h = makeAssembler({
            rules: [],
            systemProviders: [fakeBibleProvider([{ original: 'Bible', replacement: 'Bib' }])],
            globalBible: true,
        });
        const withBible = await h.assembler.getCompiled('book1', 'en');
        expect(withBible.rules.map(r => r.id)).toEqual(['bible-0']);

        h.assembler.setGlobalBibleEnabled(true); // no change → same memo
        expect(await h.assembler.getCompiled('book1', 'en')).toBe(withBible);

        h.assembler.setGlobalBibleEnabled(false);
        const without = await h.assembler.getCompiled('book1', 'en');
        expect(without.rules).toHaveLength(0);
        expect(without.version).toBeGreaterThan(withBible.version);
    });

    it('notifies invalidation subscribers (the engine drops its handle mid-playback)', () => {
        const h = makeAssembler({ systemProviders: NO_SYSTEM });
        const listener = vi.fn();
        h.assembler.subscribe(listener);
        h.emitChange();
        expect(listener).toHaveBeenCalledTimes(1);
    });
});

describe('regression: LexiconServiceInitialisms', () => {
    describe('core phonetic replacement', () => {
        it('replaces "A." with "Eigh" when followed by another initial', () => {
            expect(processInitialisms('A. W. Tozer')).toBe('Eigh W Tozer');
        });
        it('handles C. S. Lewis', () => {
            expect(processInitialisms('C. S. Lewis')).toBe('C S Lewis');
        });
        it('handles J. R. R. Tolkien', () => {
            expect(processInitialisms('J. R. R. Tolkien')).toBe('J R R Tolkien');
        });
        it('handles middle initials like "John F. Kennedy"', () => {
            expect(processInitialisms('John F. Kennedy')).toBe('John F Kennedy');
        });
    });

    describe('edge cases - no false positives', () => {
        it('does NOT alter "A" used as an article in normal text', () => {
            const text = 'A man walked into a room.';
            expect(processInitialisms(text)).toBe(text);
        });
        it('maps a sentence-final single letter followed by a Title Case word', () => {
            expect(processInitialisms('The answer is A. We continue here.')).toBe('The answer is Eigh We continue here.');
        });
        it('does NOT alter lowercase initials', () => {
            expect(processInitialisms('a. w. tozer')).toBe('a. w. tozer');
        });
        it('does NOT alter a standalone capital letter without a period', () => {
            const text = 'Grade A work from the team.';
            expect(processInitialisms(text)).toBe(text);
        });
    });

    describe('multiple initialisms and boundaries', () => {
        it('handles two separate initialized names', () => {
            expect(processInitialisms('A. W. Tozer and C. S. Lewis')).toBe('Eigh W Tozer and C S Lewis');
        });
        it('handles A. B. C. D. chains', () => {
            expect(processInitialisms('A. B. C. D. Smith')).toBe('Eigh B C D Smith');
        });
        it('handles multiple spaces between initials', () => {
            expect(processInitialisms('A.  W. Tozer')).toBe('Eigh W Tozer');
        });
        it('returns empty string for empty input', () => {
            expect(processInitialisms('')).toBe('');
        });
    });

    describe('applier integration (the VISIBLE system rule, content D12)', () => {
        it('applyLexicon processes initialisms before lexicon rules (default ON)', () => {
            const rules: LexiconRule[] = [{ id: '1', original: 'Tozer', replacement: 'TOE-zer', created: 0 }];
            expect(lexiconApplier.applyLexicon('A. W. Tozer', rules)).toBe('Eigh W TOE-zer');
        });

        it('the initialisms pass is toggleable per call', () => {
            expect(lexiconApplier.applyLexicon('A. W. Tozer', [], { initialisms: false })).toBe('A. W. Tozer');
        });

        it('applyLexiconWithTrace shows the system rule as a visible trace entry', () => {
            const rules: LexiconRule[] = [{ id: '1', original: 'Tozer', replacement: 'TOE-zer', created: 0 }];
            const result = lexiconApplier.applyLexiconWithTrace('A. W. Tozer', rules);
            expect(result.final).toBe('Eigh W TOE-zer');
            expect(result.trace).toHaveLength(2);
            expect(result.trace[0].rule.id).toBe(INITIALISMS_SYSTEM_RULE.id);
            expect(result.trace[0].before).toBe('A. W. Tozer');
            expect(result.trace[0].after).toBe('Eigh W Tozer');
            expect(result.trace[1].rule.id).toBe('1');
        });

        it('emits no system trace entry when initialisms leave the text unchanged', () => {
            const result = lexiconApplier.applyLexiconWithTrace('plain text', []);
            expect(result.trace).toHaveLength(0);
        });
    });
});

describe('golden: audio-cache-key stability (default output byte-identical)', () => {
    // Audio cache keys are SHA-256 of the PROCESSED text — these literals pin
    // the default applyLexicon output across the 5c-PR3 applier rework so no
    // user's synthesized-audio cache is invalidated.
    const RULES: LexiconRule[] = [
        { id: '1', original: 'Hello', replacement: 'Hi', created: 0 },
        { id: '2', original: 'chapter (\\d+)', replacement: 'Section $1', isRegex: true, matchType: 'regex', created: 0 },
    ];

    const GOLDEN: Array<[string, string]> = [
        ['Hello world. Hello.', 'Hi world. Hi.'],
        ['Read Chapter 5 now.', 'Read Section 5 now.'],
        ['A. W. Tozer wrote Hello.', 'Eigh W Tozer wrote Hi.'],
        // NFKD: é decomposes (e + U+0301), ligature ﬁ expands
        ['café ﬁrst Hello', 'cafe\u0301 first Hi'],
        ['No rule matches here.', 'No rule matches here.'],
    ];

    it.each(GOLDEN)('applyLexicon(%j) === %j', (input, expected) => {
        expect(lexiconApplier.applyLexicon(input, RULES)).toBe(expected);
    });
});

describe('regression: LexiconService.test (applyLexicon semantics)', () => {
    it('replaces exact matches with word boundaries by default', () => {
        const rules: LexiconRule[] = [{ id: '1', original: 'Hello', replacement: 'Hi', created: 0 }];
        expect(lexiconApplier.applyLexicon('Hello world. Hello.', rules)).toBe('Hi world. Hi.');
    });

    it('does not replace substrings by default', () => {
        const rules: LexiconRule[] = [{ id: '1', original: 'cat', replacement: 'dog', created: 0 }];
        expect(lexiconApplier.applyLexicon('The caterpillar is a cat.', rules)).toBe('The caterpillar is a dog.');
    });

    it('handles regex rules when isRegex is true', () => {
        const rules: LexiconRule[] = [{ id: '1', original: 's\\/he', replacement: 'they', isRegex: true, created: 0 }];
        expect(lexiconApplier.applyLexicon('When s/he arrives.', rules)).toBe('When they arrives.');
    });

    it('handles invalid regex gracefully', () => {
        const rules: LexiconRule[] = [{ id: '1', original: '[invalid', replacement: 'valid', isRegex: true, created: 0 }];
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
        expect(lexiconApplier.applyLexicon('Some [invalid text.', rules)).toBe('Some [invalid text.');
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it('still escapes default rules even if they look like regex', () => {
        const rules: LexiconRule[] = [{ id: '1', original: 'C++', replacement: 'C Plus Plus', created: 0 }];
        expect(lexiconApplier.applyLexicon('I love C++.', rules)).toBe('I love C Plus Plus.');
    });
});

/**
 * Replication-completeness tests.
 *
 * The declarative spec (replicationSpec.ts) is the single source of truth for what state is
 * replicated into the worker engine. These tests pin the contract from both sides:
 *   - every EngineStateUpdate kind has exactly one spec entry, every boot slice produces a
 *     snapshot and live updates of its declared kind (a pusher exists);
 *   - WorkerEngineContext throws on sync reads of never-replicated boot slices (no silent
 *     defaults) and serves them once the boot snapshots are applied (a cache handler exists).
 * A slice added on only one side fails here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Plain fake stores: getState returns mutable state, subscribe captures listeners so tests
// can emit changes. Mocked at the module level so the spec (and nothing else) sees them.
const { fakeStores } = vi.hoisted(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function fakeStore(initial: any) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const listeners = new Set<(s: any, prev: any) => void>();
        const store = {
            state: initial,
            getState: () => store.state,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            subscribe: (l: (s: any, prev: any) => void) => {
                listeners.add(l);
                return () => listeners.delete(l);
            },
            // Zustand hands listeners (state, prevState) — slices that diff against the
            // previous state (analysis) depend on the second argument.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            emit: (s: any) => {
                const prev = store.state;
                store.state = s;
                listeners.forEach((l) => l(s, prev));
            },
            listenerCount: () => listeners.size,
        };
        return store;
    }
    return {
        fakeStores: {
            tts: fakeStore({
                activeLanguage: 'en',
                profiles: { en: { voiceId: null, rate: 1, minSentenceLength: 36 } },
                customAbbreviations: [],
                alwaysMerge: [],
                sentenceStarters: [],
                sanitizationEnabled: true,
                isBibleLexiconEnabled: true,
            }),
            playback: fakeStore({ status: 'stopped', queue: [], currentIndex: 0 }),
            genAI: fakeStore({ isEnabled: false, logs: [] }),
            lexicon: fakeStore({ rules: {}, settings: {} }),
            analysis: fakeStore({ sections: {} }),
            book: fakeStore({ books: { b1: { bookId: 'b1', language: 'fr' } } }),
            reading: fakeStore({ getProgress: () => null }),
        },
    };
});

vi.mock('@store/useTTSSettingsStore', () => ({ useTTSSettingsStore: fakeStores.tts }));
vi.mock('@store/useTTSPlaybackStore', () => ({ useTTSPlaybackStore: fakeStores.playback }));
vi.mock('@store/useGenAIStore', () => ({ useGenAIStore: fakeStores.genAI }));
vi.mock('@store/useLexiconStore', () => ({ useLexiconStore: fakeStores.lexicon }));
vi.mock('@store/useContentAnalysisStore', () => ({ useContentAnalysisStore: fakeStores.analysis }));
vi.mock('@store/useBookStore', () => ({ useBookStore: fakeStores.book }));
vi.mock('@store/useReadingStateStore', () => ({ useReadingStateStore: fakeStores.reading }));

import { createReplicatedSlices, bookSnapshotUpdates } from './replicationSpec';
import { WorkerEngineContext, type EngineStateUpdate } from '@lib/tts/engine/WorkerEngineContext';

const ALL_KINDS: EngineStateUpdate['kind'][] = [
    'settings', 'genAI', 'activeLanguage', 'bookLanguage', 'analysis', 'progress', 'lexicon',
];

function makeSlices(currentBookId: string | null = 'b1') {
    return createReplicatedSlices({ getCurrentBookId: () => currentBookId });
}

describe('replication spec completeness', () => {
    it('covers every EngineStateUpdate kind exactly once', () => {
        const kinds = makeSlices().map((s) => s.kind).sort();
        expect(kinds).toEqual([...ALL_KINDS].sort());
    });

    it('every boot slice produces a snapshot of its own kind (a boot pusher exists)', () => {
        for (const slice of makeSlices().filter((s) => s.replication === 'boot')) {
            const updates = slice.snapshot();
            expect(updates.length, `boot slice '${slice.kind}' must snapshot`).toBeGreaterThan(0);
            for (const u of updates) expect(u.kind).toBe(slice.kind);
        }
    });

    it('every slice pushes updates of its own kind when its store changes (a live pusher exists)', () => {
        makeSlices().forEach((slice, i) => {
            const pushed: EngineStateUpdate[] = [];
            const unsub = slice.subscribe((u) => pushed.push(u));

            // Emit a change on every fake store (unique values so deduping slices still fire);
            // the slice should react to (at least) its own.
            fakeStores.tts.emit({ activeLanguage: `lang-${i}`, profiles: {} });
            fakeStores.genAI.emit({ isEnabled: true, contentFilterSkipTypes: [`t-${i}`] });
            fakeStores.analysis.emit({ sections: { 'b1/s1': { title: 'T' } } });
            fakeStores.book.emit({ books: { b1: { bookId: 'b1', language: 'fr' } } });
            fakeStores.reading.emit({ getProgress: () => ({ percentage: 10 }) });
            fakeStores.lexicon.emit({ rules: { [`r-${i}`]: { id: `r-${i}` } }, settings: {} });

            expect(pushed.length, `slice '${slice.kind}' must push on store change`).toBeGreaterThan(0);
            for (const u of pushed) expect(u.kind).toBe(slice.kind);
            unsub();
        });
    });

    it('per-book slices are covered by the setBook pre-push (bookSnapshotUpdates)', () => {
        const kinds = bookSnapshotUpdates('b1').map((u) => u.kind).sort();
        const perBookKinds = makeSlices()
            .filter((s) => s.replication === 'per-book')
            .map((s) => s.kind)
            .sort();
        expect(kinds).toEqual(perBookKinds);
    });

    it('the settings slice pushes the EXPLICIT TTSSettingsData payload, nothing more (5b-PR3)', () => {
        // Reset the fake store (earlier tests overwrite its state wholesale).
        fakeStores.tts.state = {
            activeLanguage: 'en',
            profiles: { en: { voiceId: null, rate: 1, minSentenceLength: 36 } },
            customAbbreviations: [],
            alwaysMerge: [],
            sentenceStarters: [],
            sanitizationEnabled: true,
            isBibleLexiconEnabled: true,
            // Fields the engine does NOT read — must not cross the boundary:
            providerId: 'webspeech',
            apiKeys: { google: 'secret' },
            whiteNoiseVolume: 0.1,
        };
        const slice = makeSlices().find((s) => s.kind === 'settings')!;
        const [snapshot] = slice.snapshot();
        expect(snapshot.kind).toBe('settings');
        const settings = (snapshot as unknown as { settings: Record<string, unknown> }).settings;
        // Exactly the engine-read field set — no playback mirror, no queue, no
        // actions, no api keys (the old plain(getState()) shipped everything).
        expect(Object.keys(settings).sort()).toEqual([
            'alwaysMerge',
            'customAbbreviations',
            'isBibleLexiconEnabled',
            'profiles',
            'sanitizationEnabled',
            'sentenceStarters',
        ]);
    });

    it('NO-ECHO (S6): playback-store updates produce ZERO worker pushes; a settings change produces pushes', () => {
        const slices = makeSlices();
        const pushed: EngineStateUpdate[] = [];
        const unsubs = slices.map((s) => s.subscribe((u) => pushed.push(u)));

        // The engine broadcast path: the TtsController mirror writes the playback
        // store. No replication slice subscribes to it — the per-sentence echo
        // loop (engine broadcast → settings push → worker echo) is structurally dead.
        expect(fakeStores.playback.listenerCount(), 'no slice may subscribe to the playback store').toBe(0);
        fakeStores.playback.emit({ status: 'playing', queue: [{ text: 'x' }], currentIndex: 1 });
        expect(pushed).toHaveLength(0);

        // A real settings edit DOES reach the worker.
        fakeStores.tts.emit({
            activeLanguage: 'en',
            profiles: { en: { voiceId: 'v', rate: 1.5 } },
            customAbbreviations: [],
            alwaysMerge: [],
            sentenceStarters: [],
            sanitizationEnabled: true,
            isBibleLexiconEnabled: true,
        });
        expect(pushed.some((u) => u.kind === 'settings')).toBe(true);

        unsubs.forEach((u) => u());
    });

    it('genAI echo guard: store changes outside the engine view (e.g. addGenAILog) do not push', () => {
        const slice = makeSlices().find((s) => s.kind === 'genAI')!;
        const pushed: EngineStateUpdate[] = [];
        const unsub = slice.subscribe((u) => pushed.push(u));

        // A log append (the addGenAILog host-command round trip) leaves the
        // engine-read view unchanged — guarded, no push.
        const base = fakeStores.genAI.state;
        fakeStores.genAI.emit({ ...base, logs: [{ msg: 'entry' }] });
        expect(pushed).toHaveLength(0);

        // A field the engine reads changes — exactly one push.
        fakeStores.genAI.emit({ ...base, logs: [{ msg: 'entry' }], isEnabled: !base.isEnabled });
        expect(pushed).toHaveLength(1);
        expect(pushed[0].kind).toBe('genAI');

        unsub();
    });

    describe("regression: progress slice does not echo the engine's own writes", () => {
        // The engine writes progress per sentence (updateTTSProgress) and per finished
        // sentence (addCompletedRange); both land in the reading-state store on the host and
        // used to round-trip the WHOLE UserProgress (completedRanges + up to 500
        // readingSessions) back into the worker, twice per sentence. The slice now replicates
        // only the two fields restoreQueue reads, behind an equality guard.
        const fullProgress = {
            bookId: 'b1',
            percentage: 0.5,
            lastRead: 1,
            currentQueueIndex: 3,
            currentSectionIndex: 1,
            completedRanges: ['cfi(/2)'],
            readingSessions: [{ type: 'tts', timestamp: 1 }],
        };

        it('pushes nothing when only non-engine fields change (the addCompletedRange echo)', () => {
            const slice = makeSlices('b1').find((s) => s.kind === 'progress')!;
            const pushed: EngineStateUpdate[] = [];
            const unsub = slice.subscribe((u) => pushed.push(u));

            fakeStores.reading.emit({ getProgress: () => fullProgress });
            expect(pushed, 'the first view of a book replicates once').toHaveLength(1);

            // addCompletedRange: a new range + a new session entry, SAME queue/section index.
            fakeStores.reading.emit({
                getProgress: () => ({
                    ...fullProgress,
                    completedRanges: ['cfi(/2)', 'cfi(/4)'],
                    readingSessions: [{ type: 'tts', timestamp: 1 }, { type: 'tts', timestamp: 2 }],
                    lastRead: 2,
                }),
            });
            expect(pushed, 'the engine echo must not cross the worker boundary').toHaveLength(1);

            unsub();
        });

        it('pushes exactly one NARROWED update when the queue index moves', () => {
            const slice = makeSlices('b1').find((s) => s.kind === 'progress')!;
            const pushed: EngineStateUpdate[] = [];
            const unsub = slice.subscribe((u) => pushed.push(u));

            fakeStores.reading.emit({ getProgress: () => fullProgress });
            pushed.length = 0;
            fakeStores.reading.emit({
                getProgress: () => ({ ...fullProgress, currentQueueIndex: 4 }),
            });

            expect(pushed).toHaveLength(1);
            const payload = (pushed[0] as unknown as { progress: Record<string, unknown> }).progress;
            expect(Object.keys(payload).sort()).toEqual(['currentQueueIndex', 'currentSectionIndex']);
            expect(payload).not.toHaveProperty('completedRanges');
            expect(payload).not.toHaveProperty('readingSessions');
            expect(payload.currentQueueIndex).toBe(4);

            unsub();
        });

        it('bookSnapshotUpdates replicates the same narrowed view (setBook pre-push)', () => {
            fakeStores.reading.state = { getProgress: () => fullProgress };
            const update = bookSnapshotUpdates('b1').find((u) => u.kind === 'progress')!;
            const payload = (update as unknown as { progress: Record<string, unknown> }).progress;
            expect(Object.keys(payload).sort()).toEqual(['currentQueueIndex', 'currentSectionIndex']);
        });
    });

    describe('regression: bookLanguage pushes one update, for the current book only', () => {
        // The old slice looped the WHOLE library on every book-store write: 300 books meant
        // 300 Comlink messages and 300 bookListeners firings in the worker, for state the
        // engine only ever reads for the current book.
        const library = {
            books: {
                b1: { bookId: 'b1', language: 'fr' },
                b2: { bookId: 'b2', language: 'de' },
                b3: { bookId: 'b3', language: 'ja' },
            },
        };

        it('pushes exactly one update for the current book, not one per book in the library', () => {
            fakeStores.book.state = library;
            const slice = makeSlices('b1').find((s) => s.kind === 'bookLanguage')!;
            const pushed: EngineStateUpdate[] = [];
            const unsub = slice.subscribe((u) => pushed.push(u));

            fakeStores.book.emit({ books: { ...library.books } });

            expect(pushed).toHaveLength(1);
            expect(pushed[0]).toEqual({ kind: 'bookLanguage', bookId: 'b1', lang: 'fr' });
            unsub();
        });

        it('pushes nothing when the current book language is unchanged', () => {
            fakeStores.book.state = library;
            const slice = makeSlices('b1').find((s) => s.kind === 'bookLanguage')!;
            const pushed: EngineStateUpdate[] = [];
            const unsub = slice.subscribe((u) => pushed.push(u));

            fakeStores.book.emit({ books: { ...library.books } });
            pushed.length = 0;
            // Another book's metadata changed (a remote Yjs library update) — no news here.
            fakeStores.book.emit({ books: { ...library.books, b2: { bookId: 'b2', language: 'es' } } });
            expect(pushed).toHaveLength(0);

            // The current book's language really changing still crosses.
            fakeStores.book.emit({ books: { ...library.books, b1: { bookId: 'b1', language: 'nl' } } });
            expect(pushed).toEqual([{ kind: 'bookLanguage', bookId: 'b1', lang: 'nl' }]);
            unsub();
        });
    });

    describe('regression: analysis slice pushes only the current book', () => {
        // `sections` is keyed `${bookId}/${sectionId}` across the WHOLE library and its
        // entries carry tableAdaptations text; the old slice deep-cloned all of it on every
        // content-analysis write — including the worker's own markAnalysisLoading /
        // saveTableAdaptations echoes.
        const a1 = { status: 'success', generatedAt: 1 };
        const b1 = { status: 'success', generatedAt: 1 };

        function seed() {
            fakeStores.analysis.state = { sections: { 'b1/s1': a1, 'b2/s9': b1 } };
        }

        it('pushes a single-entry delta for the current book and nothing for other books', () => {
            seed();
            const slice = makeSlices('b1').find((s) => s.kind === 'analysis')!;
            const pushed: EngineStateUpdate[] = [];
            const unsub = slice.subscribe((u) => pushed.push(u));

            const a2 = { status: 'success', generatedAt: 2 };
            fakeStores.analysis.emit({ sections: { 'b1/s1': a2, 'b2/s9': b1 } });
            expect(pushed).toHaveLength(1);
            expect(pushed[0]).toEqual({ kind: 'analysis', key: 'b1/s1', analysis: a2 });

            // A change to ANOTHER book is not the engine's business — zero pushes.
            pushed.length = 0;
            fakeStores.analysis.emit({
                sections: { 'b1/s1': a2, 'b2/s9': { status: 'success', generatedAt: 5 } },
            });
            expect(pushed).toHaveLength(0);
            unsub();
        });

        it('falls back to a BOOK-SCOPED, BOOK-TAGGED full map when several entries change at once', () => {
            seed();
            const slice = makeSlices('b1').find((s) => s.kind === 'analysis')!;
            const pushed: EngineStateUpdate[] = [];
            const unsub = slice.subscribe((u) => pushed.push(u));

            fakeStores.analysis.emit({
                sections: {
                    'b1/s1': { status: 'success', generatedAt: 3 },
                    'b1/s2': { status: 'loading', generatedAt: 3 },
                    'b2/s9': b1,
                },
            });

            expect(pushed).toHaveLength(1);
            const update = pushed[0] as unknown as { bookId?: string; snapshot: { sections: Record<string, unknown> } };
            expect(Object.keys(update.snapshot.sections).sort()).toEqual(['b1/s1', 'b1/s2']);
            // The map carries the book it is authoritative FOR. Without that tag the worker
            // treats a map as the whole cache and drops every other book (see the regression
            // block below); the payload's key set alone does not say which shape this is.
            expect(update.bookId).toBe('b1');
            unsub();
        });
    });

    describe('regression: a book-scoped analysis map must not wipe the other books', () => {
        // The two sides of this one kind have to agree on SCOPE. The host scopes its
        // multi-change fallback to the open book — the whole point of the change was to stop
        // deep-cloning a cross-library map on every write — while the worker used to treat
        // any map as authoritative for its entire cache. Other books' boot-replicated
        // entries were silently dropped, and a book switch pushes language + progress only,
        // never analysis, so they never came back: the AnalysisApplier found nothing on
        // section load and neither applied nor cleared that book's mask/adaptations.
        const otherBook = { status: 'success', generatedAt: 1 };

        function bootedWorker() {
            fakeStores.analysis.state = {
                sections: { 'b1/s1': { status: 'success', generatedAt: 1 }, 'b2/s9': otherBook },
            };
            const ctx = new WorkerEngineContext({ post: vi.fn() });
            const slice = makeSlices('b1').find((s) => s.kind === 'analysis')!;
            // Boot replicates cross-book (the engine has no book yet), then b1 is opened.
            for (const update of slice.snapshot()) ctx.applyUpdate(update);
            return { ctx, unsub: slice.subscribe((u) => ctx.applyUpdate(u)) };
        }

        it('keeps book B when a multi-entry write lands for the open book A', () => {
            const { ctx, unsub } = bootedWorker();

            // A remote sync lands two of the open book's analyses in ONE store write.
            fakeStores.analysis.emit({
                sections: {
                    'b1/s1': { status: 'success', generatedAt: 3 },
                    'b1/s2': { status: 'loading', generatedAt: 3 },
                    'b2/s9': otherBook,
                },
            });

            expect(ctx.contentAnalysis.getAnalysis('b1', 's2')).toBeDefined();
            expect(
                ctx.contentAnalysis.getAnalysis('b2', 's9'),
                'switching to b2 pushes no analysis — this entry is all the engine will ever have',
            ).toEqual(otherBook);
            unsub();
        });

        it('deleting the open book\'s analyses empties only that book', () => {
            const { ctx, unsub } = bootedWorker();

            fakeStores.analysis.emit({ sections: { 'b2/s9': otherBook } });

            expect(ctx.contentAnalysis.getAnalysis('b1', 's1')).toBeUndefined();
            expect(ctx.contentAnalysis.getAnalysis('b2', 's9')).toEqual(otherBook);
            unsub();
        });
    });

    describe('regression: the bookLanguage echo guard tracks the WORKER cache, not one writer', () => {
        // That cache has two writers — this slice's subscription and the setBook pre-push
        // (bookSnapshotUpdates) — and the guard used to remember only its own pushes. Any
        // window with no current book desynchronizes them: the subscription drops the writes
        // it sees there, so a later write back to the pre-window language looks like "no
        // news" and is suppressed, leaving the worker on a language the store no longer has.
        // PlaybackController's language sync only re-reads when an update is APPLIED
        // (bookListeners), so TTS keeps the wrong voice until the next book switch.
        it('re-pushes a language the setBook pre-push overwrote while no book was open', () => {
            const ctx = new WorkerEngineContext({ post: vi.fn() });
            fakeStores.book.state = { books: { b1: { bookId: 'b1', language: 'fr' } } };

            let currentBookId: string | null = 'b1';
            const slice = createReplicatedSlices({ getCurrentBookId: () => currentBookId })
                .find((s) => s.kind === 'bookLanguage')!;
            const unsub = slice.subscribe((u) => ctx.applyUpdate(u));

            fakeStores.book.emit({ books: { b1: { bookId: 'b1', language: 'fr' } } });
            expect(ctx.book.getBookLanguage('b1')).toBe('fr');

            // The reader closes (setBook(null)); edits in this window never cross.
            currentBookId = null;
            fakeStores.book.emit({ books: { b1: { bookId: 'b1', language: 'de' } } });

            // Reopening pre-pushes the store's real value — the other writer of this cache.
            currentBookId = 'b1';
            for (const update of bookSnapshotUpdates('b1')) ctx.applyUpdate(update);
            expect(ctx.book.getBookLanguage('b1')).toBe('de');

            // Back to the pre-window language: news to the WORKER, whatever this
            // subscription pushed last.
            fakeStores.book.emit({ books: { b1: { bookId: 'b1', language: 'fr' } } });
            expect(ctx.book.getBookLanguage('b1')).toBe('fr');
            unsub();
        });
    });

    it('the progress slice pushes only for the current book', () => {
        const slice = makeSlices('b1').find((s) => s.kind === 'progress')!;
        const pushed: EngineStateUpdate[] = [];
        const unsub = slice.subscribe((u) => pushed.push(u));
        fakeStores.reading.emit({ getProgress: () => ({ percentage: 50 }) });
        expect(pushed).toHaveLength(1);
        expect(pushed[0]).toMatchObject({ kind: 'progress', bookId: 'b1' });
        unsub();

        const noBook = makeSlices(null).find((s) => s.kind === 'progress')!;
        const pushed2: EngineStateUpdate[] = [];
        const unsub2 = noBook.subscribe((u) => pushed2.push(u));
        fakeStores.reading.emit({ getProgress: () => ({ percentage: 60 }) });
        expect(pushed2).toHaveLength(0);
        unsub2();
    });
});

describe('WorkerEngineContext loud failures (no silent defaults)', () => {
    let ctx: WorkerEngineContext;

    beforeEach(() => {
        ctx = new WorkerEngineContext({ post: vi.fn() });
    });

    it('throws on every boot-slice sync read before replication', () => {
        expect(() => ctx.config.getSettings()).toThrow(/never replicated/);
        expect(() => ctx.config.getActiveLanguage()).toThrow(/never replicated/);
        expect(() => ctx.genAI.getSettings()).toThrow(/never replicated/);
        expect(() => ctx.contentAnalysis.getSnapshot()).toThrow(/never replicated/);
        expect(() => ctx.contentAnalysis.getAnalysis('b1', 's1')).toThrow(/never replicated/);
    });

    it('serves every boot-slice sync read once the boot snapshots are applied', () => {
        ctx.applyUpdate({ kind: 'settings', settings: { rate: 1 } as never });
        ctx.applyUpdate({ kind: 'activeLanguage', lang: 'en' });
        ctx.applyUpdate({ kind: 'genAI', settings: { isEnabled: false } as never });
        ctx.applyUpdate({ kind: 'analysis', snapshot: { sections: {} } });

        expect(ctx.config.getSettings()).toEqual({ rate: 1 });
        expect(ctx.config.getActiveLanguage()).toBe('en');
        expect(ctx.genAI.getSettings()).toEqual({ isEnabled: false });
        expect(ctx.contentAnalysis.getSnapshot()).toEqual({ sections: {} });
        expect(ctx.contentAnalysis.getAnalysis('b1', 's1')).toBeUndefined();
    });

    it('tracks received kinds for the readiness gate', () => {
        expect(ctx.receivedKinds.size).toBe(0);
        ctx.applyUpdate({ kind: 'settings', settings: {} as never });
        ctx.applyUpdate({ kind: 'progress', bookId: 'b1', progress: null });
        expect([...ctx.receivedKinds].sort()).toEqual(['progress', 'settings']);
    });

    it('serves per-book reads from the pre-pushed cache (and warns + falls back on a miss)', () => {
        ctx.applyUpdate({ kind: 'bookLanguage', bookId: 'b1', lang: 'fr' });
        ctx.applyUpdate({ kind: 'progress', bookId: 'b1', progress: { percentage: 10 } as never });

        expect(ctx.book.getBookLanguage('b1')).toBe('fr');
        expect(ctx.readingState.getProgress('b1')).toEqual({ percentage: 10 });

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(ctx.book.getBookLanguage('unknown')).toBe('en');
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('no replicated language'));
        warn.mockRestore();
    });
});

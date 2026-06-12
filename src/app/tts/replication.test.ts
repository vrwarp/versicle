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
        const listeners = new Set<(s: any) => void>();
        const store = {
            state: initial,
            getState: () => store.state,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            subscribe: (l: (s: any) => void) => {
                listeners.add(l);
                return () => listeners.delete(l);
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            emit: (s: any) => {
                store.state = s;
                listeners.forEach((l) => l(s));
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
            analysis: fakeStore({ sections: {} }),
            book: fakeStore({ books: { b1: { bookId: 'b1', language: 'fr' } } }),
            reading: fakeStore({ getProgress: () => null }),
        },
    };
});

vi.mock('@store/useTTSSettingsStore', () => ({ useTTSSettingsStore: fakeStores.tts }));
vi.mock('@store/useTTSPlaybackStore', () => ({ useTTSPlaybackStore: fakeStores.playback }));
vi.mock('@store/useGenAIStore', () => ({ useGenAIStore: fakeStores.genAI }));
vi.mock('@store/useContentAnalysisStore', () => ({ useContentAnalysisStore: fakeStores.analysis }));
vi.mock('@store/useBookStore', () => ({ useBookStore: fakeStores.book }));
vi.mock('@store/useReadingStateStore', () => ({ useReadingStateStore: fakeStores.reading }));

import { createReplicatedSlices, bookSnapshotUpdates } from './replicationSpec';
import { WorkerEngineContext, type EngineStateUpdate } from '@lib/tts/engine/WorkerEngineContext';

const ALL_KINDS: EngineStateUpdate['kind'][] = [
    'settings', 'genAI', 'activeLanguage', 'bookLanguage', 'analysis', 'progress',
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

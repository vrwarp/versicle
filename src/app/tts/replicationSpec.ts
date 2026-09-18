/**
 * The single declarative description of every store slice replicated into the worker engine.
 *
 * One table drives the whole replication path, so adding a slice is one edit here (plus its
 * member in {@link EngineStateUpdate}, which the compiler then forces everywhere):
 *   - `createWorkerEngineClient` pushes each slice's `snapshot()` at boot and wires each
 *     slice's `subscribe()` for live updates — it cannot forget a slice, because it iterates
 *     this table instead of hand-writing pushes;
 *   - `WorkerEngineContext` refuses to serve sync reads for snapshot slices that were never
 *     pushed (loud failure instead of a silent default);
 *   - `replication.test.ts` asserts the table covers every `EngineStateUpdate` kind and that
 *     each entry's snapshot/subscribe actually produce updates of the declared kind.
 *
 * Main-thread module: it closes over the real Zustand stores. The worker never imports it.
 */
import { useTTSSettingsStore } from '@store/useTTSSettingsStore';
import { useLexiconStore } from '@store/useLexiconStore';
import { useGenAIStore } from '@store/useGenAIStore';
import { useContentAnalysisStore } from '@store/useContentAnalysisStore';
import { useBookStore } from '@store/useBookStore';
import { useReadingStateStore } from '@store/useReadingStateStore';
import type { EngineStateUpdate, ProgressEngineView } from '@lib/tts/engine/WorkerEngineContext';
import type { TTSSettingsData, Progress, SectionAnalysis } from '@lib/tts/engine/EngineContext';

/**
 * Strip non-structured-cloneable values before crossing the worker boundary. Zustand
 * `getState()` snapshots carry action functions; a JSON round-trip drops those, leaving the
 * plain data the engine reads.
 */
function plain<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

type TTSSettingsStoreState = ReturnType<typeof useTTSSettingsStore.getState>;

/**
 * Build the EXPLICIT data-only settings payload the engine consumes (5b-PR3,
 * phase5-tts-strangler.md §5b.5): exactly the fields of {@link TTSSettingsData},
 * hand-picked from the settings store — replacing the old `plain(getState())`
 * full-store push (which shipped the playback mirror, the queue, and every
 * action-shaped key along with it; the per-sentence replication echo rode on
 * that). The return type makes the compiler enforce the contract: a field the
 * engine starts reading must be added HERE and to the interface, loudly.
 */
export function toTTSSettingsData(s: Pick<TTSSettingsStoreState,
    | 'profiles' | 'customAbbreviations' | 'alwaysMerge' | 'sentenceStarters'
    | 'sanitizationEnabled' | 'isBibleLexiconEnabled'
>): TTSSettingsData {
    return {
        profiles: s.profiles,
        customAbbreviations: s.customAbbreviations,
        alwaysMerge: s.alwaysMerge,
        sentenceStarters: s.sentenceStarters,
        sanitizationEnabled: s.sanitizationEnabled,
        isBibleLexiconEnabled: s.isBibleLexiconEnabled,
    };
}

/**
 * Narrow a `UserProgress` row to the fields the ENGINE reads (the progress analogue of
 * {@link toTTSSettingsData}). `PlaybackController.restoreQueue` reads `currentQueueIndex` and
 * `currentSectionIndex`; nothing else in src/lib/tts touches replicated progress.
 *
 * The engine's OWN host commands write this store per sentence (`updateTTSProgress`) and per
 * finished sentence (`addCompletedRange`), so the old `plain(progress)` push deep-cloned and
 * structured-cloned the whole row — `completedRanges` grows for the life of the book and
 * `readingSessions` holds up to 500 entries — twice per sentence. Two numbers now cross, and
 * the slice's equality guard drops the echo entirely.
 */
function toProgressEngineView(progress: Progress): ProgressEngineView {
    if (!progress) return null;
    return {
        currentQueueIndex: progress.currentQueueIndex,
        currentSectionIndex: progress.currentSectionIndex,
    };
}

/** The genAI fields the ENGINE actually reads — the echo guard's comparison set. */
function genAIEngineView(s: ReturnType<typeof useGenAIStore.getState>) {
    return {
        isEnabled: s.isEnabled,
        isContentAnalysisEnabled: s.isContentAnalysisEnabled,
        isTableAdaptationEnabled: s.isTableAdaptationEnabled,
        contentFilterSkipTypes: s.contentFilterSkipTypes,
        apiKey: s.apiKey,
        referenceDetectionStrategy: s.referenceDetectionStrategy,
    };
}

/**
 * What the worker's `bookLanguages` cache currently holds, per book — the echo guard for the
 * `bookLanguage` slice. Module-level because that cache has TWO writers: this file's
 * subscription AND {@link bookSnapshotUpdates}, the setBook pre-push the client calls
 * directly. A guard that remembers only its own pushes goes stale the moment the other writer
 * runs; both record here instead, so the guard always compares against what the worker
 * actually has.
 *
 * {@link createReplicatedSlices} clears it: the table is built once per worker client, and a
 * fresh worker starts with an empty cache.
 */
const replicatedBookLanguage = new Map<string, string>();

export interface ReplicatedSliceSpec {
    kind: EngineStateUpdate['kind'];
    /**
     * 'boot' slices replicate their full snapshot before the engine is considered ready.
     * 'per-book' slices are pushed for a specific book by `setBook` (see
     * {@link bookSnapshotUpdates}) and kept live by their subscription.
     */
    replication: 'boot' | 'per-book';
    /** The updates representing the current state of this slice (empty for per-book boot). */
    snapshot(): EngineStateUpdate[];
    /** Wire live updates; returns an unsubscribe. `push` delivers updates to the worker. */
    subscribe(push: (update: EngineStateUpdate) => void): () => void;
}

/**
 * Compile-time completeness: every {@link EngineStateUpdate} kind must appear here. Adding a
 * union member without a spec entry fails this Record's type, and the runtime table below is
 * built from it so the two cannot drift.
 */
const SLICE_BUILDERS: Record<
    EngineStateUpdate['kind'],
    (deps: ReplicationDeps) => ReplicatedSliceSpec
> = {
    // The settings slice targets the PERSISTED settings store and pushes the
    // explicit TTSSettingsData payload (5b-PR3). The playback mirror lives in
    // useTTSPlaybackStore, which is never replicated — an engine broadcast can
    // no longer re-enter this slice, so the per-sentence echo loop (S6) is
    // dead by construction (pinned in replication.test.ts).
    settings: () => ({
        kind: 'settings',
        replication: 'boot',
        snapshot: () => [{ kind: 'settings', settings: plain(toTTSSettingsData(useTTSSettingsStore.getState())) }],
        subscribe: (push) =>
            useTTSSettingsStore.subscribe((state) =>
                push({ kind: 'settings', settings: plain(toTTSSettingsData(state)) })),
    }),

    activeLanguage: () => ({
        kind: 'activeLanguage',
        replication: 'boot',
        snapshot: () => [{ kind: 'activeLanguage', lang: useTTSSettingsStore.getState().activeLanguage }],
        subscribe: (push) => {
            let last = useTTSSettingsStore.getState().activeLanguage;
            return useTTSSettingsStore.subscribe((state) => {
                if (state.activeLanguage !== last) {
                    last = state.activeLanguage;
                    push({ kind: 'activeLanguage', lang: state.activeLanguage });
                }
            });
        },
    }),

    genAI: () => ({
        kind: 'genAI',
        replication: 'boot',
        snapshot: () => [{ kind: 'genAI', settings: plain(useGenAIStore.getState()) }],
        // Equality guard on the fields the ENGINE reads (5b-PR3): the addGenAILog
        // host command writes log entries back into this store, which used to
        // round-trip every log line as a fresh genAI push (the second echo path).
        // Logs are not engine inputs, so pushes fire only when the engine view
        // actually changed.
        subscribe: (push) => {
            let last = JSON.stringify(genAIEngineView(useGenAIStore.getState()));
            return useGenAIStore.subscribe((state) => {
                const view = JSON.stringify(genAIEngineView(state));
                if (view !== last) {
                    last = view;
                    push({ kind: 'genAI', settings: plain(state) });
                }
            });
        },
    }),

    // Lexicon invalidation ping (5c-PR3): the worker PULLS assembled rules
    // through the lexicon port (LexiconService.getCompiled on the host); this
    // slice only tells it when its handle went stale — on any lexicon-store
    // change (rule CRUD, per-book bible preference) or a global bible-flag
    // flip in the settings store.
    lexicon: () => ({
        kind: 'lexicon',
        replication: 'boot',
        snapshot: () => [{ kind: 'lexicon', version: 0 }],
        subscribe: (push) => {
            let version = 0;
            let lastFlag = useTTSSettingsStore.getState().isBibleLexiconEnabled;
            const unsubStore = useLexiconStore.subscribe(() =>
                push({ kind: 'lexicon', version: ++version }));
            const unsubFlag = useTTSSettingsStore.subscribe((state) => {
                if (state.isBibleLexiconEnabled !== lastFlag) {
                    lastFlag = state.isBibleLexiconEnabled;
                    push({ kind: 'lexicon', version: ++version });
                }
            });
            return () => { unsubStore(); unsubFlag(); };
        },
    }),

    // The content-analysis store is CROSS-BOOK (keys `${bookId}/${sectionId}`, entries carry
    // tableAdaptations text), and the engine's own host commands write it
    // (markAnalysisLoading / markAnalysisError / saveTableAdaptations). Pushing
    // `plain(state.sections)` on every write deep-cloned the whole library's analyses (2.3 ms
    // at 400 sections, 6.1 ms at 1000) plus the structured clone — for a change the engine can
    // only consume for ONE section of ONE book. The live path now diffs entry identities
    // against the previous state, scopes to the current book, and pushes a DELTA; the
    // cross-book full map stays for the boot snapshot (the readiness gate needs it, and the
    // engine has no book yet).
    analysis: (deps) => ({
        kind: 'analysis',
        replication: 'boot',
        snapshot: () => [
            { kind: 'analysis', snapshot: { sections: plain(useContentAnalysisStore.getState().sections) } },
        ],
        subscribe: (push) =>
            useContentAnalysisStore.subscribe((state, prev) => {
                const bookId = deps.getCurrentBookId();
                if (!bookId) return;
                const prefix = `${bookId}/`;
                const sections: Record<string, SectionAnalysis> = state.sections ?? {};
                const changed = changedKeysForBook(prev?.sections ?? {}, sections, prefix);
                if (changed.length === 0) return;
                // The common case (one section's analysis changed) crosses as a single entry.
                const only = changed.length === 1 ? sections[changed[0]] : undefined;
                if (only) {
                    push({ kind: 'analysis', key: changed[0], analysis: plain(only) });
                    return;
                }
                // Several entries, or a removal: replace this BOOK'S entries with its map.
                // `bookId` is what makes that a prefix-scoped replace on the worker side —
                // without it the worker treats a map as authoritative for the whole cache and
                // drops every other book's boot-replicated entries (a book switch pushes no
                // analysis, so they never come back).
                push({ kind: 'analysis', bookId, snapshot: { sections: plain(scopeToBook(sections, prefix)) } });
            }),
    }),

    // The worker only ever asks for the CURRENT book's language (PlaybackController's
    // language sync + the queue-building path). Pushing one update per book in the library
    // meant 300 Comlink messages — and 300 `bookListeners` firings inside the worker — for a
    // 300-book library on every book-store write (a remote Yjs library update multiplies it).
    bookLanguage: (deps) => ({
        kind: 'bookLanguage',
        replication: 'per-book',
        snapshot: () => [],
        // Echo guard on {@link replicatedBookLanguage} — the worker's cache, not this
        // subscription's own history. The two writers diverge otherwise: while the current
        // book id is null this subscription drops every language write, so its private memory
        // keeps the pre-window value while `bookSnapshotUpdates` re-pushes the store's real
        // one on reopen. A later write back to the pre-window language then looks like "no
        // news" and is suppressed, leaving the worker on a language the store no longer has —
        // and since `bookListeners` only fire on an applied update, PlaybackController's
        // language sync never re-reads it (wrong voice until the next book switch).
        subscribe: (push) =>
            useBookStore.subscribe((state) => {
                const bookId = deps.getCurrentBookId();
                if (!bookId) return;
                const lang = state.books[bookId]?.language || 'en';
                if (replicatedBookLanguage.get(bookId) === lang) return;
                replicatedBookLanguage.set(bookId, lang);
                push({ kind: 'bookLanguage', bookId, lang });
            }),
    }),

    progress: (deps) => ({
        kind: 'progress',
        replication: 'per-book',
        snapshot: () => [],
        // Keep the active book's progress live (e.g. another device advanced it via sync).
        // Equality-guarded on the ENGINE view (see toProgressEngineView): the engine's own
        // per-sentence writes come back through this subscription, and only a queue/section
        // move is news to it.
        //
        // This memory is subscription-private, unlike {@link replicatedBookLanguage}, and can
        // drift from the worker's cache the same way across a null-book window. It is inert
        // here: the engine's ONLY read of replicated progress is restoreQueue, which runs
        // inside setBookId — immediately after `bookSnapshotUpdates` pushed the authoritative
        // value — and nothing re-reads it until the next setBookId pre-pushes again. A
        // suppressed push can therefore leave a stale cache entry, but no reader ever observes
        // it. (Wrong-voice bugs need a reader that keeps reading; bookLanguage has one.)
        subscribe: (push) => {
            const last = new Map<string, string>();
            return useReadingStateStore.subscribe(() => {
                const bookId = deps.getCurrentBookId();
                if (!bookId) return;
                const progress = toProgressEngineView(useReadingStateStore.getState().getProgress(bookId));
                const view = JSON.stringify(progress);
                if (last.get(bookId) === view) return;
                last.set(bookId, view);
                push({ kind: 'progress', bookId, progress });
            });
        },
    }),
};

/** This book's entries only — the cross-book map is never the engine's business. */
function scopeToBook(
    sections: Record<string, SectionAnalysis>,
    prefix: string,
): Record<string, SectionAnalysis> {
    const scoped: Record<string, SectionAnalysis> = {};
    for (const key of Object.keys(sections)) {
        if (key.startsWith(prefix)) scoped[key] = sections[key];
    }
    return scoped;
}

/**
 * Keys under `prefix` whose entry IDENTITY differs between two store states (added, replaced
 * or removed). The store rebuilds `sections` with a spread on every write, so reference
 * comparison is both correct and cheap — no clone, no deep compare.
 */
function changedKeysForBook(
    prev: Record<string, SectionAnalysis>,
    next: Record<string, SectionAnalysis>,
    prefix: string,
): string[] {
    const changed: string[] = [];
    for (const key of Object.keys(next)) {
        if (key.startsWith(prefix) && next[key] !== prev[key]) changed.push(key);
    }
    for (const key of Object.keys(prev)) {
        if (key.startsWith(prefix) && !(key in next)) changed.push(key);
    }
    return changed;
}

export interface ReplicationDeps {
    /** The book the engine is currently set to (drives the live per-book progress push). */
    getCurrentBookId(): string | null;
}

/** Build the full replication table (once per worker client — see {@link replicatedBookLanguage}). */
export function createReplicatedSlices(deps: ReplicationDeps): ReplicatedSliceSpec[] {
    replicatedBookLanguage.clear();
    return (Object.keys(SLICE_BUILDERS) as EngineStateUpdate['kind'][]).map((kind) =>
        SLICE_BUILDERS[kind](deps)
    );
}

/**
 * The per-book reads the engine performs synchronously inside `setBookId`, replicated ahead
 * of it. Used by the client's `setBook`.
 */
export function bookSnapshotUpdates(bookId: string): EngineStateUpdate[] {
    const lang = useBookStore.getState().books[bookId]?.language || 'en';
    const progress = useReadingStateStore.getState().getProgress(bookId);
    // This push is the OTHER writer of the worker's bookLanguage cache: record it, or the
    // slice's echo guard keeps comparing against a value the worker no longer holds.
    replicatedBookLanguage.set(bookId, lang);
    return [
        { kind: 'bookLanguage', bookId, lang },
        { kind: 'progress', bookId, progress: toProgressEngineView(progress) },
    ];
}

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
import type { EngineStateUpdate } from '@lib/tts/engine/WorkerEngineContext';
import type { TTSSettingsData } from '@lib/tts/engine/EngineContext';

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

    analysis: () => ({
        kind: 'analysis',
        replication: 'boot',
        snapshot: () => [
            { kind: 'analysis', snapshot: { sections: plain(useContentAnalysisStore.getState().sections) } },
        ],
        subscribe: (push) =>
            useContentAnalysisStore.subscribe((state) =>
                push({ kind: 'analysis', snapshot: { sections: plain(state.sections) } })),
    }),

    bookLanguage: () => ({
        kind: 'bookLanguage',
        replication: 'per-book',
        snapshot: () => [],
        subscribe: (push) =>
            useBookStore.subscribe((state) => {
                for (const [bookId, book] of Object.entries(state.books)) {
                    push({ kind: 'bookLanguage', bookId, lang: book?.language || 'en' });
                }
            }),
    }),

    progress: (deps) => ({
        kind: 'progress',
        replication: 'per-book',
        snapshot: () => [],
        // Keep the active book's progress live (e.g. another device advanced it via sync).
        subscribe: (push) =>
            useReadingStateStore.subscribe(() => {
                const bookId = deps.getCurrentBookId();
                if (!bookId) return;
                const progress = useReadingStateStore.getState().getProgress(bookId);
                push({ kind: 'progress', bookId, progress: plain(progress) });
            }),
    }),
};

export interface ReplicationDeps {
    /** The book the engine is currently set to (drives the live per-book progress push). */
    getCurrentBookId(): string | null;
}

/** Build the full replication table. */
export function createReplicatedSlices(deps: ReplicationDeps): ReplicatedSliceSpec[] {
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
    return [
        { kind: 'bookLanguage', bookId, lang },
        { kind: 'progress', bookId, progress: plain(progress) },
    ];
}

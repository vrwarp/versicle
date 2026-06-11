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
import { useTTSStore } from '../../store/useTTSStore';
import { useGenAIStore } from '../../store/useGenAIStore';
import { useContentAnalysisStore } from '../../store/useContentAnalysisStore';
import { useBookStore } from '../../store/useBookStore';
import { useReadingStateStore } from '../../store/useReadingStateStore';
import type { EngineStateUpdate } from '../../lib/tts/engine/WorkerEngineContext';

/**
 * Strip non-structured-cloneable values before crossing the worker boundary. Zustand
 * `getState()` snapshots carry action functions; a JSON round-trip drops those, leaving the
 * plain data the engine reads.
 */
export function plain<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
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
    settings: () => ({
        kind: 'settings',
        replication: 'boot',
        snapshot: () => [{ kind: 'settings', settings: plain(useTTSStore.getState()) }],
        subscribe: (push) =>
            useTTSStore.subscribe((state) => push({ kind: 'settings', settings: plain(state) })),
    }),

    activeLanguage: () => ({
        kind: 'activeLanguage',
        replication: 'boot',
        snapshot: () => [{ kind: 'activeLanguage', lang: useTTSStore.getState().activeLanguage }],
        subscribe: (push) => {
            let last = useTTSStore.getState().activeLanguage;
            return useTTSStore.subscribe((state) => {
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
        subscribe: (push) =>
            useGenAIStore.subscribe((state) => push({ kind: 'genAI', settings: plain(state) })),
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

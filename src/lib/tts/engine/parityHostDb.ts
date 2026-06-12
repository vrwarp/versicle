/**
 * Shared storage seam for the engine parity suite (Phase 5 entry gate, §0.1).
 *
 * Originally written against `@db/DBService`; Phase 3 deleted `src/db` and the engine now
 * imports the `src/data` repos directly (`bookContent` for sections/TTS preparation/table
 * images/structure, `playbackCache` for the persisted session). Both parity transports mock
 * the SAME repo modules (`@data/repos/bookContent`, `@data/repos/playbackCache`,
 * `../LexiconService`, `../PlatformIntegration` — the frozen engine-dir vi.mock allowlist,
 * phase5 doc N3 as rewritten post-P3; see plan/overhaul/prep/phase5-absorption-ledger.md).
 * This module centralizes the repo mocks so the `host.*` harness seams
 * (`seedSections`/`seedTTSState`/`seedTTSContent`/`gateSections`/…) write into one in-memory
 * state object that the mocked repos read.
 *
 * Usage in a parity test file (the state literal must be created inside `vi.hoisted` because
 * the mock factory runs during the hoisted import phase):
 *
 * ```ts
 * const hostDb = vi.hoisted(() => createParityHostDbState());
 * vi.mock('@data/repos/bookContent', async () => {
 *     const { createParityBookContent } = await import('./parityHostDb');
 *     return { bookContent: createParityBookContent(hostDb) };
 * });
 * vi.mock('@data/repos/playbackCache', async () => {
 *     const { createParityPlaybackCache } = await import('./parityHostDb');
 *     return { playbackCache: createParityPlaybackCache(hostDb) };
 * });
 * ```
 *
 * NOTE for `vi.hoisted`: it runs before imports, so it cannot call this module's helpers.
 * `createParityHostDbState` is written to be inlined there via `import()` — see the test
 * files, which use the async form `vi.hoisted` cannot support and instead inline the literal.
 */
import type { TTSQueueItem } from '../AudioPlayerService';

export interface ParityHostDbState {
    /** bookId → spine sections (bookContent.getSections). */
    sections: Record<string, Array<{ sectionId: string; title?: string; characterCount?: number }>>;
    /** bookId → persisted TTS session queue (playbackCache.getSession.playbackQueue). */
    ttsState: Record<string, { queue: TTSQueueItem[] } | null>;
    /** `${bookId}/${sectionId}` → prepared sentences (bookContent.getTTSPreparation). */
    ttsContent: Record<string, { sentences: Array<{ text: string; cfi: string; sourceIndices?: number[] }> } | undefined>;
    /** `${bookId}/${sectionId}` present ⇒ getTTSPreparation REJECTS (unloadable section). */
    contentErrors: Record<string, true>;
    /** bookId → gate promise getSections must await before resolving (P18 staleness). */
    sectionGates: Record<string, Promise<void> | undefined>;
    /** `${bookId}/${sectionId}` → number of getTTSPreparation calls (P18 observable). */
    contentFetches: Record<string, number>;
}

/** Fresh empty state. Test files inline this shape in `vi.hoisted` (see module docs). */
export function createParityHostDbState(): ParityHostDbState {
    return {
        sections: {},
        ttsState: {},
        ttsContent: {},
        contentErrors: {},
        sectionGates: {},
        contentFetches: {},
    };
}

/** Reset state in place between harnesses (the mocked repos close over the object). */
export function resetParityHostDb(db: ParityHostDbState): void {
    db.sections = {};
    db.ttsState = {};
    db.ttsContent = {};
    db.contentErrors = {};
    db.sectionGates = {};
    db.contentFetches = {};
}

/**
 * The `bookContent` repo surface the engine graph touches in the parity scenarios:
 * AudioPlayerService (getSections), AudioContentPipeline + TableAdaptationProcessor
 * (getTTSPreparation/getTableImages/getBookStructure).
 */
export function createParityBookContent(db: ParityHostDbState) {
    return {
        getSections: async (bookId: string) => {
            const gate = db.sectionGates[bookId];
            if (gate) await gate;
            return db.sections[bookId] ?? [];
        },
        getTTSPreparation: async (bookId: string, sectionId: string) => {
            const key = `${bookId}/${sectionId}`;
            db.contentFetches[key] = (db.contentFetches[key] ?? 0) + 1;
            if (db.contentErrors[key]) {
                throw new Error(`parity harness: TTS preparation read failed for ${key}`);
            }
            return db.ttsContent[key];
        },
        getTableImages: async () => [],
        getBookStructure: async () => undefined,
    };
}

/**
 * The `playbackCache` repo surface the engine graph touches in the parity scenarios:
 * AudioPlayerService (getSession — the restore source), PlaybackStateManager
 * (saveQueue/savePauseTime — fire-and-forget persistence the scenarios never read back).
 */
export function createParityPlaybackCache(db: ParityHostDbState) {
    return {
        getSession: async (bookId: string) => {
            const state = db.ttsState[bookId];
            if (!state) return undefined;
            return { bookId, playbackQueue: state.queue, updatedAt: 0 };
        },
        saveQueue: (): void => {},
        savePauseTime: async (): Promise<void> => {},
    };
}

/** Install a gate on getSections(bookId); returns the release function. */
export function gateParitySections(db: ParityHostDbState, bookId: string): () => void {
    let release!: () => void;
    db.sectionGates[bookId] = new Promise<void>((resolve) => {
        release = () => {
            delete db.sectionGates[bookId];
            resolve();
        };
    });
    return release;
}

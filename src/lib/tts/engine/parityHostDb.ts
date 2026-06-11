/**
 * Shared `@db/DBService` seam for the engine parity suite (Phase 5 entry gate, §0.1).
 *
 * Both parity transports mock the SAME three modules (`@db/DBService`, `../LexiconService`,
 * `../PlatformIntegration` — the frozen engine-dir vi.mock allowlist, phase5 doc N3). This
 * module centralizes the dbService mock so the `host.*` harness seams
 * (`seedSections`/`seedTTSState`/`seedTTSContent`/`gateSections`/…) write into one in-memory
 * state object that the mocked dbService reads.
 *
 * Usage in a parity test file (the state literal must be created inside `vi.hoisted` because
 * the mock factory runs during the hoisted import phase):
 *
 * ```ts
 * const hostDb = vi.hoisted(() => createParityHostDbState());
 * vi.mock('@db/DBService', async () => {
 *     const { createParityDbService } = await import('./parityHostDb');
 *     return { dbService: createParityDbService(hostDb) };
 * });
 * ```
 *
 * NOTE for `vi.hoisted`: it runs before imports, so it cannot call this module's helpers.
 * `createParityHostDbState` is written to be inlined there via `import()` — see the test
 * files, which use the async form `vi.hoisted` cannot support and instead inline the literal.
 */
import type { TTSQueueItem } from '../AudioPlayerService';

export interface ParityHostDbState {
    /** bookId → spine sections (dbService.getSections). */
    sections: Record<string, Array<{ sectionId: string; title?: string; characterCount?: number }>>;
    /** bookId → persisted TTS session state (dbService.getTTSState). */
    ttsState: Record<string, { queue: TTSQueueItem[] } | null>;
    /** `${bookId}/${sectionId}` → prepared sentences (dbService.getTTSContent). */
    ttsContent: Record<string, { sentences: Array<{ text: string; cfi: string; sourceIndices?: number[] }> } | undefined>;
    /** `${bookId}/${sectionId}` present ⇒ getTTSContent REJECTS (unloadable section). */
    contentErrors: Record<string, true>;
    /** bookId → gate promise getSections must await before resolving (P18 staleness). */
    sectionGates: Record<string, Promise<void> | undefined>;
    /** `${bookId}/${sectionId}` → number of getTTSContent calls (P18 observable). */
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

/** Reset state in place between harnesses (the mocked dbService closes over the object). */
export function resetParityHostDb(db: ParityHostDbState): void {
    db.sections = {};
    db.ttsState = {};
    db.ttsContent = {};
    db.contentErrors = {};
    db.sectionGates = {};
    db.contentFetches = {};
}

/**
 * The dbService surface the engine graph touches in the parity scenarios:
 * AudioPlayerService (getSections/getTTSState/saveTTSState), PlaybackStateManager
 * (saveTTSState/updatePlaybackState), AudioContentPipeline + TableAdaptationProcessor
 * (getTTSContent/getTableImages/getBookStructure).
 */
export function createParityDbService(db: ParityHostDbState) {
    return {
        getSections: async (bookId: string) => {
            const gate = db.sectionGates[bookId];
            if (gate) await gate;
            return db.sections[bookId] ?? [];
        },
        getTTSState: async (bookId: string) => db.ttsState[bookId] ?? null,
        saveTTSState: (): void => {},
        updatePlaybackState: async (): Promise<void> => {},
        getTTSContent: async (bookId: string, sectionId: string) => {
            const key = `${bookId}/${sectionId}`;
            db.contentFetches[key] = (db.contentFetches[key] ?? 0) + 1;
            if (db.contentErrors[key]) {
                throw new Error(`parity harness: TTS content read failed for ${key}`);
            }
            return db.ttsContent[key];
        },
        getTableImages: async () => [],
        getBookStructure: async () => null,
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

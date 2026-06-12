/**
 * Shared storage seam for the engine parity suite (Phase 5 entry gate, §0.1).
 *
 * History: originally written against `@db/DBService`, then (post-P3) against
 * the `src/data` repos via the engine-dir `vi.mock` allowlist. Since 5b-PR4
 * the engine reaches storage ONLY through the EngineContext ports
 * (`BookContentPort` for derived-content reads, `SessionStore` for the
 * playback session), so this module now builds INJECTED in-memory port
 * implementations — both parity transports construct the engine with them
 * directly (FakeEngineContext fields in-process; WorkerTtsEngine constructor
 * opts on the worker leg) and the `vi.mock` allowlist is EMPTY (the N3
 * deadline; enforced by eslint).
 *
 * The `host.*` harness seams (`seedSections`/`seedTTSState`/`seedTTSContent`/
 * `gateSections`/…) write into one shared state object the ports read.
 */
import type { TTSQueueItem } from '~types/tts';
import type { BookContentPort, SessionStore } from './EngineContext';

export interface ParityHostDbState {
    /** bookId → spine sections (content.getSections). */
    sections: Record<string, Array<{ sectionId: string; title?: string; characterCount?: number }>>;
    /** bookId → persisted TTS session queue (session.loadSession().playbackQueue). */
    ttsState: Record<string, { queue: TTSQueueItem[] } | null>;
    /** `${bookId}/${sectionId}` → prepared sentences (content.getTTSPreparation). */
    ttsContent: Record<string, { sentences: Array<{ text: string; cfi: string; sourceIndices?: number[] }> } | undefined>;
    /** `${bookId}/${sectionId}` present ⇒ getTTSPreparation REJECTS (unloadable section). */
    contentErrors: Record<string, true>;
    /** bookId → gate promise getSections must await before resolving (P18 staleness). */
    sectionGates: Record<string, Promise<void> | undefined>;
    /** `${bookId}/${sectionId}` → number of getTTSPreparation calls (P18 observable). */
    contentFetches: Record<string, number>;
}

/** Fresh empty state. */
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

/** Reset state in place between harnesses (the ports close over the object). */
export function resetParityHostDb(db: ParityHostDbState): void {
    db.sections = {};
    db.ttsState = {};
    db.ttsContent = {};
    db.contentErrors = {};
    db.sectionGates = {};
    db.contentFetches = {};
}

/**
 * The `BookContentPort` surface the engine graph touches in the parity
 * scenarios: PlaybackController (getSections), AudioContentPipeline +
 * TableAdaptationProcessor (getTTSPreparation/getTableImages/getBookStructure).
 * The seeded literals carry only the fields the engine reads, so the factory
 * casts once to the port type.
 */
export function createParityBookContent(db: ParityHostDbState): BookContentPort {
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
    } as unknown as BookContentPort;
}

/**
 * The `SessionStore` surface the parity scenarios touch: loadSession is the
 * restore source; the persistence writes are fire-and-forget and never read
 * back by the scenarios.
 */
export function createParitySessionStore(db: ParityHostDbState): SessionStore {
    return {
        loadSession: async (bookId: string) => {
            const state = db.ttsState[bookId];
            if (!state) return undefined;
            return { bookId, playbackQueue: state.queue, updatedAt: 0 };
        },
        persistQueue: (): void => {},
        persistPauseTime: async (): Promise<void> => {},
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

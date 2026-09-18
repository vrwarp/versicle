/**
 * Production implementations of the engine's storage ports (Phase 5b
 * decomposition; phase5-tts-strangler.md §5b.1), wrapping the worker-safe
 * `src/data` repos. Both threads use the same modules: the main-thread
 * context (createZustandEngineContext) and the worker context
 * (WorkerTtsEngine.connect) compose these defaults; tests inject in-memory
 * fakes instead — which is what lets the engine-dir `vi.mock` allowlist sit
 * at ZERO.
 *
 * The repos are import-side-effect free (the IDB connection opens lazily on
 * first call), so importing this module never touches storage by itself.
 */
import { bookContent } from '@data/repos/bookContent';
import { playbackCache } from '@data/repos/playbackCache';
import type { TTSQueueItem } from '~types/tts';
import type { BookContentPort, SessionStore, PlaybackSessionRow } from './EngineContext';

/** The repo IS the port (the port type is derived from the repo's surface). */
export const repoBookContentPort: BookContentPort = bookContent;

/**
 * The repo-backed {@link SessionStore} — the SINGLE owner of
 * `cache_session_state` traffic in the engine (the P3 dual-owner fix:
 * AudioPlayerService read sessions while the QueueModel wrote them; now one
 * object does both, per book, in order).
 *
 * Every persist for a book is chained behind one `getSession` seed read, so
 * the first write of a session is ordered after the row it may have to
 * preserve (P13a). That memo is an ORDERING optimization, not the guarantee:
 * the repo's mirror is a bounded LRU, so a book it seeded can be evicted
 * mid-session while this map still says "seeded". Cold-safety therefore lives
 * in the repo — `saveQueue` marks a record it had to build from scratch and
 * the flush merges the persisted row in before the put (playbackCache.ts).
 * Do not re-derive that invariant from this memo.
 *
 * WebKit-detach discipline: see the {@link SessionStore} port docs — writes
 * are debounced/fire-and-forget; callers never await them inside the
 * TaskSequencer.
 */
export function createRepoSessionStore(): SessionStore {
    // Per-book seed chain: the first touch loads the persisted row into the
    // repo's mirror; subsequent persists ride behind it in order.
    const seeded = new Map<string, Promise<void>>();
    const ensureSeeded = (bookId: string): Promise<void> => {
        let seed = seeded.get(bookId);
        if (!seed) {
            seed = playbackCache.getSession(bookId).then(() => undefined, () => undefined);
            seeded.set(bookId, seed);
        }
        return seed;
    };

    return {
        async loadSession(bookId: string): Promise<PlaybackSessionRow | undefined> {
            // getSession seeds the repo mirror as a side effect — the restore
            // read doubles as the cold-start seed.
            seeded.set(bookId, Promise.resolve());
            const row = await playbackCache.getSession(bookId);
            if (!row) return undefined;
            return {
                bookId: row.bookId,
                playbackQueue: row.playbackQueue,
                lastPauseTime: row.lastPauseTime,
                updatedAt: row.updatedAt,
            };
        },
        persistQueue(bookId: string, queue: ReadonlyArray<TTSQueueItem>): void {
            // Copy: the repo takes a mutable array and the persisted record must
            // not alias the (frozen) published queue.
            const copy = [...queue];
            void ensureSeeded(bookId).then(() => playbackCache.saveQueue(bookId, copy));
        },
        async persistPauseTime(bookId: string, lastPauseTime: number | null): Promise<void> {
            await ensureSeeded(bookId);
            await playbackCache.savePauseTime(bookId, lastPauseTime);
        },
    };
}

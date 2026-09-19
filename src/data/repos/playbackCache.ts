/**
 * `cache_session_state` repository — the TTS playback session mirror
 * (Phase 3, D5.2 in plan/overhaul/prep/phase3-storage-gateway.md; the
 * WebKit-hang-safe block carved VERBATIM from src/db/DBService.ts — this
 * is an explicitly protected keeper, the product of a multi-week WebKit
 * IndexedDB investigation; see verification/_idb_probe.js).
 *
 * Worker-safe: the TTS engine worker imports this module (via
 * PlaybackStateManager/AudioPlayerService). It must never import stores,
 * sync services, React, or zustand.
 *
 * P13a (closed): a `saveQueue` on a mirror that does not hold the book builds
 * a fresh record, so it used to clobber whatever else the persisted row
 * carried (a previous session's `lastPauseTime`). It now marks the book
 * unseeded and the flush merges the persisted row in — a read OUTSIDE the
 * gate, before the single synchronous put, never inside the transaction. The
 * consumer's "seeded once" memo (createRepoSessionStore) cannot carry that
 * guarantee any more: since the mirror became an LRU, a book it believes
 * seeded may have been evicted, so cold-safety has to live HERE.
 *
 * KNOWN GAPS deliberately deferred to P5b (the SessionStore port / single
 * session-owner fix of the C4 decomposition — engine surgery, not storage
 * motion):
 *  - Dual mirror: the worker and the main thread each hold their own
 *    `sessionCache` instance. The navigator.locks write gate removes the
 *    cross-context HANG hazard; single ownership lands with P5b.
 */
import { getConnection } from '../connection';
import { runExclusiveIdbWrite } from '../write-gate';
import { handleDbError } from '../errors';
import type { CacheSessionStateRow } from '../rows/cache';
import type { TTSQueueItem } from '~types/tts';

/**
 * How many books' rows the in-memory mirror keeps (insertion-ordered LRU).
 *
 * The mirror exists so a write never needs an intra-transaction read (the WebKit hang
 * shape) — it is NOT meant to be a library-wide cache. One row carries that book's whole
 * playback queue (300–800 {@link TTSQueueItem}s, ~50–150 KB), it was never pruned, and BOTH
 * the worker and the main-thread instance hold their own Map, so a long session that touched
 * many books grew two unbounded copies. An evicted book re-seeds from disk on its next touch —
 * {@link PlaybackCacheRepo.loadSession} on the read paths, and the merge in
 * {@link PlaybackCacheRepo.mergePersisted} for a cold {@link PlaybackCacheRepo.saveQueue},
 * which is what keeps eviction from costing the row's other fields; a book with an unflushed
 * write is never evicted, because for those the mirror IS the payload.
 */
const MAX_MIRRORED_BOOKS = 4;

class PlaybackCacheRepo {
  // ── cache_session_state persistence (WebKit-hang-safe) ─────────────────────
  // WebKit's IndexedDB hangs on two patterns we hit during TTS, each leaving a lone
  // cache_session_state readwrite transaction outstanding for 5–15s (proven with
  // verification/_idb_probe.js) — which wedges the connection and, through it, the
  // single-chain TTS task sequencer (play/pause never settle):
  //   1. concurrent readwrite transactions on the same store, and
  //   2. a readwrite transaction with an intra-transaction await — read-modify-write
  //      (`await store.get()` then `await store.put()`). The transaction can go inactive
  //      across the await and never fire 'complete'.
  // Mitigation: keep an in-memory mirror of each book's record, serialise every write
  // through one chain (no concurrency), and write with a single synchronous put() and no
  // await before it (no intra-transaction read).
  private sessionWriteChain: Promise<void> = Promise.resolve();
  private sessionCache = new Map<string, CacheSessionStateRow>();
  /** Books whose write is queued or in flight (counted — writes can overlap per book). */
  private sessionWriting = new Map<string, number>();
  /**
   * Books whose mirrored record was built COLD — `saveQueue` found no mirror
   * entry (first touch of this session, or the LRU evicted the book) and
   * started from `{bookId, playbackQueue, updatedAt}`. Such a record knows
   * nothing about the fields the persisted row carries, so the next write
   * merges the stored row in first (outside the gate). Cleared by any read
   * that seeds from disk.
   */
  private sessionUnseeded = new Set<string>();

  /**
   * Mark a book most-recently-used and prune the mirror back to {@link MAX_MIRRORED_BOOKS},
   * oldest first. Rows a pending (debounced) or in-flight write still has to read are
   * skipped: `writeSession` resolves the row from the mirror at commit time.
   */
  private touchSession(bookId: string, session: CacheSessionStateRow): void {
    // Map iteration follows insertion order, so delete+set moves the book to the recent end.
    this.sessionCache.delete(bookId);
    this.sessionCache.set(bookId, session);
    if (this.sessionCache.size <= MAX_MIRRORED_BOOKS) return;
    for (const id of this.sessionCache.keys()) {
      if (this.sessionCache.size <= MAX_MIRRORED_BOOKS) break;
      if (id === bookId || this.sessionDirty.has(id) || this.sessionWriting.has(id)) continue;
      this.sessionCache.delete(id);
      // The cold-record flag describes a mirrored record; the record is gone,
      // and the book's next saveQueue re-flags it on the mirror miss.
      this.sessionUnseeded.delete(id);
    }
  }

  /**
   * Fold the persisted row into a COLD mirrored record (one built by
   * `saveQueue` without a mirror entry), once. The record's own fields always
   * win — it carries the update being written — so this only restores what a
   * fresh `{bookId, playbackQueue, updatedAt}` never knew about, `lastPauseTime`
   * included. Mutates in place: `savePauseTime`/`saveQueue` hold references to
   * this object, and swapping it for a new one would drop their updates.
   */
  private mergePersisted(
    bookId: string,
    session: CacheSessionStateRow,
    persisted: CacheSessionStateRow | undefined,
  ): void {
    if (!this.sessionUnseeded.delete(bookId)) return;
    if (persisted) Object.assign(session, { ...persisted, ...session });
  }

  private enqueueSessionWrite(work: () => Promise<void>): Promise<void> {
    const next = this.sessionWriteChain.then(work, work);
    // Keep the chain alive even if an individual write rejects.
    this.sessionWriteChain = next.then(() => {}, () => {});
    return next;
  }

  /** Resolve a book's session record, seeding the in-memory mirror from disk once. */
  private async loadSession(bookId: string): Promise<CacheSessionStateRow> {
    const cached = this.sessionCache.get(bookId);
    if (cached) {
      this.touchSession(bookId, cached);
      return cached;
    }
    let session: CacheSessionStateRow | undefined;
    try {
      const db = await getConnection();
      session = await db.get('cache_session_state', bookId);
    } catch (error) {
      handleDbError(error);
    }
    // A concurrent caller may have populated the mirror while we awaited the read.
    const current = this.sessionCache.get(bookId);
    if (current) {
      // …including a cold saveQueue: the row we just read is what it lacks.
      this.mergePersisted(bookId, current, session);
      return current;
    }
    // The disk row (or its confirmed absence) is in hand: nothing left to merge.
    this.sessionUnseeded.delete(bookId);
    const resolved = session || { bookId, playbackQueue: [], updatedAt: Date.now() };
    this.touchSession(bookId, resolved);
    return resolved;
  }

  /** Serialised, hang-safe write of a book's mirrored record (single synchronous put). */
  private writeSession(bookId: string): Promise<void> {
    // Pin the mirrored row for the whole queued+in-flight window: the work below resolves it
    // from the mirror at commit time, so an eviction in between would silently drop the write.
    this.sessionWriting.set(bookId, (this.sessionWriting.get(bookId) ?? 0) + 1);
    return this.enqueueSessionWrite(async () => {
      try {
        const session = this.sessionCache.get(bookId);
        if (!session) return;
        try {
          const db = await getConnection();
          if (this.sessionUnseeded.has(bookId)) {
            // Cold record (first touch, or the LRU evicted this book while its
            // consumer still believed it seeded): read the persisted row and
            // merge it in. OUTSIDE the gate and before the transaction is
            // opened — the WebKit-hang shape below is untouched.
            this.mergePersisted(bookId, session, await db.get('cache_session_state', bookId));
          }
          // Snapshot now so a later in-memory mutation can't change the object mid-commit.
          const snapshot = { ...session };
          // Serialised through the shared IDB write gate so this cache_session_state readwrite
          // transaction never overlaps a Yjs `updates` write — concurrent readwrite txns hang
          // WebKit (see src/data/write-gate.ts).
          await runExclusiveIdbWrite(async () => {
            const tx = db.transaction('cache_session_state', 'readwrite');
            // Single synchronous put, no await before it — the WebKit-hang-safe shape.
            tx.objectStore('cache_session_state').put(snapshot);
            await tx.done;
          });
        } catch (error) {
          handleDbError(error);
        }
      } finally {
        const outstanding = (this.sessionWriting.get(bookId) ?? 0) - 1;
        if (outstanding > 0) this.sessionWriting.set(bookId, outstanding);
        else this.sessionWriting.delete(bookId);
      }
    });
  }

  // Debounced, coalesced disk persistence for cache_session_state. The in-memory mirror is
  // the source of truth during a session, so disk writes (which only matter for
  // cross-session resume) can be batched. Coalescing also minimises how often a
  // cache_session_state readwrite txn is in flight: WebKit can still intermittently hang
  // even a single clean put(), and a hung txn wedges the whole connection (and the TTS
  // sequencer behind it) — so fewer writes means fewer chances to wedge during the
  // play/pause window. (The window is shorter than the 1s the queue write already used, so
  // cross-session resume is no more delayed than before.)
  private sessionDirty = new Set<string>();
  private sessionFlushTimer: ReturnType<typeof setTimeout> | null = null;

  private scheduleSessionWrite(bookId: string): void {
    this.sessionDirty.add(bookId);
    if (this.sessionFlushTimer) return;
    this.sessionFlushTimer = setTimeout(() => {
      this.sessionFlushTimer = null;
      const books = [...this.sessionDirty];
      this.sessionDirty.clear();
      for (const id of books) void this.writeSession(id);
    }, 500);
  }

  // ── Public surface (D5.2) ──────────────────────────────────────────────────

  /**
   * Read a book's persisted session row, seeding the in-memory mirror so
   * later writes never need an intra-transaction read (getTTSState's seed).
   */
  async getSession(bookId: string): Promise<CacheSessionStateRow | undefined> {
    try {
      const db = await getConnection();
      const session = await db.get('cache_session_state', bookId);
      if (session) {
        this.touchSession(bookId, session);
      }
      // The mirror now holds the persisted row (or disk has none): either way
      // there is nothing left for a later write to merge.
      this.sessionUnseeded.delete(bookId);
      return session;
    } catch (error) {
      handleDbError(error);
    }
  }

  /** Mirror-update + debounced disk write of the playback queue (saveTTSState). */
  saveQueue(bookId: string, queue: TTSQueueItem[]): void {
    // Update the in-memory mirror (preserving lastPauseTime), then debounce the disk write.
    // Stays synchronous: a cold record is flagged instead, and the flush merges the
    // persisted row in before the put (see mergePersisted).
    const cached = this.sessionCache.get(bookId);
    const session = cached || { bookId, playbackQueue: [], updatedAt: Date.now() };
    if (!cached) this.sessionUnseeded.add(bookId);
    session.playbackQueue = queue;
    session.updatedAt = Date.now();
    this.touchSession(bookId, session);
    this.scheduleSessionWrite(bookId);
  }

  /**
   * Persist the last pause timestamp (updatePlaybackState). `null` clears it.
   * Seeds the mirror from disk on first touch so the write cannot clobber a
   * persisted queue.
   */
  async savePauseTime(bookId: string, lastPauseTime: number | null): Promise<void> {
    const session = await this.loadSession(bookId);
    session.lastPauseTime = lastPauseTime === null ? undefined : lastPauseTime;
    session.updatedAt = Date.now();
    this.scheduleSessionWrite(bookId);
  }

  /**
   * Deterministically flush the debounced cache_session_state writes NOW
   * instead of waiting out the 500ms timer. Used by the E2E test API
   * (`window.__versicleTest.flushPersistence()`) so tests can await
   * persistence instead of sleeping past the debounce window; safe for any
   * caller because writeSession is serialised through the shared exclusive
   * IDB write lock like every other session write.
   */
  async flushPending(): Promise<void> {
    if (this.sessionFlushTimer) {
      clearTimeout(this.sessionFlushTimer);
      this.sessionFlushTimer = null;
    }
    const books = [...this.sessionDirty];
    this.sessionDirty.clear();
    await Promise.all(books.map((id) => this.writeSession(id)));
  }

  /**
   * Cancel any pending (debounced) session write WITHOUT flushing (cleanup).
   * Runs at teardown/wipe: the in-memory mirror still holds the latest state,
   * and writing during teardown can race a closing DB connection — so drop
   * the pending write rather than flush it (the wipe path depends on
   * drop-not-flush, src/db/wipe.ts).
   */
  dropPending(): void {
    if (this.sessionFlushTimer) {
      clearTimeout(this.sessionFlushTimer);
      this.sessionFlushTimer = null;
    }
    this.sessionDirty.clear();
  }
}

/** Singleton — the in-memory session mirror is per-JS-context state. */
export const playbackCache = new PlaybackCacheRepo();
